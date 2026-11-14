const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, normalizeText } = require("../utils/validation");
const { canWriteWarehouse, requireWarehouseReadAccess } = require("../utils/warehouse-scope.utils");
const {
  RevisionError,
  buildRevisionProposal,
  assertNoActivePendingRevision,
  nextRevisionNumber,
  applyRevision,
  ACTIVE_REVISION_STATUSES,
} = require("../services/purchase-order-revision.service");

function fail(res, statusCode, message) {
  return res.status(statusCode).json({ message });
}

function mapRevision(revision) {
  return {
    id: revision.id,
    purchase_order_id: revision.purchase_order_id,
    revision_number: revision.revision_number,
    status: revision.status,
    reason: revision.reason,
    requires_supplier_reconfirmation: revision.requires_supplier_reconfirmation,
    before_snapshot: revision.before_snapshot,
    after_snapshot: revision.after_snapshot,
    requested_by_user_id: revision.requested_by_user_id,
    approved_by_user_id: revision.approved_by_user_id,
    rejected_reason: revision.rejected_reason,
    supplier_decision_user_id: revision.supplier_decision_user_id,
    effective_at: revision.effective_at,
    created_at: revision.created_at,
    updated_at: revision.updated_at,
  };
}

async function loadPoForWrite(tx, req, poId) {
  const po = await tx.purchase_orders.findUnique({ where: { id: poId }, include: { purchase_order_items: true } });
  if (!po) return { error: { statusCode: 404, message: "Không tìm thấy đơn đặt hàng" } };
  if (!(await canWriteWarehouse(req.user, po.warehouse_id))) {
    return { error: { statusCode: 403, message: "Bạn không có quyền thao tác trên kho này" } };
  }
  return { po };
}

async function findRevisionOrFail(tx, poId, revisionId) {
  const revision = await tx.purchase_order_revisions.findFirst({ where: { id: revisionId, purchase_order_id: poId } });
  if (!revision) return { error: { statusCode: 404, message: "Không tìm thấy yêu cầu thay đổi đơn đặt hàng" } };
  return { revision };
}

async function requestPurchaseOrderRevision(req, res) {
  const poId = parseId(req.params.id);
  const userId = parseId(req.user?.id);
  if (!poId) return fail(res, 400, "Mã đơn đặt hàng không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { po, error } = await loadPoForWrite(tx, req, poId);
      if (error) return error;

      await assertNoActivePendingRevision(tx, poId);
      const proposal = buildRevisionProposal(po, req.body);
      const revisionNumber = await nextRevisionNumber(tx, poId);

      const revision = await tx.purchase_order_revisions.create({
        data: {
          purchase_order_id: poId,
          revision_number: revisionNumber,
          reason: proposal.reason,
          requires_supplier_reconfirmation: proposal.requires_supplier_reconfirmation,
          before_snapshot: proposal.before_snapshot,
          after_snapshot: proposal.after_snapshot,
          requested_by_user_id: userId,
        },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "PURCHASE_ORDER_REVISION_REQUESTED",
          entity_type: "PURCHASE_ORDER",
          entity_id: poId,
          after_data: { revision_id: revision.id, revision_number: revisionNumber, reason: proposal.reason },
        },
      });

      return { data: revision };
    });

    if (result.error) return fail(res, result.error.statusCode, result.error.message);
    return res.status(201).json({ message: "Đã tạo yêu cầu thay đổi đơn đặt hàng", data: mapRevision(result.data) });
  } catch (error) {
    if (error instanceof RevisionError) return fail(res, error.statusCode, error.message);
    console.error("Error while requesting purchase order revision:", error);
    return fail(res, 500, "Internal server error");
  }
}

async function approveRevision(req, res) {
  const poId = parseId(req.params.id);
  const revisionId = parseId(req.params.revisionId);
  const userId = parseId(req.user?.id);
  if (!poId || !revisionId) return fail(res, 400, "Mã đơn đặt hàng hoặc mã yêu cầu thay đổi không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  const requiresSupplierReconfirmationOverride = req.body?.requires_supplier_reconfirmation;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { po, error: poError } = await loadPoForWrite(tx, req, poId);
      if (poError) return poError;

      const { revision, error: revisionError } = await findRevisionOrFail(tx, poId, revisionId);
      if (revisionError) return revisionError;
      if (revision.status !== "PENDING_APPROVAL") {
        return { statusCode: 409, message: "Yêu cầu thay đổi này không còn chờ duyệt" };
      }

      const claimed = await tx.purchase_order_revisions.updateMany({
        where: { id: revision.id, status: "PENDING_APPROVAL" },
        data: { approved_by_user_id: userId, updated_at: new Date() },
      });
      if (claimed.count !== 1) return { statusCode: 409, message: "Yêu cầu vừa được xử lý bởi người khác" };

      const requiresSupplierReconfirmation = requiresSupplierReconfirmationOverride === undefined
        ? revision.requires_supplier_reconfirmation
        : Boolean(requiresSupplierReconfirmationOverride);

      let updatedRevision;
      if (requiresSupplierReconfirmation) {
        updatedRevision = await tx.purchase_order_revisions.update({
          where: { id: revision.id },
          data: { status: "PENDING_SUPPLIER_RECONFIRMATION", requires_supplier_reconfirmation: true },
        });
      } else {
        await applyRevision(tx, { ...revision, requires_supplier_reconfirmation: false });
        updatedRevision = await tx.purchase_order_revisions.update({
          where: { id: revision.id },
          data: { status: "EFFECTIVE", requires_supplier_reconfirmation: false, effective_at: new Date() },
        });
      }

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "PURCHASE_ORDER_REVISION_APPROVED",
          entity_type: "PURCHASE_ORDER",
          entity_id: poId,
          before_data: { revision_id: revision.id, status: revision.status },
          after_data: { revision_id: revision.id, status: updatedRevision.status },
        },
      });

      return { data: updatedRevision };
    });

    if (result.error) return fail(res, result.error.statusCode, result.error.message);
    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.json({ message: "Đã duyệt yêu cầu thay đổi đơn đặt hàng", data: mapRevision(result.data) });
  } catch (error) {
    if (error instanceof RevisionError) return fail(res, error.statusCode, error.message);
    console.error("Error while approving purchase order revision:", error);
    return fail(res, 500, "Internal server error");
  }
}

async function rejectRevision(req, res) {
  return decideRevision(req, res, {
    activeStatus: "PENDING_APPROVAL",
    nextStatus: "REJECTED",
    actionName: "PURCHASE_ORDER_REVISION_REJECTED",
    message: "Đã từ chối yêu cầu thay đổi đơn đặt hàng",
    requireReason: true,
    reasonField: "rejected_reason",
  });
}

async function cancelRevision(req, res) {
  return decideRevision(req, res, {
    activeStatus: ACTIVE_REVISION_STATUSES,
    nextStatus: "CANCELLED",
    actionName: "PURCHASE_ORDER_REVISION_CANCELLED",
    message: "Đã hủy yêu cầu thay đổi đơn đặt hàng",
    requireReason: false,
  });
}

async function supplierConfirmRevision(req, res) {
  const poId = parseId(req.params.id);
  const revisionId = parseId(req.params.revisionId);
  const userId = parseId(req.user?.id);
  if (!poId || !revisionId) return fail(res, 400, "Mã đơn đặt hàng hoặc mã yêu cầu thay đổi không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { po, error: poError } = await loadPoForWrite(tx, req, poId);
      if (poError) return poError;

      const { revision, error: revisionError } = await findRevisionOrFail(tx, poId, revisionId);
      if (revisionError) return revisionError;
      if (revision.status !== "PENDING_SUPPLIER_RECONFIRMATION") {
        return { statusCode: 409, message: "Yêu cầu này không ở trạng thái chờ nhà cung cấp xác nhận lại" };
      }

      const claimed = await tx.purchase_order_revisions.updateMany({
        where: { id: revision.id, status: "PENDING_SUPPLIER_RECONFIRMATION" },
        data: { supplier_decision_user_id: userId, updated_at: new Date() },
      });
      if (claimed.count !== 1) return { statusCode: 409, message: "Yêu cầu vừa được xử lý bởi người khác" };

      await applyRevision(tx, revision);
      const updatedRevision = await tx.purchase_order_revisions.update({
        where: { id: revision.id },
        data: { status: "EFFECTIVE", effective_at: new Date() },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "PURCHASE_ORDER_REVISION_SUPPLIER_CONFIRMED",
          entity_type: "PURCHASE_ORDER",
          entity_id: poId,
          after_data: { revision_id: revision.id, status: updatedRevision.status },
        },
      });

      return { data: updatedRevision };
    });

    if (result.error) return fail(res, result.error.statusCode, result.error.message);
    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.json({ message: "Đã ghi nhận nhà cung cấp xác nhận lại đơn đặt hàng", data: mapRevision(result.data) });
  } catch (error) {
    if (error instanceof RevisionError) return fail(res, error.statusCode, error.message);
    console.error("Error while recording supplier reconfirmation:", error);
    return fail(res, 500, "Internal server error");
  }
}

async function supplierRejectRevision(req, res) {
  return decideRevision(req, res, {
    activeStatus: "PENDING_SUPPLIER_RECONFIRMATION",
    nextStatus: "SUPPLIER_REJECTED",
    actionName: "PURCHASE_ORDER_REVISION_SUPPLIER_REJECTED",
    message: "Đã ghi nhận nhà cung cấp không chấp nhận thay đổi",
    requireReason: true,
    reasonField: "rejected_reason",
    extraData: (userId) => ({ supplier_decision_user_id: userId }),
  });
}

/** Shared shape for the simple terminal transitions: reject / cancel / supplier-reject. */
async function decideRevision(req, res, options) {
  const poId = parseId(req.params.id);
  const revisionId = parseId(req.params.revisionId);
  const userId = parseId(req.user?.id);
  if (!poId || !revisionId) return fail(res, 400, "Mã đơn đặt hàng hoặc mã yêu cầu thay đổi không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  const reason = normalizeText(req.body?.reason);
  if (options.requireReason && !reason) return fail(res, 400, "Cần ghi rõ lý do");

  const activeStatuses = Array.isArray(options.activeStatus) ? options.activeStatus : [options.activeStatus];

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { po, error: poError } = await loadPoForWrite(tx, req, poId);
      if (poError) return poError;

      const { revision, error: revisionError } = await findRevisionOrFail(tx, poId, revisionId);
      if (revisionError) return revisionError;
      if (!activeStatuses.includes(revision.status)) {
        return { statusCode: 409, message: "Yêu cầu thay đổi này không ở trạng thái có thể thực hiện hành động này" };
      }

      const claimed = await tx.purchase_order_revisions.updateMany({
        where: { id: revision.id, status: revision.status },
        data: {
          status: options.nextStatus,
          updated_at: new Date(),
          ...(options.reasonField ? { [options.reasonField]: reason || null } : {}),
          ...(options.extraData ? options.extraData(userId) : {}),
        },
      });
      if (claimed.count !== 1) return { statusCode: 409, message: "Yêu cầu vừa được xử lý bởi người khác" };

      const updatedRevision = await tx.purchase_order_revisions.findUnique({ where: { id: revision.id } });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: options.actionName,
          entity_type: "PURCHASE_ORDER",
          entity_id: poId,
          before_data: { revision_id: revision.id, status: revision.status },
          after_data: { revision_id: revision.id, status: options.nextStatus, reason },
        },
      });

      return { data: updatedRevision };
    });

    if (result.error) return fail(res, result.error.statusCode, result.error.message);
    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.json({ message: options.message, data: mapRevision(result.data) });
  } catch (error) {
    if (error instanceof RevisionError) return fail(res, error.statusCode, error.message);
    console.error(`Error while transitioning purchase order revision to ${options.nextStatus}:`, error);
    return fail(res, 500, "Internal server error");
  }
}

async function getPurchaseOrderRevisions(req, res) {
  const poId = parseId(req.params.id);
  if (!poId) return fail(res, 400, "Mã đơn đặt hàng không hợp lệ");

  try {
    const po = await prisma.purchase_orders.findUnique({ where: { id: poId }, select: { id: true, warehouse_id: true } });
    if (!po) return fail(res, 404, "Không tìm thấy đơn đặt hàng");
    const canRead = await requireWarehouseReadAccess(req, res, po.warehouse_id);
    if (!canRead) return;

    const revisions = await prisma.purchase_order_revisions.findMany({
      where: { purchase_order_id: poId },
      orderBy: { revision_number: "asc" },
    });

    return res.json({
      data: {
        original: revisions[0]?.before_snapshot || null,
        current_effective_revision_number: [...revisions].reverse().find((r) => r.status === "EFFECTIVE")?.revision_number || 0,
        history: revisions.map(mapRevision),
      },
    });
  } catch (error) {
    console.error("Error while listing purchase order revisions:", error);
    return fail(res, 500, "Internal server error");
  }
}

module.exports = {
  requestPurchaseOrderRevision,
  approveRevision,
  rejectRevision,
  cancelRevision,
  supplierConfirmRevision,
  supplierRejectRevision,
  getPurchaseOrderRevisions,
};
