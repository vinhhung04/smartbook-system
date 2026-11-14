const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId } = require("../utils/validation");
const { canWriteWarehouse } = require("../utils/warehouse-scope.utils");
const {
  LineClosureError,
  buildCloseRemaining,
  buildReopen,
  calculateLineFulfillmentStatus,
} = require("../services/purchase-order-line-closure.service");

function fail(res, statusCode, message) {
  return res.status(statusCode).json({ message });
}

function mapItem(po, item) {
  return {
    id: item.id,
    purchase_order_id: item.purchase_order_id,
    variant_id: item.variant_id,
    ordered_qty: Number(item.ordered_qty),
    received_qty: Number(item.received_qty),
    closure_status: item.closure_status,
    fulfillment_status: calculateLineFulfillmentStatus(po.status, item),
    closed_reason: item.closed_reason,
    closed_evidence_reference: item.closed_evidence_reference,
    closed_by_user_id: item.closed_by_user_id,
    closed_at: item.closed_at,
    reopened_reason: item.reopened_reason,
    reopened_by_user_id: item.reopened_by_user_id,
    reopened_at: item.reopened_at,
  };
}

async function closeRemainingLine(req, res) {
  const poId = parseId(req.params.id);
  const itemId = parseId(req.params.itemId);
  const userId = parseId(req.user?.id);
  if (!poId || !itemId) return fail(res, 400, "Mã đơn đặt hàng hoặc mã dòng hàng không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.findUnique({ where: { id: poId } });
      if (!po) return { statusCode: 404, message: "Không tìm thấy đơn đặt hàng" };
      if (!(await canWriteWarehouse(req.user, po.warehouse_id))) {
        return { statusCode: 403, message: "Bạn không có quyền thao tác trên kho này" };
      }

      // Lock the line before reading received_qty, consistent with GRN/invoice/revision posting:
      // a concurrent GRN or invoice must not be able to change received_qty underneath this check.
      await tx.$queryRawUnsafe("SELECT id FROM purchase_order_items WHERE id = $1::uuid FOR UPDATE", itemId);
      const item = await tx.purchase_order_items.findFirst({ where: { id: itemId, purchase_order_id: poId } });
      if (!item) return { statusCode: 404, message: "Không tìm thấy dòng hàng trong đơn đặt hàng này" };

      const proposal = buildCloseRemaining(po, item, req.body);
      const updated = await tx.purchase_order_items.update({
        where: { id: item.id },
        data: {
          closure_status: "CLOSED_WITH_REMAINING",
          closed_reason: proposal.reason,
          closed_evidence_reference: proposal.evidenceReference,
          closed_by_user_id: userId,
          closed_at: new Date(),
          reopened_reason: null,
          reopened_by_user_id: null,
          reopened_at: null,
        },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "PURCHASE_ORDER_LINE_CLOSED_WITH_REMAINING",
          entity_type: "PURCHASE_ORDER_ITEM",
          entity_id: item.id,
          before_data: { closure_status: item.closure_status },
          after_data: {
            purchase_order_id: poId,
            closure_status: updated.closure_status,
            reason: proposal.reason,
            evidence_reference: proposal.evidenceReference,
            remaining_qty_at_close: proposal.remainingQtyAtClose,
          },
        },
      });

      return { data: updated, po };
    });

    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.json({ message: "Đã đóng phần còn lại của dòng hàng", data: mapItem(result.po, result.data) });
  } catch (error) {
    if (error instanceof LineClosureError) return fail(res, error.statusCode, error.message);
    console.error("Error while closing remaining quantity:", error);
    return fail(res, 500, "Internal server error");
  }
}

async function reopenLine(req, res) {
  const poId = parseId(req.params.id);
  const itemId = parseId(req.params.itemId);
  const userId = parseId(req.user?.id);
  if (!poId || !itemId) return fail(res, 400, "Mã đơn đặt hàng hoặc mã dòng hàng không hợp lệ");
  if (!userId) return fail(res, 401, "Unauthorized");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.findUnique({ where: { id: poId } });
      if (!po) return { statusCode: 404, message: "Không tìm thấy đơn đặt hàng" };
      if (!(await canWriteWarehouse(req.user, po.warehouse_id))) {
        return { statusCode: 403, message: "Bạn không có quyền thao tác trên kho này" };
      }

      const item = await tx.purchase_order_items.findFirst({ where: { id: itemId, purchase_order_id: poId } });
      if (!item) return { statusCode: 404, message: "Không tìm thấy dòng hàng trong đơn đặt hàng này" };

      const proposal = buildReopen(item, req.body);
      const updated = await tx.purchase_order_items.update({
        where: { id: item.id },
        data: {
          closure_status: "OPEN",
          reopened_reason: proposal.reason,
          reopened_by_user_id: userId,
          reopened_at: new Date(),
        },
      });

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "PURCHASE_ORDER_LINE_REOPENED",
          entity_type: "PURCHASE_ORDER_ITEM",
          entity_id: item.id,
          before_data: { closure_status: item.closure_status, closed_reason: item.closed_reason },
          after_data: { purchase_order_id: poId, closure_status: updated.closure_status, reason: proposal.reason },
        },
      });

      return { data: updated, po };
    });

    if (result.statusCode) return fail(res, result.statusCode, result.message);
    return res.json({ message: "Đã mở lại dòng hàng", data: mapItem(result.po, result.data) });
  } catch (error) {
    if (error instanceof LineClosureError) return fail(res, error.statusCode, error.message);
    console.error("Error while reopening a closed purchase order line:", error);
    return fail(res, 500, "Internal server error");
  }
}

module.exports = {
  closeRemainingLine,
  reopenLine,
};
