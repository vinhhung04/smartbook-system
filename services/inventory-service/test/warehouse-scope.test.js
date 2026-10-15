// Warehouse scope in inventory-service: fail-closed util + the request guard.
const test = require('node:test');
const assert = require('node:assert/strict');
const { WarehouseScopeUnavailableError } = require('@smartbook/shared/warehouse-scope');
const scopeUtils = require('../src/utils/warehouse-scope.utils');
const { enforceRequestedWarehouseScope } = require('../src/middlewares/warehouse-scope.middleware');

const HN = '00000000-0000-0000-0000-000000000003';
const HCM = '00000000-0000-0000-0000-000000000002';

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
  'manager-hcm': { all: false, read: new Set([HCM]), write: new Set([HCM]) },
  'readonly-hcm': { all: false, read: new Set([HCM]), write: new Set() },
  'auth-down': new WarehouseScopeUnavailableError(),
}));

const res = () => ({ statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });

async function guard({ user, superuser = false, method = 'GET', url = '/api/x', query = {}, body = {} }) {
  const r = res();
  let passed = false;
  await enforceRequestedWarehouseScope()({ user: { id: user, is_superuser: superuser }, method, originalUrl: url, query, body }, r, () => { passed = true; });
  return passed ? 'next' : r.statusCode;
}

test('a manager of Ha Noi reads Ha Noi but not HCM, even by naming it in the request', async () => {
  assert.equal(await guard({ user: 'manager-hn', query: { warehouse_id: HN } }), 'next');
  assert.equal(await guard({ user: 'manager-hn', query: { warehouse_id: HCM } }), 403);
  assert.equal(await guard({ user: 'manager-hn', url: `/api/warehouses/${HCM}/locations` }), 403);
});

test('a manager of HCM is the mirror image', async () => {
  assert.equal(await guard({ user: 'manager-hcm', query: { warehouseId: HCM } }), 'next');
  assert.equal(await guard({ user: 'manager-hcm', query: { warehouseId: HN } }), 403);
});

test('READ-only scope cannot write; a write must be in the acting warehouse', async () => {
  assert.equal(await guard({ user: 'readonly-hcm', method: 'POST', body: { warehouse_id: HCM } }), 403);
  assert.equal(await guard({ user: 'manager-hcm', method: 'POST', body: { warehouse_id: HCM } }), 'next');
  // transfer out of HCM into HN: HCM must be writable, HN at least readable
  assert.equal(await guard({ user: 'manager-hcm', method: 'POST', body: { from_warehouse_id: HCM, to_warehouse_id: HN } }), 403);
  assert.equal(await guard({ user: 'manager-hn', method: 'POST', body: { from_warehouse_id: HCM } }), 403);
});

test('a user without any scope gets nothing (fail-closed)', async () => {
  assert.equal(await guard({ user: 'nobody', query: { warehouse_id: HN } }), 403);
  assert.deepEqual(await scopeUtils.getReadableWarehouseIds({ id: 'nobody' }), []);
  assert.deepEqual(await scopeUtils.getWritableWarehouseIds({ id: 'nobody' }), []);
  assert.equal(await scopeUtils.canReadWarehouse({ id: 'nobody' }, HN), false);
  assert.deepEqual(await scopeUtils.readableWarehouseFilter({ id: 'nobody' }), []);
});

test('auth-service unavailable answers 503, never grants', async () => {
  assert.equal(await guard({ user: 'auth-down', query: { warehouse_id: HN } }), 503);
  await assert.rejects(scopeUtils.getReadableWarehouseIds({ id: 'auth-down' }), WarehouseScopeUnavailableError);
  const r = res();
  assert.equal(await scopeUtils.requireWarehouseReadAccess({ user: { id: 'auth-down' } }, r, HN), false);
  assert.equal(r.statusCode, 503);
});

test('requireWarehouse*Access answers 403 outside the scope and 401 without a user', async () => {
  let r = res();
  assert.equal(await scopeUtils.requireWarehouseWriteAccess({ user: { id: 'readonly-hcm' } }, r, HCM), false);
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.code, 'WAREHOUSE_ACCESS_DENIED');
  r = res();
  assert.equal(await scopeUtils.requireWarehouseReadAccess({}, r, HCM), false);
  assert.equal(r.statusCode, 401);
  r = res();
  assert.equal(await scopeUtils.requireWarehouseReadAccess({ user: { id: 'readonly-hcm' } }, r, HCM), true);
});

test('library circulation and the catalog are not warehouse-scoped; requests naming no warehouse pass', async () => {
  assert.equal(await guard({ user: 'nobody', url: '/api/borrow-integration/availability', query: { warehouse_id: HN } }), 'next');
  assert.equal(await guard({ user: 'nobody', url: '/api/books' }), 'next');
  assert.equal(await guard({ user: 'nobody', url: '/api/stock-alerts' }), 'next');
});

test('superuser passes every check', async () => {
  assert.equal(await guard({ user: 'su', superuser: true, method: 'POST', body: { warehouse_id: HCM } }), 'next');
  assert.equal(await scopeUtils.readableWarehouseFilter({ id: 'su', is_superuser: true }), null);
});
