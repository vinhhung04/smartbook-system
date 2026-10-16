// Copilot 3.2 security regression: list/detail endpoints that used to return
// every warehouse's rows (stock movements, purchase requests, picking, packing,
// transfer receiving, outbound) now compute rows, totals and pages on the
// caller's warehouses only. A tiny in-memory Prisma stands in for the database,
// so each test can assert that no row of the other warehouse comes back.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const HN = '00000000-0000-0000-0000-000000000003';
const HCM = '00000000-0000-0000-0000-000000000002';

// ── in-memory prisma ───────────────────────────────────────────────────────
function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return cond.some((w) => matches(row, w));
    if (key === 'AND') return cond.every((w) => matches(row, w));
    if (key === 'NOT') return true; // not modelled; never used to scope
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) return cond.in.includes(row[key]);
      if ('not' in cond || 'none' in cond || 'startsWith' in cond || 'contains' in cond) return true;
      return true;
    }
    return row[key] === cond;
  });
}

const db = {
  stock_movements: [
    { id: 'm1', warehouse_id: HN, movement_type: 'INBOUND', quantity: 1, created_at: new Date(2) },
    { id: 'm2', warehouse_id: HCM, movement_type: 'INBOUND', quantity: 9, created_at: new Date(1) },
  ],
  purchase_requests: [
    { id: 'pr-hn', warehouse_id: HN, status: 'PENDING', created_by_user_id: 'someone', created_at: new Date() },
    { id: 'pr-hcm', warehouse_id: HCM, status: 'PENDING', created_by_user_id: 'someone', created_at: new Date() },
    { id: 'pr-hcm2', warehouse_id: HCM, status: 'APPROVED', created_by_user_id: 'someone', created_at: new Date() },
  ],
  packing_tasks: [
    { id: 'pk-hn', warehouse_id: HN, status: 'PENDING', packing_task_items: [] },
    { id: 'pk-hcm', warehouse_id: HCM, status: 'PENDING', packing_task_items: [] },
  ],
  outbound_orders: [],
  transfer_orders: [
    { id: 't-into-hn', from_warehouse_id: HCM, to_warehouse_id: HN, status: 'IN_TRANSIT', transfer_order_items: [] },
    { id: 't-into-hcm', from_warehouse_id: HN, to_warehouse_id: HCM, status: 'IN_TRANSIT', transfer_order_items: [] },
  ],
  picking_tasks: [],
  inventory_audit_logs: [],
  packing_scan_events: [],
};
const calls = [];
function model(name) {
  return {
    findMany: async ({ where, skip = 0, take } = {}) => {
      calls.push({ model: name, where });
      const rows = db[name].filter((r) => matches(r, where));
      return rows.slice(skip, take ? skip + take : undefined);
    },
    count: async ({ where } = {}) => db[name].filter((r) => matches(r, where)).length,
    findUnique: async ({ where }) => db[name].find((r) => r.id === where.id) || null,
    update: async ({ where, data }) => ({ ...db[name].find((r) => r.id === where.id), ...data }),
  };
}
class FakePrisma {
  constructor() {
    for (const name of Object.keys(db)) this[name] = model(name);
    this.warehouses = { findMany: async () => [{ id: HN }, { id: HCM }] };
  }
}
const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '@prisma/client') return { PrismaClient: FakePrisma, Prisma: {} };
  return realLoad.call(this, request, parent, isMain);
};

const scopeUtils = require('../src/utils/warehouse-scope.utils');
const { WarehouseScopeUnavailableError } = require('@smartbook/shared/warehouse-scope');

function fakeResolver(byUser) {
  const resolve = async (user) => {
    if (user?.is_superuser) return { all: true, read: null, write: null };
    const entry = byUser[user?.id];
    if (entry instanceof Error) throw entry;
    return entry || { all: false, read: new Set(), write: new Set() };
  };
  return {
    resolve,
    canRead: async (u, id) => { const s = await resolve(u); return s.all || s.read.has(id); },
    canWrite: async (u, id) => { const s = await resolve(u); return s.all || s.write.has(id); },
  };
}
scopeUtils.setWarehouseScopeResolver(fakeResolver({
  'manager-hn': { all: false, read: new Set([HN]), write: new Set([HN]) },
  'reader-hn': { all: false, read: new Set([HN]), write: new Set() },
  'auth-down': new WarehouseScopeUnavailableError(),
}));

const { getStockMovements } = require('../src/controllers/stock-movement.controller');
const pr = require('../src/controllers/purchase-request.controller');
const { listPackingTasks, getPackingTaskDetail } = require('../src/controllers/packing.controller');
const { listTransferReceivingQueue } = require('../src/controllers/transfer-receiving.controller');

const MANAGER = { id: 'manager-hn', roles: ['WAREHOUSE_MANAGER'], permissions: ['inventory.stock.read'] };
const READER = { id: 'reader-hn', roles: ['WAREHOUSE_MANAGER'], permissions: [] };
const NOBODY = { id: 'nobody', roles: ['WAREHOUSE_MANAGER'], permissions: [] };
const ADMIN = { id: 'admin', is_superuser: true, roles: ['ADMIN'] };
const DOWN = { id: 'auth-down', roles: ['WAREHOUSE_MANAGER'] };

function res() {
  return { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
async function call(handler, user, { query = {}, params = {}, body = {} } = {}) {
  const r = res();
  await handler({ user, query, params, body }, r);
  return r;
}
const ids = (rows) => rows.map((r) => r.id).sort();

test('stock movements: a Ha Noi manager gets only Ha Noi rows; no warehouse given never widens', async () => {
  const r = await call(getStockMovements, MANAGER);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(ids(r.body), ['m1']);
  assert.ok(!JSON.stringify(r.body).includes(HCM));
  assert.deepEqual(ids((await call(getStockMovements, ADMIN)).body), ['m1', 'm2']); // superuser policy
  assert.deepEqual((await call(getStockMovements, NOBODY)).body, []); // empty scope = nothing, not everything
});

test('stock movements: naming another warehouse cannot bypass the scope', async () => {
  const r = await call(getStockMovements, MANAGER, { query: { warehouse_id: HCM } });
  assert.deepEqual(r.body, []);
});

test('stock movements: scope service down is 503 with no rows', async () => {
  const r = await call(getStockMovements, DOWN);
  assert.equal(r.statusCode, 503);
  assert.ok(!Array.isArray(r.body));
});

test('purchase requests: rows, total and pages are computed on scoped data', async () => {
  const r = await call(pr.getAllPurchaseRequests, MANAGER, { query: { limit: 1 } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(ids(r.body.data), ['pr-hn']);
  assert.equal(r.body.total, 1); // not 3: other warehouses do not leak through the count
  const filtered = await call(pr.getAllPurchaseRequests, MANAGER, { query: { status: 'APPROVED' } });
  assert.equal(filtered.body.total, 0);
  assert.equal((await call(pr.getAllPurchaseRequests, ADMIN)).body.total, 3);
});

test('purchase requests: another warehouse\'s request cannot be read or decided', async () => {
  const detail = await call(pr.getPurchaseRequestById, MANAGER, { params: { id: 'pr-hcm' } });
  assert.equal(detail.statusCode, 403);
  assert.ok(!JSON.stringify(detail.body).includes('pr-hcm'));
  assert.equal((await call(pr.getPurchaseRequestById, MANAGER, { params: { id: 'pr-hn' } })).statusCode, 200);
  const approve = await call(pr.approvePurchaseRequest, MANAGER, { params: { id: 'pr-hcm' } });
  assert.equal(approve.statusCode, 403);
  assert.equal(approve.body.code, 'WAREHOUSE_ACCESS_DENIED');
  assert.equal((await call(pr.rejectPurchaseRequest, MANAGER, { params: { id: 'pr-hcm' }, body: { rejection_reason: 'x' } })).statusCode, 403);
  assert.equal((await call(pr.convertPurchaseRequestToPO, MANAGER, { params: { id: 'pr-hcm2' } })).statusCode, 403);
  // read-only scope in its own warehouse still cannot decide
  assert.equal((await call(pr.approvePurchaseRequest, READER, { params: { id: 'pr-hn' } })).statusCode, 403);
});

test('packing: queue and detail stay inside the scope', async () => {
  const r = await call(listPackingTasks, MANAGER, { query: { status: 'PENDING' } });
  assert.deepEqual(ids(r.body.tasks), ['pk-hn']);
  assert.equal((await call(getPackingTaskDetail, MANAGER, { params: { taskId: '11111111-1111-4111-8111-111111111111' } })).statusCode, 404);
});

test('transfer receiving: only transfers INTO the caller\'s warehouses (valid inter-warehouse flow kept)', async () => {
  const r = await call(listTransferReceivingQueue, { ...MANAGER, permissions: ['inventory.operation.decide'] });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.data.map((t) => t.id), ['t-into-hn']); // coming from HCM into HN: HN may receive it
  assert.ok(!JSON.stringify(r.body).includes('t-into-hcm'));
});

test('scopedWarehouseWhere: fail-closed shapes', async () => {
  assert.deepEqual(await scopeUtils.scopedWarehouseWhere(ADMIN), {});
  assert.deepEqual(await scopeUtils.scopedWarehouseWhere(NOBODY), { warehouse_id: { in: [] } });
  assert.deepEqual(await scopeUtils.scopedWarehouseWhere(MANAGER, 'warehouse_id', HCM), { warehouse_id: { in: [] } });
  assert.deepEqual(await scopeUtils.scopedWarehouseWhere(MANAGER, ['from_warehouse_id', 'to_warehouse_id']),
    { OR: [{ from_warehouse_id: { in: [HN] } }, { to_warehouse_id: { in: [HN] } }] });
  await assert.rejects(scopeUtils.scopedWarehouseWhere(DOWN), WarehouseScopeUnavailableError);
});
