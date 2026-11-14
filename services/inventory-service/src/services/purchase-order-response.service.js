// Supplier response to a dispatched purchase order (accept / partially accept / reject).
// The PO lines are never overwritten by the supplier: any quantity or price change is stored
// in purchase_order_supplier_responses and waits for a SmartBook user holding the existing
// inventory.purchase.approve permission. Only an approved response is applied to the PO.

const SHORTAGE_PROPOSAL_ACTIONS = new Set(["REDELIVER", "EXCHANGE", "RETURN", "DOCUMENT_ADJUSTMENT", "CANNOT_FULFILL"]);
const RESOLUTION_ACTIONS = new Set(["REDELIVERED", "EXCHANGED", "RETURNED", "DOCUMENT_ADJUSTED", "ACCEPTED_LOSS", "OTHER"]);

class ResponseError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * Pure: validate a supplier response against the PO and classify it.
 * @param {object} po   purchase order with purchase_order_items
 * @param {object} body { decision, reason, proposed_delivery_date, lines:[{purchase_order_item_id, confirmed_qty, confirmed_unit_cost}] }
 */
function buildSupplierResponse(po, body = {}) {
  const requested = String(body.decision || "").trim().toUpperCase();
  if (!["ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED"].includes(requested)) {
    throw new ResponseError("decision phải là ACCEPTED, PARTIALLY_ACCEPTED hoặc REJECTED");
  }
  const reason = String(body.reason || "").trim().slice(0, 2000) || null;
  let proposedDate = null;
  if (body.proposed_delivery_date) {
    proposedDate = new Date(body.proposed_delivery_date);
    if (Number.isNaN(proposedDate.getTime())) throw new ResponseError("Ngày giao đề xuất không hợp lệ");
  }

  const items = po.purchase_order_items || [];
  if (requested === "REJECTED") {
    if (!reason) throw new ResponseError("Cần ghi rõ lý do từ chối đơn hàng");
    return {
      decision: "REJECTED",
      reason,
      proposed_delivery_date: null,
      lines: items.map((item) => ({
        purchase_order_item_id: item.id,
        variant_id: item.variant_id,
        ordered_qty: Number(item.ordered_qty),
        unit_cost: money(item.unit_cost),
        confirmed_qty: 0,
        confirmed_unit_cost: money(item.unit_cost),
      })),
      has_variance: false,
      review_status: "NOT_REQUIRED",
    };
  }

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const byId = new Map(rawLines.map((line) => [String(line?.purchase_order_item_id || ""), line]));
  for (const key of byId.keys()) {
    if (!items.some((item) => String(item.id) === key)) throw new ResponseError("Dòng phản hồi không thuộc đơn đặt hàng này");
  }

  const lines = items.map((item) => {
    const raw = byId.get(String(item.id));
    const ordered = Number(item.ordered_qty);
    const confirmedQty = raw && raw.confirmed_qty !== undefined && raw.confirmed_qty !== "" ? Number(raw.confirmed_qty) : ordered;
    const confirmedCost = raw && raw.confirmed_unit_cost !== undefined && raw.confirmed_unit_cost !== "" ? Number(raw.confirmed_unit_cost) : Number(item.unit_cost);
    if (!Number.isInteger(confirmedQty) || confirmedQty < 0) throw new ResponseError("Số lượng xác nhận phải là số nguyên không âm");
    if (confirmedQty > ordered) throw new ResponseError("Số lượng xác nhận không được vượt số lượng đặt — đề xuất tăng cần đơn bổ sung");
    if (!Number.isFinite(confirmedCost) || confirmedCost < 0) throw new ResponseError("Giá xác nhận phải là số không âm");
    return {
      purchase_order_item_id: item.id,
      variant_id: item.variant_id,
      ordered_qty: ordered,
      unit_cost: money(item.unit_cost),
      confirmed_qty: confirmedQty,
      confirmed_unit_cost: money(confirmedCost),
    };
  });

  const totalConfirmed = lines.reduce((sum, line) => sum + line.confirmed_qty, 0);
  if (totalConfirmed === 0) throw new ResponseError("Không xác nhận dòng nào — hãy chọn Từ chối và ghi lý do");
  const qtyReduced = lines.some((line) => line.confirmed_qty < line.ordered_qty);
  const priceChanged = lines.some((line) => Math.abs(line.confirmed_unit_cost - line.unit_cost) > 0.005);
  const decision = qtyReduced ? "PARTIALLY_ACCEPTED" : "ACCEPTED";
  if (requested === "ACCEPTED" && qtyReduced) throw new ResponseError("Có dòng giao ít hơn số lượng đặt — hãy chọn Chấp nhận một phần");
  if (decision === "PARTIALLY_ACCEPTED" && !reason) throw new ResponseError("Cần ghi lý do khi chỉ chấp nhận một phần");
  const hasVariance = qtyReduced || priceChanged;
  return {
    decision,
    reason,
    proposed_delivery_date: proposedDate,
    lines,
    has_variance: hasVariance,
    review_status: hasVariance ? "PENDING_REVIEW" : "NOT_REQUIRED",
  };
}

async function withdrawPendingResponses(tx, poId) {
  await tx.purchase_order_supplier_responses.updateMany({
    where: { purchase_order_id: poId, review_status: "PENDING_REVIEW" },
    data: { review_status: "WITHDRAWN" },
  });
}

/** Record "accepted as ordered" (used by the legacy one-click confirm and by shipping directly). */
async function recordFullAcceptance(tx, po, userId) {
  const items = po.purchase_order_items || (await tx.purchase_order_items.findMany({ where: { purchase_order_id: po.id } }));
  await withdrawPendingResponses(tx, po.id);
  await tx.purchase_order_supplier_responses.create({
    data: {
      purchase_order_id: po.id,
      supplier_id: po.supplier_id,
      decision: "ACCEPTED",
      lines: items.map((item) => ({
        purchase_order_item_id: item.id,
        variant_id: item.variant_id,
        ordered_qty: Number(item.ordered_qty),
        unit_cost: money(item.unit_cost),
        confirmed_qty: Number(item.ordered_qty),
        confirmed_unit_cost: money(item.unit_cost),
      })),
      has_variance: false,
      review_status: "NOT_REQUIRED",
      responded_by_user_id: userId || null,
    },
  });
}

/** Returns an {invalid,...} result when the supplier must not ship yet, else null. */
async function assertSupplierMayDeliver(tx, po) {
  if (po.supplier_response_status === "REJECTED") {
    return { invalid: true, statusCode: 409, message: "Nhà cung cấp đã từ chối đơn này nên không thể giao hàng" };
  }
  const pending = await tx.purchase_order_supplier_responses.count({
    where: { purchase_order_id: po.id, review_status: "PENDING_REVIEW" },
  });
  if (pending > 0) {
    return { invalid: true, statusCode: 409, message: "Thay đổi số lượng/giá đang chờ SmartBook duyệt — chưa thể giao hàng" };
  }
  return null;
}

module.exports = {
  ResponseError,
  SHORTAGE_PROPOSAL_ACTIONS,
  RESOLUTION_ACTIONS,
  buildSupplierResponse,
  recordFullAcceptance,
  withdrawPendingResponses,
  assertSupplierMayDeliver,
};
