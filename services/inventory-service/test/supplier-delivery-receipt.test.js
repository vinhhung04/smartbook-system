// Creating a goods receipt (GRN draft) from a supplier delivery note.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:1';

const { createFakeDb, installFakePrisma, createFakeRes } = require('./helpers/procurement-fake-db');

const WH = '33333333-3333-4333-8333-333333333333';
const MANAGER = '66666666-6666-4666-8666-666666666666';

const db = createFakeDb({
  purchase_orders: [{ id: 'po-1', po_number: 'PO-1', supplier_id: 'sup-1', warehouse_id: WH, status: 'SUPPLIER_CONFIRMED' }],
  purchase_order_items: [
    { id: 'poi-1', purchase_order_id: 'po-1', variant_id: 'v1', ordered_qty: 100, received_qty: 0, unit_cost: 50000 },
    { id: 'poi-2', purchase_order_id: 'po-1', variant_id: 'v2', ordered_qty: 10, received_qty: 0, unit_cost: 20000 },
  ],
  supplier_delivery_invoices: [
    { id: 'dn-1', purchase_order_id: 'po-1', supplier_id: 'sup-1', invoice_number: 'DN-1', status: 'SUBMITTED' },
    { id: 'dn-2', purchase_order_id: 'po-1', supplier_id: 'sup-1', invoice_number: 'DN-2', status: 'SUBMITTED' },
  ],
  supplier_delivery_invoice_items: [
    { id: 'dni-1', invoice_id: 'dn-1', purchase_order_item_id: 'poi-1', variant_id: 'v1', invoiced_qty: 100, unit_cost: 50000 },
    { id: 'dni-2', invoice_id: 'dn-2', purchase_order_item_id: 'poi-2', variant_id: 'v2', invoiced_qty: 10, unit_cost: 20000 },
  ],
  goods_receipts: [],
  goods_receipt_items: [],
  locations: [],
});
installFakePrisma(db.client);
let permissionChecks = 0;
let revokeAfter = Infinity;

require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({
  resolve: async () => ({ all: false, read: new Set([WH]), write: new Set([WH]) }),
  canRead: async (_u, id) => id === WH,
  canWrite: async (u, id) => ++permissionChecks <= revokeAfter && u.id === MANAGER && id === WH,
});

const { createGoodsReceiptFromInvoice } = require('../src/controllers/supplier-delivery.controller');

const manager = { id: MANAGER, roles: ['MANAGER'], permissions: ['inventory.operation.decide'] };

async function create(deliveryId, items, { key } = {}) {
  const res = createFakeRes();
  await createGoodsReceiptFromInvoice({
    params: { id: deliveryId },
    user: manager,
    body: { warehouse_id: WH, items },
    get: (name) => (name === 'Idempotency-Key' ? key : undefined),
  }, res);
  return res;
}

test('98 of 100 arrive, 3 damaged: the draft GRN accepts 95 and records delivered/damaged separately', async () => {
  const res = await create('dn-1', [{ invoice_item_id: 'dni-1', delivered_qty: 98, damaged_qty: 3 }], { key: 'retry-key-1' });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const [item] = db.table('goods_receipt_items');
  assert.equal(item.quantity, 95);
  assert.equal(item.delivered_qty, 98);
  assert.equal(item.damaged_qty, 3);
  assert.equal(db.table('goods_receipts')[0].status, 'DRAFT');
  // Nothing posted / no discrepancy yet: that happens at posting from the final count.
  assert.equal(db.table('purchase_order_items')[0].received_qty, 0);
  assert.equal(db.table('supplier_shortage_reports').length, 0);
});

test('retrying with the same Idempotency-Key returns the same GRN instead of a second one', async () => {
  const res = await create('dn-1', [{ invoice_item_id: 'dni-1', delivered_qty: 98, damaged_qty: 3 }], { key: 'retry-key-1' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.idempotent, true);
  assert.equal(db.table('goods_receipts').length, 1);
});

test('a second GRN for the same delivery note (without the key) is refused with 409', async () => {
  const res = await create('dn-1', [{ invoice_item_id: 'dni-1', delivered_qty: 98 }]);
  assert.equal(res.statusCode, 409);
  assert.ok(res.body.existing_goods_receipt_id);
  assert.equal(db.table('goods_receipts').length, 1);
});

test('over-delivery must be rejected, never accepted beyond the delivery note / approved quantity', async () => {
  const over = await create('dn-2', [{ invoice_item_id: 'dni-2', delivered_qty: 12 }]);
  assert.equal(over.statusCode, 400);
  assert.match(over.body.message, /thừa/);
  const ok = await create('dn-2', [{ invoice_item_id: 'dni-2', delivered_qty: 12, rejected_qty: 2 }]);
  assert.equal(ok.statusCode, 201, JSON.stringify(ok.body));
  const item = db.table('goods_receipt_items').find((i) => i.variant_id === 'v2');
  assert.equal(item.quantity, 10);
  assert.equal(item.rejected_qty, 2);
});

test('a line from another delivery note is refused', async () => {
  db.table('goods_receipts').forEach((r) => { r.status = 'CANCELLED'; });
  const res = await create('dn-1', [{ invoice_item_id: 'dni-2', delivered_qty: 1 }]);
  assert.equal(res.statusCode, 400);
});

test('SB-16: every delivery-note line must have an explicit count, including zero', async () => {
  db.table('goods_receipts').forEach((r) => { r.status = 'CANCELLED'; });
  db.table('supplier_delivery_invoice_items').push({ id: 'dni-3', invoice_id: 'dn-1', purchase_order_item_id: 'poi-2', variant_id: 'v2', invoiced_qty: 10, unit_cost: 20000 });
  const incomplete = await create('dn-1', [{ invoice_item_id: 'dni-1', delivered_qty: 98 }]);
  assert.equal(incomplete.statusCode, 400, JSON.stringify(incomplete.body));
  const complete = await create('dn-1', [{ invoice_item_id: 'dni-1', delivered_qty: 98 }, { invoice_item_id: 'dni-3', delivered_qty: 0 }]);
  assert.equal(complete.statusCode, 201, JSON.stringify(complete.body));
  const lines = db.table('goods_receipt_items').filter((i) => i.goods_receipt_id === complete.body.data.id);
  assert.equal(lines.length, 2);
  assert.equal(lines.find((i) => i.variant_id === 'v2').quantity, 0);
});

test('SB-24: replay checks the actual receipt warehouse for the current actor', async () => {
  const res = createFakeRes();
  await createGoodsReceiptFromInvoice({ params: { id: 'dn-1' }, user: { ...manager, id: '77777777-7777-4777-8777-777777777777' }, body: { warehouse_id: WH, items: [{ invoice_item_id: 'dni-1', delivered_qty: 98 }] }, get: () => 'retry-key-1' }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.data, undefined);
});

test('SB-24: a simultaneous key collision for a different delivery cannot replay the winner', async () => {
  db.table('goods_receipts').forEach((r) => { r.status = 'CANCELLED'; });
  const responses = await Promise.all([
    create('dn-1', [{ invoice_item_id: 'dni-1', delivered_qty: 98 }, { invoice_item_id: 'dni-3', delivered_qty: 0 }], { key: 'collision-documents' }),
    create('dn-2', [{ invoice_item_id: 'dni-2', delivered_qty: 10 }], { key: 'collision-documents' }),
  ]);
  assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409]);
  assert.equal(responses.find((r) => r.statusCode === 409).body.data, undefined);
});

test('SB-24: unique-key recovery rechecks warehouse permission if access was revoked', async () => {
  db.table('goods_receipts').forEach((r) => { r.status = 'CANCELLED'; });
  permissionChecks = 0;
  revokeAfter = 2;
  try {
    const responses = await Promise.all([1, 2].map(() => create('dn-2', [{ invoice_item_id: 'dni-2', delivered_qty: 10 }], { key: 'collision-access' })));
    assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 403]);
    assert.equal(responses.find((r) => r.statusCode === 403).body.data, undefined);
  } finally { revokeAfter = Infinity; }
});
