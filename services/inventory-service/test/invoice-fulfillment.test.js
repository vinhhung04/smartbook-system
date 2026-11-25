const test = require('node:test');
const assert = require('node:assert/strict');
const { computeInvoiceFulfillment, deliveryNoteStatus } = require('../src/services/invoice-fulfillment.service');

const invoice = (lines) => ({ procurement_document_lines: lines.map(([id, quantity]) => ({ purchase_order_item_id: id, quantity })) });
const note = (items, { posted = false, accepted = null, redelivery = false } = {}) => ({
  status: 'SUBMITTED',
  raw_payload: redelivery ? { redelivery: true } : {},
  goods_receipts: posted ? [{ status: 'POSTED' }] : [{ status: 'DRAFT' }],
  supplier_delivery_invoice_items: items.map(([id, qty], index) => ({
    purchase_order_item_id: id,
    invoiced_qty: qty,
    accepted_qty: posted ? (accepted ? accepted[index] : qty) : 0,
  })),
});

test('example 1/2: 5 of 10 shipped and confirmed, then the other 5', () => {
  const inv = invoice([['A', 10]]);
  const first = computeInvoiceFulfillment(inv, [note([['A', 5]], { posted: true })]);
  assert.equal(first.status, 'PARTIALLY_RECEIVED');
  assert.equal(first.received_qty, 5);
  assert.equal(first.missing_qty, 5);
  assert.equal(first.lines[0].remaining_to_ship_qty, 5);

  const done = computeInvoiceFulfillment(inv, [note([['A', 5]], { posted: true }), note([['A', 5]], { posted: true })]);
  assert.equal(done.status, 'RECEIVED');
  assert.equal(done.missing_qty, 0);
});

test('shipped but not confirmed by SmartBook is in transit, never received', () => {
  const result = computeInvoiceFulfillment(invoice([['A', 10]]), [note([['A', 5]])]);
  assert.equal(result.status, 'IN_TRANSIT');
  assert.equal(result.received_qty, 0);
  assert.equal(result.in_transit_qty, 5);
  assert.equal(result.missing_qty, 10);
  assert.equal(deliveryNoteStatus(note([['A', 5]])), 'IN_TRANSIT');
});

test('example 3: two books, two shipments, completed only when every line is full', () => {
  const inv = invoice([['A', 10], ['B', 6]]);
  const one = computeInvoiceFulfillment(inv, [note([['A', 4], ['B', 2]], { posted: true })]);
  assert.equal(one.status, 'PARTIALLY_RECEIVED');
  assert.deepEqual(one.lines.map((l) => l.missing_qty), [6, 4]);

  const two = computeInvoiceFulfillment(inv, [note([['A', 4], ['B', 2]], { posted: true }), note([['A', 6], ['B', 4]], { posted: true })]);
  assert.equal(two.status, 'RECEIVED');
  assert.deepEqual(two.lines.map((l) => [l.invoiced_qty, l.received_qty, l.missing_qty]), [[10, 10, 0], [6, 6, 0]]);
});

test('short receipt leaves a discrepancy; a redelivery note fills it without counting as new shipping', () => {
  const inv = invoice([['A', 10]]);
  const short = note([['A', 10]], { posted: true, accepted: [8] });
  const partial = computeInvoiceFulfillment(inv, [short]);
  assert.equal(partial.received_qty, 8);
  assert.equal(partial.discrepancy_qty, 2);
  assert.equal(partial.lines[0].remaining_to_ship_qty, 0);
  assert.equal(deliveryNoteStatus(short), 'PARTIALLY_RECEIVED');

  const fixed = computeInvoiceFulfillment(inv, [short, note([['A', 2]], { posted: true, redelivery: true })]);
  assert.equal(fixed.status, 'RECEIVED');
  assert.equal(fixed.shipped_qty, 10);
});
