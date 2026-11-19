const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeDb, installFakePrisma, createFakeRes } = require('./helpers/procurement-fake-db');
const db = createFakeDb({
  purchase_orders: [{ id: 'po', warehouse_id: 'wh', status: 'PARTIALLY_RECEIVED' }],
  purchase_order_items: [{ id: 'line', purchase_order_id: 'po', ordered_qty: 100, received_qty: 50, closure_status: 'OPEN' }],
  supplier_delivery_invoices: [{ id: 'delivery', purchase_order_id: 'po', status: 'SUBMITTED' }],
  supplier_delivery_invoice_items: [{ id: 'delivery-line', invoice_id: 'delivery', purchase_order_item_id: 'line', invoiced_qty: 50 }],
});
const client = new Proxy(db.client, { get(target, key) {
  if (key === '$transaction') return async callback => callback(client);
  if (key === '$queryRawUnsafe') return async () => [];
  return target[key];
} });
installFakePrisma(client);
require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({ canWrite: async () => true });
const { closeRemainingLine } = require('../src/controllers/purchase-order-line-closure.controller');
async function close() {
  const res = createFakeRes();
  await closeRemainingLine({ params: { id: 'po', itemId: 'line' }, user: { id: 'manager' }, body: { reason: 'Supplier cannot deliver more' } }, res);
  return res;
}
test('SB15: cannot close a PO line while its declared delivery has not been processed', async () => {
  const res = await close();
  assert.equal(res.statusCode, 409);
  assert.equal(db.table('purchase_order_items')[0].closure_status, 'OPEN');
  assert.equal(db.table('inventory_audit_logs').length, 0);
});
test('SB15: a processed short delivery does not prevent closing its remaining quantity', async () => {
  db.table('purchase_order_items')[0].closure_status = 'OPEN';
  db.table('supplier_delivery_invoices')[0].status = 'SHORTAGE_REPORTED';
  const res = await close();
  assert.equal(res.statusCode, 200);
  assert.equal(db.table('purchase_order_items')[0].closure_status, 'CLOSED_WITH_REMAINING');
});
