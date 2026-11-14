const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDocumentReconciliation, RESULT } = require('../src/services/procurement-reconciliation.service');

const PO_ITEMS = [{ id: 'poi-1', variant_id: 'v1', title: 'Sách A', ordered_qty: 100, unit_cost: 50000 }];

function invoice(id, qty, price = 50000, extra = {}) {
  return {
    id,
    document_number: `INV-${id}`,
    external_number: id,
    document_type: 'VAT_INVOICE',
    status: 'ISSUED',
    subtotal_amount: qty * price,
    tax_amount: 0,
    total_amount: qty * price,
    lines: [{ purchase_order_item_id: 'poi-1', variant_id: 'v1', quantity: qty, unit_price: price }],
    ...extra,
  };
}
function note(id, qty) {
  return { id, invoice_number: id, delivery_number: id, items: [{ purchase_order_item_id: 'poi-1', variant_id: 'v1', invoiced_qty: qty }] };
}
function receipt(id, noteId, accepted, { delivered = accepted, damaged = 0, rejected = 0, status = 'POSTED' } = {}) {
  return { id, receipt_number: id, status, supplier_delivery_invoice_id: noteId, items: [{ variant_id: 'v1', quantity: accepted, delivered_qty: delivered, damaged_qty: damaged, rejected_qty: rejected }] };
}
const openReport = { id: 'rep-1', status: 'OPEN', items: [{ variant_id: 'v1' }] };
const resolvedReport = { id: 'rep-1', status: 'RESOLVED', items: [{ variant_id: 'v1' }] };

test('PO 100 = invoice 100 = delivery 100 = GRN 100 -> MATCHED and can be completed', () => {
  const r = buildDocumentReconciliation({ poItems: PO_ITEMS, documents: [invoice('i1', 100)], deliveryNotes: [note('d1', 100)], receipts: [receipt('g1', 'd1', 100)] });
  assert.equal(r.status, RESULT.MATCHED);
  assert.equal(r.can_complete_without_exception, true);
  assert.equal(r.lines[0].status, RESULT.MATCHED);
});

test('invoice 100, delivery 98 (short, report open) -> DISCREPANCY', () => {
  const r = buildDocumentReconciliation({
    poItems: PO_ITEMS,
    documents: [invoice('i1', 100)],
    deliveryNotes: [note('d1', 100)],
    receipts: [receipt('g1', 'd1', 98, { delivered: 98 })],
    discrepancyReports: [openReport],
  });
  assert.equal(r.status, RESULT.DISCREPANCY);
  assert.ok(r.lines[0].flags.includes('DELIVERED_LESS_THAN_NOTE'));
  assert.equal(r.lines[0].remaining_to_receive_qty, 2);
});

test('invoice 100, delivery 100, accepted 95 (5 damaged) -> DISCREPANCY; invoice is never rewritten', () => {
  const inv = invoice('i1', 100);
  const r = buildDocumentReconciliation({
    poItems: PO_ITEMS,
    documents: [inv],
    deliveryNotes: [note('d1', 100)],
    receipts: [receipt('g1', 'd1', 95, { delivered: 100, damaged: 5 })],
    discrepancyReports: [openReport],
  });
  assert.equal(r.status, RESULT.DISCREPANCY);
  assert.equal(r.lines[0].invoiced_qty, 100);
  assert.equal(r.lines[0].accepted_qty, 95);
  assert.equal(r.lines[0].damaged_qty, 5);
  assert.equal(inv.lines[0].quantity, 100, 'source invoice untouched');
});

test('PO 100, invoice 100, GRN 95 with the discrepancy closed as accepted loss -> NEEDS_REVIEW (invoice must be adjusted)', () => {
  const r = buildDocumentReconciliation({
    poItems: PO_ITEMS,
    documents: [invoice('i1', 100)],
    deliveryNotes: [note('d1', 100)],
    receipts: [receipt('g1', 'd1', 95, { delivered: 100, damaged: 5 })],
    discrepancyReports: [resolvedReport],
  });
  assert.equal(r.status, RESULT.NEEDS_REVIEW);
  assert.ok(r.lines[0].flags.includes('INVOICE_EXCEEDS_ACCEPTED'));
  assert.equal(r.can_complete_without_exception, false);
});

test('discrepancy resolved by redelivery -> MATCHED across two deliveries', () => {
  const r = buildDocumentReconciliation({
    poItems: PO_ITEMS,
    documents: [invoice('i1', 100)],
    deliveryNotes: [note('d1', 100), note('d2', 2)],
    receipts: [receipt('g1', 'd1', 98, { delivered: 98 }), receipt('g2', 'd2', 2)],
    discrepancyReports: [resolvedReport],
  });
  assert.equal(r.status, RESULT.MATCHED);
  assert.equal(r.deliveries.length, 2);
  assert.deepEqual(r.deliveries.map((d) => d.accepted_qty), [98, 2]);
});

test('one PO, several invoices and several deliveries -> totals per line; partial so far = PARTIALLY_MATCHED', () => {
  const partial = buildDocumentReconciliation({
    poItems: PO_ITEMS,
    documents: [invoice('i1', 60)],
    deliveryNotes: [note('d1', 60)],
    receipts: [receipt('g1', 'd1', 60)],
  });
  assert.equal(partial.status, RESULT.PARTIALLY_MATCHED);

  const full = buildDocumentReconciliation({
    poItems: PO_ITEMS,
    documents: [invoice('i1', 60), invoice('i2', 40)],
    deliveryNotes: [note('d1', 60), note('d2', 40)],
    receipts: [receipt('g1', 'd1', 60), receipt('g2', 'd2', 40)],
  });
  assert.equal(full.status, RESULT.MATCHED);
  assert.equal(full.totals.invoice_count, 2);
  assert.equal(full.totals.delivery_count, 2);
  assert.equal(full.lines[0].invoiced_qty, 100);
});

test('invoice price differs from the PO price -> DISCREPANCY (PRICE_MISMATCH)', () => {
  const r = buildDocumentReconciliation({ poItems: PO_ITEMS, documents: [invoice('i1', 100, 52000)], deliveryNotes: [note('d1', 100)], receipts: [receipt('g1', 'd1', 100)] });
  assert.equal(r.status, RESULT.DISCREPANCY);
  assert.ok(r.lines[0].flags.includes('PRICE_MISMATCH'));
});

test('goods received but no invoice issued yet -> PENDING_DOCUMENT', () => {
  const r = buildDocumentReconciliation({ poItems: PO_ITEMS, documents: [], deliveryNotes: [note('d1', 100)], receipts: [receipt('g1', 'd1', 100)] });
  assert.equal(r.status, RESULT.PENDING_DOCUMENT);
  assert.ok(r.lines[0].flags.includes('GOODS_WITHOUT_INVOICE'));
});

test('invoice issued but no delivery note yet -> PENDING_DOCUMENT', () => {
  const r = buildDocumentReconciliation({ poItems: PO_ITEMS, documents: [invoice('i1', 100)], deliveryNotes: [], receipts: [] });
  assert.equal(r.status, RESULT.PENDING_DOCUMENT);
  assert.ok(r.lines[0].flags.includes('INVOICE_WITHOUT_DELIVERY_NOTE'));
});

test('draft, cancelled, superseded and proforma invoices never count as invoiced quantity', () => {
  const r = buildDocumentReconciliation({
    poItems: PO_ITEMS,
    documents: [
      invoice('draft', 100, 50000, { status: 'DRAFT' }),
      invoice('cancelled', 100, 50000, { status: 'CANCELLED' }),
      invoice('old', 100, 50000, { status: 'SUPERSEDED' }),
      invoice('pro', 100, 50000, { document_type: 'PROFORMA_INVOICE' }),
    ],
    deliveryNotes: [note('d1', 100)],
    receipts: [receipt('g1', 'd1', 100)],
  });
  assert.equal(r.lines[0].invoiced_qty, 0);
  assert.equal(r.status, RESULT.PENDING_DOCUMENT);
});

test('invoice header that does not add up -> NEEDS_REVIEW', () => {
  const r = buildDocumentReconciliation({
    poItems: PO_ITEMS,
    documents: [invoice('i1', 100, 50000, { total_amount: 4000000 })],
    deliveryNotes: [note('d1', 100)],
    receipts: [receipt('g1', 'd1', 100)],
  });
  assert.equal(r.status, RESULT.NEEDS_REVIEW);
  assert.deepEqual(r.invoices[0].issues, ['TOTAL_NOT_EQUAL_SUBTOTAL_PLUS_TAX']);
});

test('draft (unposted) receipts do not count as accepted', () => {
  const r = buildDocumentReconciliation({ poItems: PO_ITEMS, documents: [invoice('i1', 100)], deliveryNotes: [note('d1', 100)], receipts: [receipt('g1', 'd1', 100, { status: 'DRAFT' })] });
  assert.equal(r.lines[0].accepted_qty, 0);
  assert.equal(r.status, RESULT.PARTIALLY_MATCHED);
  assert.equal(r.deliveries[0].status, 'NOT_RECEIVED');
});

test('nothing exchanged yet -> PENDING_DOCUMENT', () => {
  assert.equal(buildDocumentReconciliation({ poItems: PO_ITEMS }).status, RESULT.PENDING_DOCUMENT);
});
