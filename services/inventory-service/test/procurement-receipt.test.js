const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeLineOutcome,
  buildDiscrepancyLines,
  summarizeDiscrepancyType,
  settleSupplierReceiptQuantities,
  recordSupplierReceiptOutcome,
  revertSupplierReceiptOutcome,
  ProcurementError,
} = require('../src/services/procurement-receipt.service');
const { createFakeDb } = require('./helpers/procurement-fake-db');

// ── Pure line rules ─────────────────────────────────────────────────────────

test('full delivery: everything delivered is accepted', () => {
  const o = computeLineOutcome({ noteQty: 100, poRemainingQty: 100, delivered: 100 });
  assert.deepEqual(o, { delivered: 100, damaged: 0, rejected: 0, accepted: 100, missing: 0, overage: 0 });
});

test('spec example: note 100, 98 arrive, 3 damaged -> GRN 95, 3 damaged, 2 missing (never 100)', () => {
  const o = computeLineOutcome({ noteQty: 100, poRemainingQty: 100, delivered: 98, damaged: 3 });
  assert.equal(o.accepted, 95);
  assert.equal(o.damaged, 3);
  assert.equal(o.missing, 2);
  assert.equal(o.overage, 0);
});

test('short delivery: invoice/note 100, delivered 98 -> accepted 98, missing 2', () => {
  const o = computeLineOutcome({ noteQty: 100, poRemainingQty: 100, delivered: 98 });
  assert.equal(o.accepted, 98);
  assert.equal(o.missing, 2);
});

test('over delivery: 105 against a note of 100 must reject the 5 extra', () => {
  assert.throws(() => computeLineOutcome({ noteQty: 100, poRemainingQty: 100, delivered: 105 }), (error) => {
    assert.ok(error instanceof ProcurementError);
    assert.equal(error.code, 'OVERAGE_NOT_REJECTED');
    return true;
  });
  const o = computeLineOutcome({ noteQty: 100, poRemainingQty: 100, delivered: 105, rejected: 5 });
  assert.equal(o.accepted, 100);
  assert.equal(o.overage, 5);
});

test('cannot accept more than the approved remaining PO quantity without an exception', () => {
  assert.throws(
    () => computeLineOutcome({ noteQty: 60, poRemainingQty: 40, delivered: 60 }),
    (error) => error.code === 'OVER_APPROVED_QUANTITY',
  );
  // Rejecting the excess keeps it inside the approved quantity.
  assert.equal(computeLineOutcome({ noteQty: 60, poRemainingQty: 40, delivered: 60, rejected: 20 }).accepted, 40);
});

test('damaged + rejected cannot exceed what physically arrived; quantities must be non-negative integers', () => {
  assert.throws(() => computeLineOutcome({ noteQty: 10, poRemainingQty: 10, delivered: 5, damaged: 4, rejected: 2 }), ProcurementError);
  assert.throws(() => computeLineOutcome({ noteQty: 10, poRemainingQty: 10, delivered: -1 }), ProcurementError);
  assert.throws(() => computeLineOutcome({ noteQty: 10, poRemainingQty: 10, delivered: 2.5 }), ProcurementError);
});

test('discrepancy lines split missing / damaged / overage / other rejections without double counting', () => {
  const lines = buildDiscrepancyLines([
    { purchase_order_item_id: 'poi-1', variant_id: 'v1', ordered_qty: 100, received_qty_after: 95, note_qty: 100, delivered: 98, damaged: 3, rejected: 0, overage: 0, missing: 2 },
    { purchase_order_item_id: 'poi-2', variant_id: 'v2', ordered_qty: 50, received_qty_after: 50, note_qty: 50, delivered: 53, damaged: 0, rejected: 4, overage: 3, missing: 0 },
  ]);
  const summary = lines.map((line) => [line.variant_id, line.discrepancy_type, line.shortage_qty]);
  assert.deepEqual(summary, [
    ['v1', 'SHORTAGE', 2],
    ['v1', 'DAMAGED', 3],
    ['v2', 'OVERAGE', 3],
    ['v2', 'REJECTED', 1],
  ]);
  assert.equal(summarizeDiscrepancyType(lines), 'MIXED');
  assert.equal(summarizeDiscrepancyType([{ discrepancy_type: 'SHORTAGE' }]), 'SHORTAGE');
  assert.equal(summarizeDiscrepancyType([]), null);
});

// ── Posting with a fake database ───────────────────────────────────────────

function seedPostingDb({ received = 0, item = {}, noteQty = 100, ordered = 100 } = {}) {
  return createFakeDb({
    purchase_order_items: [{ id: 'poi-1', purchase_order_id: 'po-1', variant_id: 'v1', ordered_qty: ordered, received_qty: received, unit_cost: 50000 }],
    supplier_delivery_invoices: [{ id: 'dn-1', purchase_order_id: 'po-1', supplier_id: 'sup-1', invoice_number: 'DN-001', status: 'SUBMITTED' }],
    supplier_delivery_invoice_items: [{ id: 'dni-1', invoice_id: 'dn-1', purchase_order_item_id: 'poi-1', variant_id: 'v1', invoiced_qty: noteQty, delivered_qty: null, accepted_qty: 0 }],
    goods_receipts: [{ id: 'gr-1', receipt_number: 'GR-1', purchase_order_id: 'po-1', supplier_delivery_invoice_id: 'dn-1', source_type: 'SUPPLIER_INVOICE', status: 'POSTED' }],
    goods_receipt_items: [{ id: 'gri-1', goods_receipt_id: 'gr-1', variant_id: 'v1', quantity: 100, actual_quantity: null, delivered_qty: 100, damaged_qty: 0, rejected_qty: 0, ...item }],
  });
}

test('posting uses the staff count: 98 counted, 3 damaged -> the GRN line becomes 95 before stock posting', async () => {
  const { client, table } = seedPostingDb({ item: { actual_quantity: 98, damaged_qty: 3 } });
  const receipt = table('goods_receipts')[0];
  const outcomes = await settleSupplierReceiptQuantities(client, receipt);
  assert.equal(table('goods_receipt_items')[0].quantity, 95, 'only accepted copies reach stock');
  assert.equal(table('goods_receipt_items')[0].delivered_qty, 98);
  assert.equal(outcomes[0].missing, 2);

  // Existing posting flow would now increment received_qty by 95; simulate it.
  table('purchase_order_items')[0].received_qty = 95;
  const { discrepancyReport } = await recordSupplierReceiptOutcome(client, receipt, outcomes, 'user-1');
  assert.ok(discrepancyReport);
  assert.equal(discrepancyReport.discrepancy_type, 'MIXED');
  const items = table('supplier_shortage_report_items');
  assert.deepEqual(items.map((i) => [i.discrepancy_type, i.shortage_qty]), [['SHORTAGE', 2], ['DAMAGED', 3]]);
  assert.equal(table('supplier_delivery_invoice_items')[0].accepted_qty, 95);
  assert.equal(table('supplier_delivery_invoice_items')[0].delivered_qty, 98);
  assert.equal(table('supplier_delivery_invoices')[0].status, 'SHORTAGE_REPORTED');
  assert.ok(table('inventory_audit_logs').some((log) => log.action_name === 'SUPPLIER_DISCREPANCY_REPORTED'));
});

test('a clean delivery records no discrepancy and marks the delivery note RECEIVED', async () => {
  const { client, table } = seedPostingDb();
  const receipt = table('goods_receipts')[0];
  const outcomes = await settleSupplierReceiptQuantities(client, receipt);
  table('purchase_order_items')[0].received_qty = 100;
  const { discrepancyReport } = await recordSupplierReceiptOutcome(client, receipt, outcomes, 'user-1');
  assert.equal(discrepancyReport, null);
  assert.equal(table('supplier_shortage_reports').length, 0);
  assert.equal(table('supplier_delivery_invoices')[0].status, 'RECEIVED');
});

test('posting refuses a count above the approved remaining quantity (no stock posted)', async () => {
  const { client, table } = seedPostingDb({ received: 60, noteQty: 100, item: { quantity: 40, delivered_qty: 40, actual_quantity: 100 } });
  await assert.rejects(settleSupplierReceiptQuantities(client, table('goods_receipts')[0]), (error) => error.code === 'OVERAGE_NOT_REJECTED' || error.code === 'OVER_APPROVED_QUANTITY');
});

test('a second delivery that makes the PO whole closes the earlier shortage, but never an overage report', async () => {
  const { client, table } = seedPostingDb({ received: 98, noteQty: 2, item: { quantity: 2, delivered_qty: 2 } });
  table('supplier_shortage_reports').push(
    { id: 'rep-short', purchase_order_id: 'po-1', status: 'ACKNOWLEDGED', discrepancy_type: 'SHORTAGE' },
    { id: 'rep-over', purchase_order_id: 'po-1', status: 'OPEN', discrepancy_type: 'OVERAGE' },
  );
  table('supplier_shortage_report_items').push(
    { id: 'ri-1', shortage_report_id: 'rep-short', purchase_order_item_id: 'poi-1', variant_id: 'v1', discrepancy_type: 'SHORTAGE', shortage_qty: 2 },
    { id: 'ri-2', shortage_report_id: 'rep-over', purchase_order_item_id: 'poi-1', variant_id: 'v1', discrepancy_type: 'OVERAGE', shortage_qty: 5 },
  );
  const receipt = table('goods_receipts')[0];
  const outcomes = await settleSupplierReceiptQuantities(client, receipt);
  table('purchase_order_items')[0].received_qty = 100;
  await recordSupplierReceiptOutcome(client, receipt, outcomes, 'user-1');
  const byId = Object.fromEntries(table('supplier_shortage_reports').map((r) => [r.id, r]));
  assert.equal(byId['rep-short'].status, 'RESOLVED');
  assert.equal(byId['rep-short'].resolution_action, 'REDELIVERED');
  assert.equal(byId['rep-over'].status, 'OPEN', 'overage needs a person (return), never auto-closed');
});

test('cancelling a posted supplier receipt reopens the delivery note and voids its discrepancy report', async () => {
  const { client, table } = seedPostingDb();
  table('supplier_delivery_invoices')[0].status = 'SHORTAGE_REPORTED';
  table('supplier_delivery_invoice_items')[0].accepted_qty = 95;
  table('supplier_shortage_reports').push({ id: 'rep-1', purchase_order_id: 'po-1', goods_receipt_id: 'gr-1', status: 'OPEN' });
  await revertSupplierReceiptOutcome(client, table('goods_receipts')[0], 'user-1');
  assert.equal(table('supplier_delivery_invoices')[0].status, 'SUBMITTED');
  assert.equal(table('supplier_delivery_invoice_items')[0].accepted_qty, 0);
  assert.equal(table('supplier_shortage_reports')[0].status, 'CANCELLED');
});
