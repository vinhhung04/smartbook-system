// Close Remaining Quantity (P1.2): when ordered_qty - received_qty on a PO line will never be
// delivered (both sides agree), a manager closes the remainder instead of leaving the line stuck
// "partially received" forever. This never touches ordered_qty or received_qty — it only records
// that the gap between them is closed, so the line's fulfillment state can be shown as its own
// bucket (CLOSED_WITH_REMAINING) instead of being lumped in with an ordinary partial receipt.

const CLOSABLE_PO_STATUSES = new Set([
  "SENT_TO_SUPPLIER",
  "SUPPLIER_CONFIRMED",
  "PARTIALLY_RECEIVED",
  "SHORTAGE_REPORTED",
]);

class LineClosureError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** Pure: validate a close-remaining request against the PO and its line's current state. */
function buildCloseRemaining(po, item, body = {}) {
  if (!CLOSABLE_PO_STATUSES.has(po.status)) {
    throw new LineClosureError(`Không thể đóng phần còn lại khi đơn đặt hàng ở trạng thái ${po.status}`);
  }
  if (item.closure_status === "CLOSED_WITH_REMAINING") {
    throw new LineClosureError("Dòng hàng đã được đóng phần còn lại trước đó", 409);
  }
  const remaining = Number(item.ordered_qty || 0) - Number(item.received_qty || 0);
  if (remaining <= 0) {
    throw new LineClosureError("Dòng hàng không còn số lượng chưa nhận để đóng");
  }
  const reason = String(body.reason || "").trim().slice(0, 2000);
  if (!reason) throw new LineClosureError("Cần ghi rõ lý do đóng phần còn lại");
  const evidenceReference = String(body.evidence_reference || "").trim().slice(0, 500) || null;

  return { reason, evidenceReference, remainingQtyAtClose: remaining };
}

/** Pure: validate a reopen request — only a previously closed line can be reopened. */
function buildReopen(item, body = {}) {
  if (item.closure_status !== "CLOSED_WITH_REMAINING") {
    throw new LineClosureError("Dòng hàng chưa bị đóng phần còn lại nên không thể mở lại", 409);
  }
  const reason = String(body.reason || "").trim().slice(0, 2000);
  if (!reason) throw new LineClosureError("Cần ghi rõ lý do mở lại dòng hàng");
  return { reason };
}

/** The line's own fulfillment bucket — kept distinct from the ad hoc MATCHED/UNDER_RECEIVED
 * labels already shown elsewhere, so a manually-closed or cancelled line is never shown as if it
 * were an ordinary open receipt. */
function calculateLineFulfillmentStatus(poStatus, item) {
  if (poStatus === "CANCELLED") return "CANCELLED";
  if (item.closure_status === "CLOSED_WITH_REMAINING") return "CLOSED_WITH_REMAINING";
  const ordered = Number(item.ordered_qty || 0);
  const received = Number(item.received_qty || 0);
  if (ordered > 0 && received >= ordered) return "FULLY_RECEIVED";
  if (received > 0) return "PARTIALLY_RECEIVED";
  return "NOT_RECEIVED";
}

module.exports = {
  LineClosureError,
  CLOSABLE_PO_STATUSES,
  buildCloseRemaining,
  buildReopen,
  calculateLineFulfillmentStatus,
};
