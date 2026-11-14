// Return to Supplier (P1.3): damaged/wrong/defective goods already accepted into stock via a
// POSTED goods receipt. Staff requests a return against specific GRN lines, a manager approves,
// the supplier optionally reconfirms, warehouse executes an OUTBOUND stock movement reversing the
// original inbound, and an outcome (refund/redelivery/exchange/credit note) is recorded. The
// original GRN and its stock_movements are never touched or deleted — this only ever adds a new,
// separate OUTBOUND movement.

const { createMovementNumber } = require("../utils/inventory");

const RETURNABLE_GRN_STATUS = "POSTED";

// Statuses that still count toward "already requested/returned" for the double-count guard.
// Terminal-negative statuses (REJECTED, SUPPLIER_REJECTED, CANCELLED) free up the quantity again.
const ACTIVE_RETURN_STATUSES = ["PENDING_APPROVAL", "APPROVED", "PENDING_SUPPLIER_CONFIRMATION", "STOCK_RETURNED", "COMPLETED"];

const RESOLUTION_OUTCOMES = new Set(["REFUND", "REDELIVERY", "EXCHANGE", "CREDIT_NOTE", "OTHER"]);

class SupplierReturnError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Lock the GRN item row, sum every still-active return already requested against it, and report
 * whether requestedQty still fits under the originally accepted quantity (goods_receipt_items.
 * quantity — never mutated by a return). Mirrors assertInvoiceQtyWithinRemaining's lock-then-sum
 * shape so two concurrent return requests against the same line can't both pass.
 * @returns {number|null} null if requestedQty fits, otherwise the quantity actually still returnable
 */
async function assertReturnQtyWithinAccepted(tx, goodsReceiptItem, requestedQty) {
  await tx.$queryRawUnsafe("SELECT id FROM goods_receipt_items WHERE id = $1::uuid FOR UPDATE", goodsReceiptItem.id);
  const rows = await tx.supplier_return_items.findMany({
    where: { goods_receipt_item_id: goodsReceiptItem.id },
    select: { return_qty: true, supplier_returns: { select: { status: true } } },
  });
  const alreadyReturned = rows
    .filter((row) => ACTIVE_RETURN_STATUSES.includes(row.supplier_returns?.status))
    .reduce((sum, row) => sum + Number(row.return_qty || 0), 0);
  const acceptedQty = Number(goodsReceiptItem.quantity || 0);
  const remaining = acceptedQty - alreadyReturned;
  return requestedQty > remaining ? remaining : null;
}

/** Pure: validate the return request's header fields against the target GRN. */
function buildReturnRequestHeader(goodsReceipt, body = {}) {
  if (!goodsReceipt.purchase_order_id) {
    throw new SupplierReturnError("Phiếu nhập này không gắn với đơn đặt hàng nên không thể yêu cầu trả hàng nhà cung cấp");
  }
  if (goodsReceipt.status !== RETURNABLE_GRN_STATUS) {
    throw new SupplierReturnError(`Chỉ có thể yêu cầu trả hàng với phiếu nhập đã ghi sổ (POSTED), hiện tại là ${goodsReceipt.status}`);
  }
  const reason = String(body.reason || "").trim().slice(0, 2000);
  if (!reason) throw new SupplierReturnError("Cần ghi rõ lý do trả hàng");
  const evidenceReference = String(body.evidence_reference || "").trim().slice(0, 500) || null;
  const requiresSupplierConfirmation = body.requires_supplier_confirmation === undefined
    ? true
    : Boolean(body.requires_supplier_confirmation);
  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length === 0) throw new SupplierReturnError("Yêu cầu trả hàng phải có ít nhất một dòng");
  return { reason, evidenceReference, requiresSupplierConfirmation, rawLines };
}

/** Pure: validate one return line against the GRN's own items. */
function validateReturnLine(rawLine, goodsReceiptItemsById, seen) {
  const itemId = String(rawLine?.goods_receipt_item_id || "");
  const item = goodsReceiptItemsById.get(itemId);
  if (!item) throw new SupplierReturnError("Dòng trả hàng không thuộc phiếu nhập này");
  if (seen.has(itemId)) throw new SupplierReturnError("Mỗi dòng phiếu nhập chỉ được xuất hiện một lần trong yêu cầu trả hàng");
  seen.add(itemId);
  const qty = Number(rawLine?.return_qty);
  if (!Number.isInteger(qty) || qty <= 0) throw new SupplierReturnError("return_qty phải là số nguyên dương");
  const note = String(rawLine?.note || "").trim() || null;
  return { item, qty, note };
}

function nextStatusAfterApproval(requiresSupplierConfirmation) {
  return requiresSupplierConfirmation ? "PENDING_SUPPLIER_CONFIRMATION" : "APPROVED";
}

/** Pure: validate the final outcome recorded once stock has been returned. */
function buildCompletion(body = {}) {
  const outcome = String(body.resolution_outcome || "").trim().toUpperCase();
  if (!RESOLUTION_OUTCOMES.has(outcome)) {
    throw new SupplierReturnError(`resolution_outcome phải là một trong: ${Array.from(RESOLUTION_OUTCOMES).join(", ")}`);
  }
  const note = String(body.resolution_note || "").trim().slice(0, 2000) || null;
  return { outcome, note };
}

/**
 * Write the OUTBOUND stock movement for every line of an approved/confirmed return. Each line
 * locks its own stock_balances row (variant_id, location_id) before reading on_hand_qty/
 * available_qty, then re-checks against the fresh value — the same lock-reread-guard sequence
 * picking.controller.js uses for pick-to-ship — so this can never push either quantity negative.
 * available_qty already excludes reserved_qty/borrowed_qty by construction, so gating on it also
 * guarantees a return can never take stock set aside for an active loan reservation.
 * @param items  supplier_return_items rows, each including goods_receipt_items: { location_id }
 */
async function executeReturnStock(tx, supplierReturn, items, userId) {
  const now = new Date();
  const baseTimestamp = now.getTime();
  let index = 0;
  for (const item of items) {
    const locationId = item.goods_receipt_items?.location_id;
    if (!locationId) {
      throw new SupplierReturnError("Dòng hàng chưa có vị trí lưu kho nên không thể thực hiện xuất trả", 409);
    }
    await tx.$queryRawUnsafe(
      "SELECT id FROM stock_balances WHERE variant_id = $1::uuid AND location_id = $2::uuid FOR UPDATE",
      item.variant_id,
      locationId,
    );
    const balance = await tx.stock_balances.findFirst({ where: { variant_id: item.variant_id, location_id: locationId } });
    const qty = Number(item.return_qty);
    if (!balance || Number(balance.on_hand_qty || 0) < qty || Number(balance.available_qty || 0) < qty) {
      throw new SupplierReturnError("Không đủ số lượng khả dụng tại vị trí lưu kho để xuất trả nhà cung cấp", 409);
    }
    await tx.stock_balances.update({
      where: { id: balance.id },
      data: {
        on_hand_qty: { decrement: qty },
        available_qty: { decrement: qty },
        version: { increment: 1 },
        last_movement_at: now,
      },
    });
    await tx.stock_movements.create({
      data: {
        movement_number: createMovementNumber(baseTimestamp, index, "RTN"),
        movement_type: "OUTBOUND",
        movement_status: "POSTED",
        warehouse_id: supplierReturn.warehouse_id,
        variant_id: item.variant_id,
        from_location_id: locationId,
        quantity: qty,
        unit_cost: item.unit_cost,
        reason_code: "SUPPLIER_RETURN",
        source_service: "inventory-service",
        reference_type: "SUPPLIER_RETURN",
        reference_id: supplierReturn.id,
        created_by_user_id: userId,
        metadata: { supplier_return_item_id: item.id, goods_receipt_item_id: item.goods_receipt_item_id },
      },
    });
    index += 1;
  }
}

module.exports = {
  SupplierReturnError,
  ACTIVE_RETURN_STATUSES,
  RESOLUTION_OUTCOMES,
  assertReturnQtyWithinAccepted,
  buildReturnRequestHeader,
  validateReturnLine,
  nextStatusAfterApproval,
  buildCompletion,
  executeReturnStock,
};
