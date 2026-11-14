// Pure three/four-way match: PO <-> supplier invoices <-> delivery notes <-> posted GRNs.
// No database access here so every rule is unit-testable; the controller loads the rows.
//
// An invoice is NOT required to equal a single GRN: invoices may cover several deliveries and
// be issued before or after the goods arrive, so matching is done on per-PO-line totals, while
// the per-delivery history is returned separately.

const INVOICE_TYPES = new Set(["VAT_INVOICE", "SALES_INVOICE"]);
const MONEY_TOLERANCE = 1; // VND rounding tolerance
const OPEN_REPORT_STATUSES = new Set(["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"]);

const RESULT = {
  MATCHED: "MATCHED",
  PARTIALLY_MATCHED: "PARTIALLY_MATCHED",
  DISCREPANCY: "DISCREPANCY",
  PENDING_DOCUMENT: "PENDING_DOCUMENT",
  NEEDS_REVIEW: "NEEDS_REVIEW",
};

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function isActiveInvoice(doc) {
  return INVOICE_TYPES.has(doc.document_type) && doc.status === "ISSUED";
}

function checkInvoiceHeader(doc) {
  const lineSum = (doc.lines || []).reduce((sum, line) => sum + num(line.quantity) * num(line.unit_price), 0);
  const issues = [];
  if (doc.subtotal_amount != null && (doc.lines || []).length > 0 && Math.abs(num(doc.subtotal_amount) - lineSum) > MONEY_TOLERANCE) {
    issues.push("SUBTOTAL_NOT_EQUAL_LINES");
  }
  if (doc.total_amount != null && doc.subtotal_amount != null
    && Math.abs(num(doc.subtotal_amount) + num(doc.tax_amount) - num(doc.total_amount)) > MONEY_TOLERANCE) {
    issues.push("TOTAL_NOT_EQUAL_SUBTOTAL_PLUS_TAX");
  }
  return issues;
}

/**
 * @param {object} input
 * @param {Array} input.poItems        [{id, variant_id, title, ordered_qty, unit_cost}]
 * @param {Array} input.documents      procurement documents with `lines` ({purchase_order_item_id, variant_id, quantity, unit_price})
 * @param {Array} input.deliveryNotes  [{id, invoice_number, delivery_number, items:[{purchase_order_item_id, variant_id, invoiced_qty}]}]
 * @param {Array} input.receipts       goods receipts [{id, receipt_number, status, supplier_delivery_invoice_id, items:[{variant_id, quantity, delivered_qty, damaged_qty, rejected_qty}]}]
 * @param {Array} input.discrepancyReports [{id, status, discrepancy_type, items:[{variant_id}]}]
 */
function buildDocumentReconciliation({ poItems = [], documents = [], deliveryNotes = [], receipts = [], discrepancyReports = [] }) {
  const invoices = documents.filter(isActiveInvoice);
  const openReports = discrepancyReports.filter((report) => OPEN_REPORT_STATUSES.has(report.status));
  const postedReceipts = receipts.filter((receipt) => receipt.status === "POSTED");

  const lines = poItems.map((poItem) => {
    const key = String(poItem.variant_id);
    const invoiceLines = invoices.flatMap((doc) => (doc.lines || []).filter((line) => String(line.variant_id) === key));
    const invoiced = invoiceLines.reduce((sum, line) => sum + num(line.quantity), 0);
    const invoicePrices = [...new Set(invoiceLines.map((line) => num(line.unit_price)))];
    const noted = deliveryNotes.reduce(
      (sum, note) => sum + (note.items || []).filter((item) => String(item.variant_id) === key).reduce((s, item) => s + num(item.invoiced_qty), 0),
      0,
    );
    const receiptItems = postedReceipts.flatMap((receipt) => (receipt.items || []).filter((item) => String(item.variant_id) === key));
    const accepted = receiptItems.reduce((sum, item) => sum + num(item.quantity), 0);
    const damaged = receiptItems.reduce((sum, item) => sum + num(item.damaged_qty), 0);
    const rejected = receiptItems.reduce((sum, item) => sum + num(item.rejected_qty), 0);
    const delivered = receiptItems.reduce(
      (sum, item) => sum + (item.delivered_qty != null ? num(item.delivered_qty) : num(item.quantity) + num(item.damaged_qty) + num(item.rejected_qty)),
      0,
    );
    // Delivery-note quantity that has already been checked in (only notes with a posted GRN).
    const receivedNoteIds = new Set(postedReceipts.map((receipt) => String(receipt.supplier_delivery_invoice_id)));
    const notedReceived = deliveryNotes
      .filter((note) => receivedNoteIds.has(String(note.id)))
      .reduce((sum, note) => sum + (note.items || []).filter((item) => String(item.variant_id) === key).reduce((s, item) => s + num(item.invoiced_qty), 0), 0);

    const ordered = num(poItem.ordered_qty);
    const unitCost = num(poItem.unit_cost);
    const pendingNoteQty = Math.max(0, noted - notedReceived);
    const openForLine = openReports.some((report) => (report.items || []).some((item) => String(item.variant_id) === key));
    const flags = [];
    if (invoicePrices.some((price) => Math.abs(price - unitCost) > 0.005)) flags.push("PRICE_MISMATCH");
    if (invoiced > ordered) flags.push("OVER_INVOICED");
    if (openForLine) flags.push("OPEN_DISCREPANCY");
    // Informational: physical deviations are tracked (and closed) through discrepancy reports.
    if (delivered < notedReceived) flags.push("DELIVERED_LESS_THAN_NOTE");
    if (delivered > notedReceived) flags.push("DELIVERED_MORE_THAN_NOTE");
    if (damaged > 0) flags.push("DAMAGED");
    if (rejected > 0) flags.push("REJECTED");
    if (accepted > invoiced) flags.push("GOODS_WITHOUT_INVOICE");
    if (invoiced > noted) flags.push("INVOICE_WITHOUT_DELIVERY_NOTE");
    if (invoiced > accepted && invoiced <= noted) flags.push(pendingNoteQty > 0 ? "INVOICED_NOT_YET_RECEIVED" : "INVOICE_EXCEEDS_ACCEPTED");
    if (noted < ordered) flags.push("PENDING_DELIVERY");

    let status;
    if (flags.includes("PRICE_MISMATCH") || flags.includes("OVER_INVOICED") || openForLine) status = RESULT.DISCREPANCY;
    else if (flags.includes("GOODS_WITHOUT_INVOICE") || flags.includes("INVOICE_WITHOUT_DELIVERY_NOTE") || (invoiced === 0 && noted === 0)) status = RESULT.PENDING_DOCUMENT;
    else if (flags.includes("INVOICE_EXCEEDS_ACCEPTED")) status = RESULT.NEEDS_REVIEW;
    else if (ordered === invoiced && invoiced === accepted) status = RESULT.MATCHED;
    else status = RESULT.PARTIALLY_MATCHED;

    return {
      purchase_order_item_id: poItem.id,
      variant_id: poItem.variant_id,
      title: poItem.title || null,
      isbn13: poItem.isbn13 || null,
      ordered_qty: ordered,
      po_unit_cost: unitCost,
      invoiced_qty: invoiced,
      invoice_unit_prices: invoicePrices,
      delivery_note_qty: noted,
      delivered_qty: delivered,
      accepted_qty: accepted,
      damaged_qty: damaged,
      rejected_qty: rejected,
      remaining_to_receive_qty: Math.max(0, ordered - accepted),
      flags,
      status,
    };
  });

  const invoiceChecks = invoices.map((doc) => ({
    document_id: doc.id,
    document_number: doc.document_number,
    external_number: doc.external_number,
    issues: checkInvoiceHeader(doc),
  }));


  const deliveries = deliveryNotes.map((note) => {
    const noteReceipts = receipts.filter((receipt) => String(receipt.supplier_delivery_invoice_id) === String(note.id));
    const posted = noteReceipts.filter((receipt) => receipt.status === "POSTED");
    const noteQty = (note.items || []).reduce((sum, item) => sum + num(item.invoiced_qty), 0);
    const postedItems = posted.flatMap((receipt) => receipt.items || []);
    return {
      delivery_id: note.id,
      document_number: note.delivery_number || note.invoice_number,
      delivery_note_qty: noteQty,
      delivered_qty: postedItems.reduce((sum, item) => sum + (item.delivered_qty != null ? num(item.delivered_qty) : num(item.quantity)), 0),
      accepted_qty: postedItems.reduce((sum, item) => sum + num(item.quantity), 0),
      damaged_qty: postedItems.reduce((sum, item) => sum + num(item.damaged_qty), 0),
      rejected_qty: postedItems.reduce((sum, item) => sum + num(item.rejected_qty), 0),
      goods_receipts: noteReceipts.map((receipt) => ({ id: receipt.id, receipt_number: receipt.receipt_number, status: receipt.status })),
      status: posted.length === 0 ? "NOT_RECEIVED" : "RECEIVED",
    };
  });

  const lineStatuses = lines.map((line) => line.status);
  const headerIssues = invoiceChecks.some((check) => check.issues.length > 0);

  let status;
  if (invoices.length === 0 && deliveryNotes.length === 0) status = RESULT.PENDING_DOCUMENT;
  else if (openReports.length > 0 || lineStatuses.includes(RESULT.DISCREPANCY)) status = RESULT.DISCREPANCY;
  else if (headerIssues || lineStatuses.includes(RESULT.NEEDS_REVIEW)) status = RESULT.NEEDS_REVIEW;
  else if (lineStatuses.includes(RESULT.PENDING_DOCUMENT)) status = RESULT.PENDING_DOCUMENT;
  else if (lineStatuses.every((s) => s === RESULT.MATCHED)) status = RESULT.MATCHED;
  else status = RESULT.PARTIALLY_MATCHED;

  const totals = lines.reduce((acc, line) => {
    acc.ordered_qty += line.ordered_qty;
    acc.invoiced_qty += line.invoiced_qty;
    acc.delivery_note_qty += line.delivery_note_qty;
    acc.delivered_qty += line.delivered_qty;
    acc.accepted_qty += line.accepted_qty;
    acc.damaged_qty += line.damaged_qty;
    acc.rejected_qty += line.rejected_qty;
    acc.remaining_to_receive_qty += line.remaining_to_receive_qty;
    return acc;
  }, { ordered_qty: 0, invoiced_qty: 0, delivery_note_qty: 0, delivered_qty: 0, accepted_qty: 0, damaged_qty: 0, rejected_qty: 0, remaining_to_receive_qty: 0 });

  const invoicedAmount = invoices.reduce((sum, doc) => sum + num(doc.total_amount), 0);

  return {
    status,
    can_complete_without_exception: status === RESULT.MATCHED,
    totals: { ...totals, invoice_count: invoices.length, delivery_count: deliveryNotes.length, invoiced_total_amount: invoicedAmount, open_discrepancy_count: openReports.length },
    lines,
    invoices: invoiceChecks,
    deliveries,
  };
}

module.exports = { buildDocumentReconciliation, RESULT, INVOICE_TYPES };
