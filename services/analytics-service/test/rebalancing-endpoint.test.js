// GET /analytics/rebalancing-plan through the real controller, with the
// database layer replaced by fixture rows that honour the warehouse filter the
// SQL asks for, and the auth-service scope replaced by a fake resolver.
// Covers the permission matrix: single warehouse, FULL + READ, no scope,
// forged / inactive / malformed warehouse ids, auth-service down.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { WarehouseScopeUnavailableError } = require('@smartbook/shared/warehouse-scope');

const HCM = '11111111-1111-4111-8111-111111111111';
const HN = '22222222-2222-4222-8222-222222222222';
const DN = '33333333-3333-4333-8333-333333333333';
const CT = '44444444-4444-4444-8444-444444444444';
const OLD = '55555555-5555-4555-8555-555555555555';

const fixture = {};
const sqlSeen = [];

function reset() {
  fixture.warehouses = [
    { id: HCM, code: 'WH-HCM-01', name: 'Kho HCM', is_active: true },
    { id: HN, code: 'WH-HN-01', name: 'Kho Ha Noi', is_active: true },
    { id: DN, code: 'WH-DN-01', name: 'Kho Da Nang', is_active: true },
    { id: CT, code: 'WH-CT-01', name: 'Kho Can Tho', is_active: true },
    { id: OLD, code: 'WH-OLD', name: 'Kho cu', is_active: false },
  ];
  const stock = (warehouse_id, variant_id, available, safety) => ({
    warehouse_id, variant_id, available_qty: available, on_hand_qty: available, reserved_qty: 0, borrowed_qty: 0,
    reorder_point: 0, safety_stock_qty: safety,
  });
  fixture.stock = [
    stock(HCM, 'v1', 0, 6), // short 6
    stock(HN, 'v1', 10, 2), // spare 8 (READ for the demo manager)
    stock(DN, 'v1', 3, 1), // spare 2
    stock(CT, 'v1', 50, 0), // out of every scope used here
  ];
  fixture.variants = [{ variant_id: 'v1', book_id: 'b1', title: 'Sách A', unit_cost: 80000 }];
  fixture.outgoing = [];
  sqlSeen.length = 0;
}

function inIds(rows, params) {
  const ids = new Set(params?.[0] || []);
  return rows.filter((r) => ids.has(r.warehouse_id));
}

const dbPath = path.join(__dirname, '..', 'src', 'lib', 'db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    inventoryPool: 'inventory',
    borrowPool: 'borrow',
    async query(pool, text, params) {
      sqlSeen.push({ text, params });
      if (text.includes('FROM warehouses')) return fixture.warehouses;
      if (text.includes('FROM stock_balances sb')) return inIds(fixture.stock, params);
      if (text.includes('WHERE bv.id = ANY')) return fixture.variants.filter((v) => params[0].includes(v.variant_id));
      if (text.includes('shipped_qty')) return inIds(fixture.outgoing, params);
      return [];
    },
    async queryOne() { return {}; },
    async pingDatabases() { return { inventory: true, borrow: true }; },
  },
};

const { setWarehouseScopeResolver } = require('../src/middlewares/warehouse-scope.middleware');
const { getRebalancingPlan } = require('../src/controllers/rebalancing.controller');

const SCOPES = {
  demo: { read: [HN], write: [HCM, DN] },
  single: { read: [], write: [HCM] },
  readonly: { read: [HCM, HN], write: [] },
  nobody: { read: [], write: [] },
  inactive: { read: [], write: [HCM, OLD] },
};
setWarehouseScopeResolver({
  resolve: async (user) => {
    if (user.id === 'down') throw new WarehouseScopeUnavailableError();
    const s = SCOPES[user.id];
    return { all: false, read: new Set([...s.read, ...s.write]), write: new Set(s.write) };
  },
});

const MANAGER_PERMS = { roles: ['MANAGER'], permissions: ['inventory.operation.decide', 'inventory.purchase.request', 'analytics.read'] };

function call(userId, query = {}) {
  return new Promise((resolve) => {
    getRebalancingPlan(
      { query, user: { id: userId, ...MANAGER_PERMS }, headers: {} },
      { json: (body) => resolve({ status: 200, data: body.data }) },
      (error) => resolve({ status: error.statusCode || 500, error }),
    );
  });
}

function warehouseIdsInSql() {
  const ids = new Set();
  for (const { params } of sqlSeen) {
    for (const p of params || []) if (Array.isArray(p)) p.forEach((v) => ids.add(v));
  }
  return ids;
}

test.beforeEach(reset);

test('FULL + READ + FULL: reads three warehouses, transfer from READ HN is collaborative', async () => {
  const { status, data } = await call('demo', { destinationWarehouseId: HCM });
  assert.equal(status, 200);
  assert.deepEqual(data.scope.warehouses.map((w) => [w.code, w.access]), [['WH-HCM-01', 'WRITE'], ['WH-HN-01', 'READ'], ['WH-DN-01', 'WRITE']]);
  // CT never reaches a query, so its stock cannot leak into any figure
  assert.equal(warehouseIdsInSql().has(CT), false);
  const hybrid = data.options.HYBRID;
  assert.equal(hybrid.total_shortage_qty, 6);
  assert.deepEqual(hybrid.transfers.map((t) => [t.from_warehouse_id, t.quantity, t.permission]), [[HN, 6, 'COLLABORATIVE']]);
  const executable = data.options.HYBRID_EXECUTABLE;
  assert.deepEqual(executable.transfers.map((t) => [t.from_warehouse_id, t.quantity, t.permission]), [[DN, 2, 'EXECUTABLE']]);
  assert.equal(executable.purchase_qty, 4);
  assert.equal(executable.purchase_cost_vnd, 320000);
  assert.equal(data.recommendation.best_business_option, 'TRANSFER_ONLY');
  assert.equal(data.recommendation.executable_option, 'HYBRID_EXECUTABLE');
  assert.equal(data.data_quality.transfer_cost, 'UNAVAILABLE');
});

test('bookIds limits the plan to that book; a malformed id is refused', async () => {
  const B1 = 'b1b1b1b1-0000-4000-8000-000000000001';
  const B2 = 'b2b2b2b2-0000-4000-8000-000000000002';
  fixture.variants = [{ variant_id: 'v1', book_id: B1, title: 'Sách A', unit_cost: 80000 },
    { variant_id: 'v2', book_id: B2, title: 'Sách B', unit_cost: 50000 }];
  fixture.stock.push({ warehouse_id: HCM, variant_id: 'v2', available_qty: 0, on_hand_qty: 0, reserved_qty: 0,
    borrowed_qty: 0, reorder_point: 0, safety_stock_qty: 4 });
  const all = await call('demo', { destinationWarehouseId: HCM });
  assert.equal(all.data.options.HYBRID.total_shortage_qty, 10); // A 6 + B 4
  const one = await call('demo', { destinationWarehouseId: HCM, bookIds: B2 });
  assert.equal(one.status, 200);
  assert.equal(one.data.options.HYBRID.total_shortage_qty, 4);
  assert.deepEqual(one.data.parameters.book_ids, [B2]);
  assert.ok(one.data.shortages.every((s) => s.variant_id === 'v2'));
  assert.equal((await call('demo', { bookIds: 'not-a-uuid' })).status, 400);
});

test('single-warehouse manager: only that warehouse, purchases only', async () => {
  const { data } = await call('single', { budgetVnd: '1000000' });
  assert.deepEqual(data.scope.warehouses.map((w) => w.code), ['WH-HCM-01']);
  assert.deepEqual([...warehouseIdsInSql()].filter((id) => id.length === 36), [HCM]);
  assert.equal(data.options.HYBRID.transfer_lines, 0);
  assert.equal(data.options.PROCUREMENT_ONLY.purchase_qty, 6);
  assert.equal(data.recommendation.best_business_option, 'PROCUREMENT_ONLY');
  assert.equal(data.diagnosis.length, 1);
});

test('read-only manager: analysis only, nothing executable', async () => {
  const { data } = await call('readonly', { destinationWarehouseId: HCM });
  assert.ok(data.options.HYBRID.transfers.every((t) => t.permission === 'COLLABORATIVE'));
  assert.ok(data.options.PROCUREMENT_ONLY.purchases.every((p) => p.permission === 'PROPOSAL_ONLY'));
  assert.equal(data.recommendation.executable_option, null);
});

test('open outgoing transfers are not promised twice', async () => {
  fixture.outgoing = [{ warehouse_id: HN, variant_id: 'v1', qty: 7 }];
  const { data } = await call('demo', { destinationWarehouseId: HCM });
  // HN: 10 on shelf, 7 already promised -> 3 free, protected 2 -> 1 can move
  const fromHn = data.options.HYBRID.transfers.find((t) => t.from_warehouse_id === HN);
  assert.equal(fromHn.quantity, 1);
});

test('no scope rows: empty plan, no stock is read', async () => {
  const { status, data } = await call('nobody');
  assert.equal(status, 200);
  assert.deepEqual(data.scope.warehouses, []);
  assert.ok(data.notice);
  assert.equal(sqlSeen.some(({ text }) => text.includes('stock_balances')), false);
});

test('forged, unknown, inactive and malformed destination ids', async () => {
  assert.equal((await call('demo', { destinationWarehouseId: CT })).status, 403);
  assert.equal((await call('demo', { destinationWarehouseId: '66666666-6666-4666-8666-666666666666' })).status, 403);
  assert.equal((await call('inactive', { destinationWarehouseId: OLD })).status, 409);
  assert.equal((await call('demo', { destinationWarehouseId: "x' OR 1=1" })).status, 400);
  assert.equal((await call('demo', { destinationWarehouseIds: `${HCM},${CT}` })).status, 403);
  assert.equal(sqlSeen.some(({ text }) => text.includes('stock_balances')), false);
});

test('auth-service down: 503, never all warehouses', async () => {
  const { status } = await call('down');
  assert.equal(status, 503);
});

test('a negative budget is refused', async () => {
  assert.equal((await call('demo', { budgetVnd: '-5' })).status, 400);
});

test('what-if parameters are scope-checked and applied', async () => {
  // a source outside the scope cannot be named, even to exclude it
  assert.equal((await call('demo', { destinationWarehouseId: HCM, excludeSourceIds: CT })).status, 403);
  assert.equal((await call('demo', { destinationWarehouseId: HCM, demandChangePct: '900' })).status, 400);
  const blocked = await call('demo', { destinationWarehouseId: HCM, excludeSourceIds: HN });
  assert.deepEqual(blocked.data.options.HYBRID.transfers.map((t) => t.from_warehouse_id), [DN]);
  const closed = await call('demo', { destinationWarehouseId: HCM, closedWarehouseIds: DN, excludeSourceIds: HN });
  assert.equal(closed.data.options.HYBRID.transfer_lines, 0);
  assert.equal(closed.data.parameters.what_if.closed_warehouse_ids[0], DN);
  const up = await call('demo', { destinationWarehouseId: HCM, safetyStockMultiplier: '2' });
  assert.equal(up.data.options.HYBRID.total_shortage_qty, 12); // HCM safety 6 -> 12
});

test('direct call without a signed-in user is refused (no service-key bypass)', async () => {
  const result = await new Promise((resolve) => {
    getRebalancingPlan({ query: {}, user: null, headers: {} }, { json: () => resolve({ status: 200 }) },
      (error) => resolve({ status: error.statusCode }));
  });
  assert.equal(result.status, 401);
});
