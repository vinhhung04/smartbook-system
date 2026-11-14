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

require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({
  resolve: async () => ({ all: false, read: new Set([WH]), write: new Set([WH]) }),
  canRead: async (_u, id) => id === WH,
  canWrite: async (_u, id) => id === WH,
});

const { createGoodsReceiptFromInvoice } = require('../src/controllers/supplier-delivery.controller');

const manager = { id: MANAGER, roles: ['WAREHOUSE_MANAGER'], permissions: ['inventory.operation.decide'] };

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
