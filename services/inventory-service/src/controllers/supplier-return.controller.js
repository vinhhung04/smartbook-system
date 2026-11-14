const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, normalizeText } = require("../utils/validation");
const { canWriteWarehouse, requireWarehouseReadAccess } = require("../utils/warehouse-scope.utils");
const {
  SupplierReturnError,
  assertReturnQtyWithinAccepted,
  buildReturnRequestHeader,
  validateReturnLine,
  nextStatusAfterApproval,
  buildCompletion,
  executeReturnStock,
} = require("../services/supplier-return.service");

function fail(res, statusCode, message) {
  return res.status(statusCode).json({ message });
}

function createReturnNumber() {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `RTN-${Date.now()}-${suffix}`;
}

function mapReturn(ret) {
  return {
    id: ret.id,
    return_number: ret.return_number,
    purchase_order_id: ret.purchase_order_id,
    goods_receipt_id: ret.goods_receipt_id,
    supplier_id: ret.supplier_id,
    warehouse_id: ret.warehouse_id,
    status: ret.status,
    reason: ret.reason,
    evidence_reference: ret.evidence_reference,
    requires_supplier_confirmation: ret.requires_supplier_confirmation,
    requested_by_user_id: ret.requested_by_user_id,
    approved_by_user_id: ret.approved_by_user_id,
    rejected_reason: ret.rejected_reason,
    supplier_decision_user_id: ret.supplier_decision_user_id,
    executed_by_user_id: ret.executed_by_user_id,
    executed_at: ret.executed_at,
    resolution_outcome: ret.resolution_outcome,
    resolution_note: ret.resolution_note,
    resolved_by_user_id: ret.resolved_by_user_id,
    resolved_at: ret.resolved_at,
    created_at: ret.created_at,
    updated_at: ret.updated_at,
    items: (ret.supplier_return_items || []).map((item) => ({
      id: item.id,
      goods_receipt_item_id: item.goods_receipt_item_id,
      purchase_order_item_id: item.purchase_order_item_id,
      variant_id: item.variant_id,
      return_qty: Number(item.return_qty),
      unit_cost: Number(item.unit_cost),
      note: item.note,
    })),
  };
}

async function loadReturnForWrite(tx, req, poId, returnId) {
  const supplierReturn = await tx.supplier_returns.findFirst({ where: { id: returnId, purchase_order_id: poId } });
  if (!supplierReturn) return { error: { statusCode: 404, message: "Không tìm thấy yêu cầu trả hàng" } };
  if (!(await canWriteWarehouse(req.user, supplierReturn.warehouse_id))) {
    return { error: { statusCode: 403, message: "Bạn không có quyền thao tác trên kho này" } };
  }
  return { supplierReturn };
}

async function requestSupplierReturn(req, res) {
  const poId = parseId(req.params.id);
  const userId = parseId(req.user?.id);
  if (!poId) return fail(res, 400, "Mã đơn đặt hàng không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.findUnique({ where: { id: poId } });
      if (!po) return { statusCode: 404, message: "Không tìm thấy đơn đặt hàng" };
      if (!(await canWriteWarehouse(req.user, po.warehouse_id))) {
        return { statusCode: 403, message: "Bạn không có quyền thao tác trên kho này" };
      }

      const goodsReceiptId = parseId(req.body?.goods_receipt_id);
      if (!goodsReceiptId) return { statusCode: 400, message: "Thiếu goods_receipt_id" };
      const goodsReceipt = await tx.goods_receipts.findFirst({
        where: { id: goodsReceiptId, purchase_order_id: poId },
        include: { goods_receipt_items: true },
      });
      if (!goodsReceipt) return { statusCode: 404, message: "Không tìm thấy phiếu nhập thuộc đơn đặt hàng này" };

      const header = buildReturnRequestHeader(goodsReceipt, req.body);
      const itemsById = new Map(goodsReceipt.goods_receipt_items.map((item) => [String(item.id), item]));
      const seen = new Set();
      const lines = [];
      for (const rawLine of header.rawLines) {
        const { item, qty, note } = validateReturnLine(rawLine, itemsById, seen);
        const overBy = await assertReturnQtyWithinAccepted(tx, item, qty);
        if (overBy !== null) {
          return {
            statusCode: 400,
            message: `Số lượng trả vượt số lượng còn có thể trả của dòng hàng (còn ${overBy})`,
          };
        }
        lines.push({
          goods_receipt_item_id: item.id,
          variant_id: item.variant_id,
          return_qty: qty,
          unit_cost: item.unit_cost,
          note,
        });
      }

      // Resolve purchase_order_item_id per variant for traceability (used by P1.4 matching).
      const poItems = await tx.purchase_order_items.findMany({ where: { purchase_order_id: poId } });
      const poItemByVariant = new Map(poItems.map((item) => [String(item.variant_id), item]));
      for (const line of lines) {
        line.purchase_order_item_id = poItemByVariant.get(String(line.variant_id))?.id || null;
      }

      const supplierReturn = await tx.supplier_returns.create({
        data: {
          return_number: createReturnNumber(),
          purchase_order_id: poId,
          goods_receipt_id: goodsReceipt.id,
          supplier_id: po.supplier_id,
          warehouse_id: po.warehouse_id,
          reason: header.reason,
          evidence_reference: header.evidenceReference,
          requires_supplier_confirmation: header.requiresSupplierConfirmation,
          requested_by_user_id: userId,
        },
      });
      await tx.supplier_return_items.createMany({
        data: lines.map((line) => ({ ...line, supplier_return_id: supplierReturn.id })),
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "SUPPLIER_RETURN_REQUESTED",
          entity_type: "SUPPLIER_RETURN",
          entity_id: supplierReturn.id,
          after_data: {
            purchase_order_id: poId,
            goods_receipt_id: goodsReceipt.id,
            line_count: lines.length,
            reason: header.reason,
          },
        },
      });

      const created = await tx.supplier_returns.findUnique({
        where: { id: supplierReturn.id },
        include: { supplier_return_items: true },
      });
      return { data: created };
    });

    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.status(201).json({ message: "Đã tạo yêu cầu trả hàng nhà cung cấp", data: mapReturn(result.data) });
  } catch (error) {
    if (error instanceof SupplierReturnError) return fail(res, error.statusCode, error.message);
    console.error("Error while requesting supplier return:", error);
    return fail(res, 500, "Internal server error");
  }
}

async function approveSupplierReturn(req, res) {
  const poId = parseId(req.params.id);
  const returnId = parseId(req.params.returnId);
  const userId = parseId(req.user?.id);
  if (!poId || !returnId) return fail(res, 400, "Mã đơn đặt hàng hoặc mã yêu cầu trả hàng không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");
  const requiresOverride = req.body?.requires_supplier_confirmation;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { supplierReturn, error } = await loadReturnForWrite(tx, req, poId, returnId);
      if (error) return error;
      if (supplierReturn.status !== "PENDING_APPROVAL") {
        return { statusCode: 409, message: "Yêu cầu trả hàng này không còn chờ duyệt" };
      }

      const claimed = await tx.supplier_returns.updateMany({
        where: { id: supplierReturn.id, status: "PENDING_APPROVAL" },
        data: { approved_by_user_id: userId, updated_at: new Date() },
      });
      if (claimed.count !== 1) return { statusCode: 409, message: "Yêu cầu vừa được xử lý bởi người khác" };

      const requiresSupplierConfirmation = requiresOverride === undefined
        ? supplierReturn.requires_supplier_confirmation
        : Boolean(requiresOverride);
      const nextStatus = nextStatusAfterApproval(requiresSupplierConfirmation);
      const updated = await tx.supplier_returns.update({
        where: { id: supplierReturn.id },
        data: { status: nextStatus, requires_supplier_confirmation: requiresSupplierConfirmation },
        include: { supplier_return_items: true },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "SUPPLIER_RETURN_APPROVED",
          entity_type: "SUPPLIER_RETURN",
          entity_id: supplierReturn.id,
          before_data: { status: supplierReturn.status },
          after_data: { status: updated.status },
        },
      });
      return { data: updated };
    });

    if (result.error) return fail(res, result.error.statusCode, result.error.message);
    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.json({ message: "Đã duyệt yêu cầu trả hàng", data: mapReturn(result.data) });
  } catch (error) {
    console.error("Error while approving supplier return:", error);
    return fail(res, 500, "Internal server error");
  }
}

/** Shared shape for the simple terminal transitions: reject / cancel / supplier-reject. */
async function decideReturn(req, res, options) {
  const poId = parseId(req.params.id);
  const returnId = parseId(req.params.returnId);
  const userId = parseId(req.user?.id);
  if (!poId || !returnId) return fail(res, 400, "Mã đơn đặt hàng hoặc mã yêu cầu trả hàng không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  const reason = normalizeText(req.body?.reason);
  if (options.requireReason && !reason) return fail(res, 400, "Cần ghi rõ lý do");
  const activeStatuses = Array.isArray(options.activeStatus) ? options.activeStatus : [options.activeStatus];

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { supplierReturn, error } = await loadReturnForWrite(tx, req, poId, returnId);
      if (error) return error;
      if (!activeStatuses.includes(supplierReturn.status)) {
        return { statusCode: 409, message: "Yêu cầu trả hàng không ở trạng thái có thể thực hiện hành động này" };
      }

      const claimed = await tx.supplier_returns.updateMany({
        where: { id: supplierReturn.id, status: supplierReturn.status },
        data: {
          status: options.nextStatus,
          updated_at: new Date(),
          ...(options.reasonField ? { [options.reasonField]: reason || null } : {}),
          ...(options.extraData ? options.extraData(userId) : {}),
        },
      });
      if (claimed.count !== 1) return { statusCode: 409, message: "Yêu cầu vừa được xử lý bởi người khác" };

      const updated = await tx.supplier_returns.findUnique({
        where: { id: supplierReturn.id },
        include: { supplier_return_items: true },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: options.actionName,
          entity_type: "SUPPLIER_RETURN",
          entity_id: supplierReturn.id,
          before_data: { status: supplierReturn.status },
          after_data: { status: options.nextStatus, reason },
        },
      });
      return { data: updated };
    });

    if (result.error) return fail(res, result.error.statusCode, result.error.message);
    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.json({ message: options.message, data: mapReturn(result.data) });
  } catch (error) {
    console.error(`Error while transitioning supplier return to ${options.nextStatus}:`, error);
    return fail(res, 500, "Internal server error");
  }
}

async function rejectSupplierReturn(req, res) {
  return decideReturn(req, res, {
    activeStatus: "PENDING_APPROVAL",
    nextStatus: "REJECTED",
    actionName: "SUPPLIER_RETURN_REJECTED",
    message: "Đã từ chối yêu cầu trả hàng",
    requireReason: true,
    reasonField: "rejected_reason",
  });
}

async function cancelSupplierReturn(req, res) {
  return decideReturn(req, res, {
    activeStatus: ["PENDING_APPROVAL", "APPROVED", "PENDING_SUPPLIER_CONFIRMATION"],
    nextStatus: "CANCELLED",
    actionName: "SUPPLIER_RETURN_CANCELLED",
    message: "Đã hủy yêu cầu trả hàng",
    requireReason: false,
  });
}

async function supplierRejectReturn(req, res) {
  return decideReturn(req, res, {
    activeStatus: "PENDING_SUPPLIER_CONFIRMATION",
    nextStatus: "SUPPLIER_REJECTED",
    actionName: "SUPPLIER_RETURN_SUPPLIER_REJECTED",
    message: "Đã ghi nhận nhà cung cấp không chấp nhận trả hàng",
    requireReason: true,
    reasonField: "rejected_reason",
    extraData: (userId) => ({ supplier_decision_user_id: userId }),
  });
}

async function supplierConfirmReturn(req, res) {
  const poId = parseId(req.params.id);
  const returnId = parseId(req.params.returnId);
  const userId = parseId(req.user?.id);
  if (!poId || !returnId) return fail(res, 400, "Mã đơn đặt hàng hoặc mã yêu cầu trả hàng không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { supplierReturn, error } = await loadReturnForWrite(tx, req, poId, returnId);
      if (error) return error;
      if (supplierReturn.status !== "PENDING_SUPPLIER_CONFIRMATION") {
        return { statusCode: 409, message: "Yêu cầu không ở trạng thái chờ nhà cung cấp xác nhận" };
      }

      const claimed = await tx.supplier_returns.updateMany({
        where: { id: supplierReturn.id, status: "PENDING_SUPPLIER_CONFIRMATION" },
        data: { status: "APPROVED", supplier_decision_user_id: userId, updated_at: new Date() },
      });
      if (claimed.count !== 1) return { statusCode: 409, message: "Yêu cầu vừa được xử lý bởi người khác" };

      const updated = await tx.supplier_returns.findUnique({
        where: { id: supplierReturn.id },
        include: { supplier_return_items: true },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "SUPPLIER_RETURN_SUPPLIER_CONFIRMED",
          entity_type: "SUPPLIER_RETURN",
          entity_id: supplierReturn.id,
          after_data: { status: updated.status },
        },
      });
      return { data: updated };
    });

    if (result.error) return fail(res, result.error.statusCode, result.error.message);
    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.json({ message: "Đã ghi nhận nhà cung cấp xác nhận trả hàng", data: mapReturn(result.data) });
  } catch (error) {
    console.error("Error while recording supplier return confirmation:", error);
    return fail(res, 500, "Internal server error");
  }
}

async function executeSupplierReturn(req, res) {
  const poId = parseId(req.params.id);
  const returnId = parseId(req.params.returnId);
  const userId = parseId(req.user?.id);
  if (!poId || !returnId) return fail(res, 400, "Mã đơn đặt hàng hoặc mã yêu cầu trả hàng không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { supplierReturn, error } = await loadReturnForWrite(tx, req, poId, returnId);
      if (error) return error;
      if (supplierReturn.status !== "APPROVED") {
        return { statusCode: 409, message: "Chỉ có thể xuất trả khi yêu cầu đã được duyệt (APPROVED)" };
      }

      const goodsReceipt = await tx.goods_receipts.findUnique({
        where: { id: supplierReturn.goods_receipt_id },
        select: { status: true },
      });
      if (!goodsReceipt || goodsReceipt.status !== "POSTED") {
        return { statusCode: 409, message: "Phiếu nhập gốc không còn ở trạng thái đã ghi sổ (có thể đã bị hủy)" };
      }

      const claimed = await tx.supplier_returns.updateMany({
        where: { id: supplierReturn.id, status: "APPROVED" },
        data: { status: "STOCK_RETURNED", executed_by_user_id: userId, executed_at: new Date(), updated_at: new Date() },
      });
      if (claimed.count !== 1) return { statusCode: 409, message: "Yêu cầu vừa được xử lý bởi người khác" };

      const items = await tx.supplier_return_items.findMany({
        where: { supplier_return_id: supplierReturn.id },
        include: { goods_receipt_items: { select: { location_id: true } } },
      });
      await executeReturnStock(tx, supplierReturn, items, userId);

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "SUPPLIER_RETURN_STOCK_EXECUTED",
          entity_type: "SUPPLIER_RETURN",
          entity_id: supplierReturn.id,
          after_data: { line_count: items.length },
        },
      });

      const updated = await tx.supplier_returns.findUnique({
        where: { id: supplierReturn.id },
        include: { supplier_return_items: true },
      });
      return { data: updated };
    });

    if (result.error) return fail(res, result.error.statusCode, result.error.message);
    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.json({ message: "Đã xuất kho trả hàng cho nhà cung cấp", data: mapReturn(result.data) });
  } catch (error) {
    if (error instanceof SupplierReturnError) return fail(res, error.statusCode, error.message);
    console.error("Error while executing supplier return stock movement:", error);
    return fail(res, 500, "Internal server error");
  }
}

async function completeSupplierReturn(req, res) {
  const poId = parseId(req.params.id);
  const returnId = parseId(req.params.returnId);
  const userId = parseId(req.user?.id);
  if (!poId || !returnId) return fail(res, 400, "Mã đơn đặt hàng hoặc mã yêu cầu trả hàng không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const { supplierReturn, error } = await loadReturnForWrite(tx, req, poId, returnId);
      if (error) return error;
      if (supplierReturn.status !== "STOCK_RETURNED") {
        return { statusCode: 409, message: "Chỉ có thể ghi nhận kết quả sau khi đã xuất kho trả hàng" };
      }

      const { outcome, note } = buildCompletion(req.body);
      const claimed = await tx.supplier_returns.updateMany({
        where: { id: supplierReturn.id, status: "STOCK_RETURNED" },
        data: {
          status: "COMPLETED",
          resolution_outcome: outcome,
          resolution_note: note,
          resolved_by_user_id: userId,
          resolved_at: new Date(),
          updated_at: new Date(),
        },
      });
      if (claimed.count !== 1) return { statusCode: 409, message: "Yêu cầu vừa được xử lý bởi người khác" };

      const updated = await tx.supplier_returns.findUnique({
        where: { id: supplierReturn.id },
        include: { supplier_return_items: true },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "SUPPLIER_RETURN_COMPLETED",
          entity_type: "SUPPLIER_RETURN",
          entity_id: supplierReturn.id,
          after_data: { resolution_outcome: outcome, resolution_note: note },
        },
      });
      return { data: updated };
    });

    if (result.error) return fail(res, result.error.statusCode, result.error.message);
    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.json({ message: "Đã ghi nhận kết quả xử lý trả hàng", data: mapReturn(result.data) });
  } catch (error) {
    if (error instanceof SupplierReturnError) return fail(res, error.statusCode, error.message);
    console.error("Error while completing supplier return:", error);
    return fail(res, 500, "Internal server error");
  }
}

async function getSupplierReturns(req, res) {
  const poId = parseId(req.params.id);
  if (!poId) return fail(res, 400, "Mã đơn đặt hàng không hợp lệ");

  try {
    const po = await prisma.purchase_orders.findUnique({ where: { id: poId }, select: { id: true, warehouse_id: true } });
    if (!po) return fail(res, 404, "Không tìm thấy đơn đặt hàng");
    const canRead = await requireWarehouseReadAccess(req, res, po.warehouse_id);
    if (!canRead) return;

    const returns = await prisma.supplier_returns.findMany({
      where: { purchase_order_id: poId },
      include: { supplier_return_items: true },
      orderBy: { created_at: "desc" },
    });
    return res.json({ data: returns.map(mapReturn) });
  } catch (error) {
    console.error("Error while listing supplier returns:", error);
    return fail(res, 500, "Internal server error");
  }
}

module.exports = {
  requestSupplierReturn,
  approveSupplierReturn,
  rejectSupplierReturn,
  cancelSupplierReturn,
  supplierConfirmReturn,
  supplierRejectReturn,
  executeSupplierReturn,
  completeSupplierReturn,
  getSupplierReturns,
};
