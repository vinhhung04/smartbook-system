const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakeDb, installFakePrisma, createFakeRes } = require('./helpers/procurement-fake-db');
const db = createFakeDb({
  goods_receipts: [{ id: 'receipt', warehouse_id: 'wh', status: 'POSTED' }],
  stock_balances: [{ id: 'receiving-bal', variant_id: 'variant', location_id: 'receiving', on_hand_qty: 0, available_qty: 0, version: 1 }, { id: 'shelf-bal', variant_id: 'variant', location_id: 'shelf', on_hand_qty: 10, available_qty: 10, version: 1 }],
  stock_movements: [
    { id: 'inbound', variant_id: 'variant', to_location_id: 'receiving', quantity: 10, movement_type: 'INBOUND', reference_type: 'GOODS_RECEIPT', reference_id: 'receipt', reverted: false, metadata: { movement_bucket: 'RECEIVING_HOLD' } },
    { id: 'putaway', variant_id: 'variant', from_location_id: 'receiving', to_location_id: 'shelf', quantity: 10, movement_type: 'TRANSFER', movement_status: 'POSTED', reference_type: 'RECEIVING_SHELF_PUTAWAY', reference_id: 'receipt', reverted: false, metadata: { movement_bucket: 'PUTAWAY' } },
  ],
});
const client = new Proxy(db.client, { get(target, key) {
  if (key === '$transaction') return async callback => callback(client);
  if (key === '$queryRawUnsafe') return async () => [];
  if (key === 'stock_balances') return new Proxy(target[key], { get(model, method) {
    return async args => model[method]({ ...args, where: args.where?.variant_id_location_id || args.where });
  } });
  return target[key];
} });
installFakePrisma(client);
require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({ canWrite: async () => true });
const { updateGoodsReceipt } = require('../src/controllers/goods-receipt.controller');
test('SB14: cancelling a putaway GRN reverses shelf transfer before original receiving inbound', async () => {
  const res = createFakeRes();
  await updateGoodsReceipt({ params: { id: 'receipt' }, user: { id: 'manager', is_superuser: true }, body: { status: 'CANCELLED' } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(db.table('stock_balances').find(b => b.id === 'receiving-bal').on_hand_qty, 0);
  assert.equal(db.table('stock_balances').find(b => b.id === 'shelf-bal').on_hand_qty, 0);
  assert.equal(db.table('stock_balances').find(b => b.id === 'shelf-bal').available_qty, 0);
  assert.ok(db.table('stock_movements').every(m => m.reverted));
});
