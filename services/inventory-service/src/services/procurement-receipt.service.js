// Receiving outcome for goods receipts created from a supplier delivery note.
//
// Quantities per line (never double counted):
//   note qty  = what the supplier's delivery note says was shipped in this batch
//   delivered = what physically arrived (staff count)
//   damaged   = arrived but damaged            -> recorded, NOT posted to stock
//   rejected  = arrived but refused / returned -> recorded, NOT posted (includes any overage)
//   accepted  = delivered - damaged - rejected -> the ONLY quantity posted to stock (= GRN quantity)
//   missing   = max(0, note qty - delivered)
//   overage   = max(0, delivered - note qty)   -> must be rejected (returned), never accepted
//
// The supplier's issued invoice is never touched here: discrepancies are recorded in a
// supplier_shortage_reports row for the supplier to answer.

class ProcurementError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function toNonNegativeInt(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

/**
 * Pure: validate one line and derive its outcome.
 * @returns {{delivered:number, damaged:number, rejected:number, accepted:number, missing:number, overage:number}}
 */
function computeLineOutcome({ noteQty, poRemainingQty, delivered, damaged = 0, rejected = 0 }) {
  const d = toNonNegativeInt(delivered, null);
  const dmg = toNonNegativeInt(damaged, 0);
  const rej = toNonNegativeInt(rejected, 0);
  if (d === null || dmg === null || rej === null) {
    throw new ProcurementError("INVALID_QUANTITY", "Số lượng giao, hỏng và từ chối phải là số nguyên không âm");
  }
  if (dmg + rej > d) {
    throw new ProcurementError("INVALID_QUANTITY", "Số lượng hỏng + từ chối không được vượt số lượng thực nhận");
  }
  const note = Number(noteQty || 0);
  const overage = Math.max(0, d - note);
  if (rej < overage) {
    throw new ProcurementError(
      "OVERAGE_NOT_REJECTED",
      `Hàng giao thừa ${overage} cuốn so với phiếu giao — ghi phần thừa vào số lượng từ chối/trả lại`,
    );
  }
  const accepted = d - dmg - rej;
  const remaining = Math.max(0, Number(poRemainingQty || 0));
  if (accepted > remaining) {
    throw new ProcurementError(
      "OVER_APPROVED_QUANTITY",
      "Số lượng chấp nhận vượt số lượng còn lại đã duyệt của đơn đặt hàng — cần duyệt ngoại lệ trước khi nhập vượt",
    );
  }
  return { delivered: d, damaged: dmg, rejected: rej, accepted, missing: Math.max(0, note - d), overage };
}

/**
 * How much of a PO line can still be put on a new (non-redelivery) delivery note / invoice,
 * counting every ordinary delivery note already submitted for it — not just what has been
 * received so far. A supplier can issue several delivery notes before any of them is received,
 * so capping against received_qty alone (the old check) let two 80-unit notes both pass on a
 * 100-unit line. Redelivery notes (created against a shortage report) are excluded from the
 * sum: they re-declare quantity that an earlier note already claimed but that was never
 * accepted (missing/damaged), so they don't compete for a fresh slice of ordered_qty — they're
 * already bounded by that shortage's own shortage_qty (see supplier-portal.controller.js). Call
 * this only for a non-redelivery line; skip it when creating a redelivery invoice.
 * Locks the PO item row first so two notes submitted at the same instant can't both read the
 * same pre-update sum and together exceed ordered_qty (same race as GRN posting).
 * @returns {number|null} null if invoicedQty fits, otherwise the quantity actually still available
 */
async function assertInvoiceQtyWithinRemaining(tx, poItem, invoicedQty) {
  await tx.$queryRawUnsafe("SELECT id FROM purchase_order_items WHERE id = $1::uuid FOR UPDATE", poItem.id);
  const rows = await tx.supplier_delivery_invoice_items.findMany({
    where: { purchase_order_item_id: poItem.id },
    select: { invoiced_qty: true, supplier_delivery_invoices: { select: { raw_payload: true } } },
  });
  const alreadyNoted = rows
    .filter((row) => row.supplier_delivery_invoices?.raw_payload?.redelivery !== true)
    .reduce((sum, row) => sum + Number(row.invoiced_qty || 0), 0);
  const remaining = Number(poItem.ordered_qty || 0) - alreadyNoted;
  return invoicedQty > remaining ? remaining : null;
}

/** Pure: turn line outcomes into discrepancy report lines (one row per type per PO line). */
function buildDiscrepancyLines(outcomes) {
  const lines = [];
  for (const o of outcomes) {
    const base = {
      purchase_order_item_id: o.purchase_order_item_id,
      variant_id: o.variant_id,
      ordered_qty: Number(o.ordered_qty || 0),
      received_qty: Number(o.received_qty_after || 0),
    };
    if (o.missing > 0) lines.push({ ...base, discrepancy_type: "SHORTAGE", shortage_qty: o.missing, note: `Phiếu giao ${o.note_qty}, thực nhận ${o.delivered}` });
    if (o.damaged > 0) lines.push({ ...base, discrepancy_type: "DAMAGED", shortage_qty: o.damaged, note: `${o.damaged} cuốn hư hỏng khi kiểm nhận` });
    if (o.overage > 0) lines.push({ ...base, discrepancy_type: "OVERAGE", shortage_qty: o.overage, note: `Giao thừa ${o.overage} cuốn so với phiếu giao, đã từ chối nhận` });
    const otherRejected = o.rejected - o.overage;
    if (otherRejected > 0) lines.push({ ...base, discrepancy_type: "REJECTED", shortage_qty: otherRejected, note: `${otherRejected} cuốn bị từ chối khi kiểm nhận` });
  }
  return lines;
}

function summarizeDiscrepancyType(lines) {
  const types = [...new Set(lines.map((line) => line.discrepancy_type))];
  if (types.length === 0) return null;
  return types.length === 1 ? types[0] : "MIXED";
}

// Report types that a later redelivery can close automatically once the PO line is fully received.
const QUANTITY_REPLACEABLE_TYPES = new Set(["SHORTAGE", "DAMAGED", "REJECTED"]);
const OPEN_REPORT_STATUSES = ["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"];

/**
 * Before a supplier receipt is posted: settle each line's accepted quantity from the staff
 * count (actual_quantity) and the recorded damaged/rejected quantities, and validate it
 * against the delivery note and the PO's approved remaining quantity.
 * Updates goods_receipt_items.quantity to the accepted quantity when it changed, so the
 * existing posting flow (stock + PO received_qty) posts exactly the accepted quantity.
 */
async function settleSupplierReceiptQuantities(tx, receipt) {
  const [items, noteItems, poItems] = await Promise.all([
    tx.goods_receipt_items.findMany({ where: { goods_receipt_id: receipt.id } }),
    tx.supplier_delivery_invoice_items.findMany({ where: { invoice_id: receipt.supplier_delivery_invoice_id } }),
    tx.purchase_order_items.findMany({ where: { purchase_order_id: receipt.purchase_order_id } }),
  ]);
  const noteByVariant = new Map(noteItems.map((item) => [String(item.variant_id), item]));
  const poByVariant = new Map(poItems.map((item) => [String(item.variant_id), item]));

  const outcomes = [];
  for (const item of items) {
    const noteItem = noteByVariant.get(String(item.variant_id));
    const poItem = poByVariant.get(String(item.variant_id));
    if (!noteItem || !poItem) {
      throw new ProcurementError("ITEM_NOT_ON_DELIVERY_NOTE", "Phiếu nhập có ấn bản không thuộc phiếu giao hàng/đơn đặt hàng");
    }
    const damaged = Number(item.damaged_qty || 0);
    const rejected = Number(item.rejected_qty || 0);
    // Staff count wins; otherwise the delivered qty recorded at creation; legacy rows only had quantity.
    const delivered = item.actual_quantity ?? item.delivered_qty ?? Number(item.quantity || 0) + damaged + rejected;
    const outcome = computeLineOutcome({
      noteQty: noteItem.invoiced_qty,
      poRemainingQty: Number(poItem.ordered_qty || 0) - Number(poItem.received_qty || 0),
      delivered,
      damaged,
      rejected,
    });
    if (outcome.accepted !== Number(item.quantity) || outcome.delivered !== item.delivered_qty) {
      await tx.goods_receipt_items.update({
        where: { id: item.id },
        data: { quantity: outcome.accepted, delivered_qty: outcome.delivered },
      });
    }
    outcomes.push({
      ...outcome,
      goods_receipt_item_id: item.id,
      note_item_id: noteItem.id,
      note_qty: Number(noteItem.invoiced_qty || 0),
      purchase_order_item_id: poItem.id,
      variant_id: item.variant_id,
      ordered_qty: Number(poItem.ordered_qty || 0),
      received_qty_before: Number(poItem.received_qty || 0),
      received_qty_after: Number(poItem.received_qty || 0) + outcome.accepted,
    });
  }
  return outcomes;
}

/**
 * After the receipt is posted (stock + PO received_qty updated): write the outcome back to the
 * delivery note lines, record a discrepancy report when anything is missing/damaged/rejected,
 * and close earlier quantity discrepancies that this delivery made whole.
 */
async function recordSupplierReceiptOutcome(tx, receipt, outcomes, userId) {
  const now = new Date();
  for (const o of outcomes) {
    await tx.supplier_delivery_invoice_items.update({
      where: { id: o.note_item_id },
      data: { delivered_qty: o.delivered, accepted_qty: o.accepted, updated_at: now },
    });
  }

  const discrepancyLines = buildDiscrepancyLines(outcomes);
  let report = null;
  if (discrepancyLines.length > 0) {
    const invoice = await tx.supplier_delivery_invoices.findUnique({
      where: { id: receipt.supplier_delivery_invoice_id },
      select: { id: true, supplier_id: true, invoice_number: true },
    });
    report = await tx.supplier_shortage_reports.create({
      data: {
        purchase_order_id: receipt.purchase_order_id,
        supplier_id: invoice.supplier_id,
        goods_receipt_id: receipt.id,
        invoice_id: invoice.id,
        status: "OPEN",
        discrepancy_type: summarizeDiscrepancyType(discrepancyLines),
        reason: `Chênh lệch khi kiểm nhận phiếu giao ${invoice.invoice_number} (phiếu nhập ${receipt.receipt_number})`,
        created_by_user_id: userId,
      },
    });
    await tx.supplier_shortage_report_items.createMany({
      data: discrepancyLines.map((line) => ({ ...line, shortage_report_id: report.id })),
    });
    await tx.inventory_audit_logs.create({
      data: {
        actor_user_id: userId,
        action_name: "SUPPLIER_DISCREPANCY_REPORTED",
        entity_type: "SUPPLIER_SHORTAGE_REPORT",
        entity_id: report.id,
        after_data: {
          purchase_order_id: receipt.purchase_order_id,
          goods_receipt_id: receipt.id,
          discrepancy_type: report.discrepancy_type,
          lines: discrepancyLines.map((line) => ({ variant_id: line.variant_id, type: line.discrepancy_type, qty: line.shortage_qty })),
        },
      },
    });
  }

  // Close earlier quantity discrepancies (shortage/damage/rejection) once every flagged PO line is
  // fully received. Overage / wrong item / price issues are never auto-closed: they need a person.
  const openReports = await tx.supplier_shortage_reports.findMany({
    where: {
      purchase_order_id: receipt.purchase_order_id,
      status: { in: OPEN_REPORT_STATUSES },
      ...(report ? { id: { not: report.id } } : {}),
    },
    include: { supplier_shortage_report_items: true },
  });
  if (openReports.length > 0) {
    const poItems = await tx.purchase_order_items.findMany({
      where: { purchase_order_id: receipt.purchase_order_id },
      select: { id: true, ordered_qty: true, received_qty: true },
    });
    const poById = new Map(poItems.map((item) => [String(item.id), item]));
    for (const open of openReports) {
      const items = open.supplier_shortage_report_items;
      if (items.length === 0) continue;
      const replaceable = items.every((item) => QUANTITY_REPLACEABLE_TYPES.has(item.discrepancy_type || "SHORTAGE"));
      if (!replaceable) continue;
      const stillShort = items.some((item) => {
        const po = poById.get(String(item.purchase_order_item_id));
        return Number(po?.ordered_qty || 0) - Number(po?.received_qty || 0) > 0;
      });
      if (stillShort) continue;
      await tx.supplier_shortage_reports.update({
        where: { id: open.id },
        data: { status: "RESOLVED", resolved_at: now, resolution_action: "REDELIVERED", updated_at: now },
      });
      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "SUPPLIER_SHORTAGE_RESOLVED",
          entity_type: "SUPPLIER_SHORTAGE_REPORT",
          entity_id: open.id,
          after_data: { purchase_order_id: receipt.purchase_order_id, resolved_by_goods_receipt_id: receipt.id, resolution_action: "REDELIVERED" },
        },
      });
    }
  }

  await tx.supplier_delivery_invoices.update({
    where: { id: receipt.supplier_delivery_invoice_id },
    data: { status: report ? "SHORTAGE_REPORTED" : "RECEIVED", updated_at: now },
  });

  return { discrepancyReport: report, discrepancyLines };
}

/**
 * A posted supplier receipt was cancelled (stock already reversed by the existing flow): put the
 * delivery note back to "not received" so it can be received again, and void the discrepancy
 * report that this receipt produced (the supplier invoice itself is untouched).
 */
async function revertSupplierReceiptOutcome(tx, receipt, userId) {
  if (!receipt.supplier_delivery_invoice_id) return;
  const now = new Date();
  await tx.supplier_delivery_invoice_items.updateMany({
    where: { invoice_id: receipt.supplier_delivery_invoice_id },
    data: { delivered_qty: null, accepted_qty: 0, updated_at: now },
  });
  await tx.supplier_delivery_invoices.update({
    where: { id: receipt.supplier_delivery_invoice_id },
    data: { status: "SUBMITTED", updated_at: now },
  });
  const reports = await tx.supplier_shortage_reports.findMany({
    where: { goods_receipt_id: receipt.id, status: { in: OPEN_REPORT_STATUSES } },
    select: { id: true, status: true },
  });
  for (const report of reports) {
    await tx.supplier_shortage_reports.update({
      where: { id: report.id },
      data: { status: "CANCELLED", resolution_note: `Phiếu nhập ${receipt.receipt_number} đã bị hủy`, updated_at: now },
    });
    await tx.inventory_audit_logs.create({
      data: {
        actor_user_id: userId,
        action_name: "SUPPLIER_DISCREPANCY_VOIDED",
        entity_type: "SUPPLIER_SHORTAGE_REPORT",
        entity_id: report.id,
        before_data: { status: report.status },
        after_data: { status: "CANCELLED", goods_receipt_id: receipt.id },
      },
    });
  }
}

function isSupplierReceipt(receipt) {
  return receipt?.source_type === "SUPPLIER_INVOICE" && Boolean(receipt.supplier_delivery_invoice_id) && Boolean(receipt.purchase_order_id);
}

module.exports = {
  isSupplierReceipt,
  revertSupplierReceiptOutcome,
  ProcurementError,
  computeLineOutcome,
  assertInvoiceQtyWithinRemaining,
  buildDiscrepancyLines,
  summarizeDiscrepancyType,
  settleSupplierReceiptQuantities,
  recordSupplierReceiptOutcome,
};
