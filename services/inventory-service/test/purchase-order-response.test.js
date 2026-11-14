const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSupplierResponse, assertSupplierMayDeliver, recordFullAcceptance, ResponseError } = require('../src/services/purchase-order-response.service');
const { createFakeDb } = require('./helpers/procurement-fake-db');

const PO = {
  id: 'po-1',
  supplier_id: 'sup-1',
  purchase_order_items: [
    { id: 'poi-1', variant_id: 'v1', ordered_qty: 100, unit_cost: 50000 },
    { id: 'poi-2', variant_id: 'v2', ordered_qty: 20, unit_cost: 80000 },
  ],
};

test('accept everything as ordered: no variance, no review needed', () => {
  const r = buildSupplierResponse(PO, { decision: 'ACCEPTED' });
  assert.equal(r.decision, 'ACCEPTED');
  assert.equal(r.has_variance, false);
  assert.equal(r.review_status, 'NOT_REQUIRED');
  assert.deepEqual(r.lines.map((l) => l.confirmed_qty), [100, 20]);
});

test('partial acceptance keeps the original order and requires SmartBook review', () => {
  const r = buildSupplierResponse(PO, {
    decision: 'PARTIALLY_ACCEPTED',
    reason: 'Hết hàng một phần',
    lines: [{ purchase_order_item_id: 'poi-1', confirmed_qty: 80 }],
  });
  assert.equal(r.decision, 'PARTIALLY_ACCEPTED');
  assert.equal(r.has_variance, true);
  assert.equal(r.review_status, 'PENDING_REVIEW');
  const line = r.lines.find((l) => l.purchase_order_item_id === 'poi-1');
  assert.equal(line.ordered_qty, 100, 'original quantity preserved for history');
  assert.equal(line.confirmed_qty, 80);
});

test('a price change alone is still a variance needing approval', () => {
  const r = buildSupplierResponse(PO, { decision: 'ACCEPTED', lines: [{ purchase_order_item_id: 'poi-2', confirmed_unit_cost: 85000 }] });
  assert.equal(r.decision, 'ACCEPTED');
  assert.equal(r.has_variance, true);
  assert.equal(r.review_status, 'PENDING_REVIEW');
});

test('reject needs a reason; partial needs a reason; ACCEPTED cannot hide a reduced quantity', () => {
  assert.throws(() => buildSupplierResponse(PO, { decision: 'REJECTED' }), ResponseError);
  assert.equal(buildSupplierResponse(PO, { decision: 'REJECTED', reason: 'Ngừng phân phối' }).decision, 'REJECTED');
  assert.throws(() => buildSupplierResponse(PO, { decision: 'PARTIALLY_ACCEPTED', lines: [{ purchase_order_item_id: 'poi-1', confirmed_qty: 10 }] }), ResponseError);
  assert.throws(() => buildSupplierResponse(PO, { decision: 'ACCEPTED', lines: [{ purchase_order_item_id: 'poi-1', confirmed_qty: 10 }] }), ResponseError);
});

test('supplier cannot confirm more than ordered, zero everything, or answer for a line of another PO', () => {
  assert.throws(() => buildSupplierResponse(PO, { decision: 'ACCEPTED', lines: [{ purchase_order_item_id: 'poi-1', confirmed_qty: 120 }] }), ResponseError);
  assert.throws(() => buildSupplierResponse(PO, {
    decision: 'PARTIALLY_ACCEPTED', reason: 'x',
    lines: [{ purchase_order_item_id: 'poi-1', confirmed_qty: 0 }, { purchase_order_item_id: 'poi-2', confirmed_qty: 0 }],
  }), ResponseError);
  assert.throws(() => buildSupplierResponse(PO, { decision: 'ACCEPTED', lines: [{ purchase_order_item_id: 'other-po-line', confirmed_qty: 1 }] }), ResponseError);
});

test('supplier cannot ship while a change is pending review or after rejecting the PO', async () => {
  const { client } = createFakeDb({ purchase_order_supplier_responses: [{ id: 'r1', purchase_order_id: 'po-1', review_status: 'PENDING_REVIEW' }] });
  assert.equal((await assertSupplierMayDeliver(client, { id: 'po-1' })).statusCode, 409);
  assert.equal((await assertSupplierMayDeliver(client, { id: 'po-2', supplier_response_status: 'REJECTED' })).statusCode, 409);
  assert.equal(await assertSupplierMayDeliver(client, { id: 'po-2' }), null);
});

test('one-click acceptance records an ACCEPTED response and withdraws pending ones', async () => {
  const { client, table } = createFakeDb({ purchase_order_supplier_responses: [{ id: 'r1', purchase_order_id: 'po-1', review_status: 'PENDING_REVIEW' }] });
  await recordFullAcceptance(client, PO, 'user-sup');
  const rows = table('purchase_order_supplier_responses');
  assert.equal(rows.find((r) => r.id === 'r1').review_status, 'WITHDRAWN');
  const created = rows.find((r) => r.id !== 'r1');
  assert.equal(created.decision, 'ACCEPTED');
  assert.equal(created.has_variance, false);
});
