// A title borrowed at a warehouse in the last 30 days but with no stock row
// there is OUT_OF_STOCK at that warehouse (it used to be absent from the list).
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const HCM = '11111111-1111-4111-8111-111111111111';
const fixture = { stock: [], pairs: [], active: [] };

const dbPath = path.join(__dirname, '..', 'src', 'lib', 'db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    inventoryPool: 'inventory',
    borrowPool: 'borrow',
    async query(pool, text) {
      if (text.includes('FROM warehouses w')) return fixture.stock;
      if (text.includes('SELECT DISTINCT lt.warehouse_id')) return fixture.pairs;
      if (text.includes('WHERE bv.id = ANY($1::uuid[]) AND bv.is_active')) return fixture.active.map((id) => ({ id }));
      if (text.includes('FROM book_variants')) return [{ variant_id: 'v-dune', title: 'Dune' }, { variant_id: 'v-a', title: 'A' }];
      return [];
    },
    async queryOne() { return null; },
    async pingDatabases() { return { inventory: true, borrow: true }; },
  },
};

const { getWarehouseStockItems } = require('../src/controllers/analytics.controller');

function call(query) {
  return new Promise((resolve, reject) => {
    getWarehouseStockItems({ query, warehouseScope: null, user: null, headers: {} },
      { json: (body) => resolve(body.data) }, reject);
  });
}

const row = (variant_id, available) => ({ warehouse_id: HCM, warehouse_name: 'Kho HCM', warehouse_code: 'WH-HCM-01', variant_id,
  available_qty: available, on_hand_qty: available, reserved_qty: 0, borrowed_qty: 0, reorder_point: 0 });

test('a borrowed title with no stock row is out of stock at that warehouse', async () => {
  fixture.stock = [row('v-a', 20)];
  fixture.pairs = [{ warehouse_id: HCM, variant_id: 'v-dune' }, { warehouse_id: HCM, variant_id: 'v-a' }];
  fixture.active = ['v-dune'];
  const data = await call({ warehouseId: HCM, status: 'ATTENTION' });
  assert.deepEqual(data.items.map((i) => [i.variant_id, i.status, i.available_qty]), [['v-dune', 'OUT_OF_STOCK', 0]]);
  assert.equal(data.counts.out_of_stock, 1);
});

test('inactive titles and warehouses outside the result are not added', async () => {
  fixture.stock = [row('v-a', 20)];
  fixture.pairs = [{ warehouse_id: HCM, variant_id: 'v-dune' }, { warehouse_id: 'other', variant_id: 'v-x' }];
  fixture.active = [];
  const data = await call({ warehouseId: HCM, status: 'ATTENTION' });
  assert.deepEqual(data.items, []);
});
