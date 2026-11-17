const test = require('node:test');
const assert = require('node:assert/strict');
const scope = require('../src/utils/warehouse-scope.utils');
const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('read scope permits readers but write scope remains a separate decision', async () => {
  scope.setWarehouseScopeResolver({ canRead: async (_, id) => id === 'readable', canWrite: async (_, id) => id === 'writable' });
  assert.equal(await scope.requireWarehouseReadAccess({ user: { id: 'u' } }, res(), 'readable'), true);
  const denied = res();
  assert.equal(await scope.requireWarehouseWriteAccess({ user: { id: 'u', roles: ['ADMIN'] } }, denied, 'readable'), false);
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.code, 'WAREHOUSE_ACCESS_DENIED');
  assert.equal(await scope.requireWarehouseWriteAccess({ user: { id: 'u' } }, res(), 'writable'), true);
});
test('no scope is an empty filter; only an explicit superuser grant means unrestricted', async () => {
  scope.setWarehouseScopeResolver({ resolve: async user => ({ all: user.is_superuser === true, read: new Set() }) });
  assert.deepEqual(await scope.scopedWarehouseWhere({ roles: ['ADMIN'] }), { warehouse_id: { in: [] } });
  assert.deepEqual(await scope.scopedWarehouseWhere({ is_superuser: true }), {});
});
test('scoped lists contain exactly the warehouses granted by auth-service', async () => {
  scope.setWarehouseScopeResolver({ resolve: async () => ({ all: false, read: new Set(['a', 'b']) }) });
  assert.deepEqual(await scope.scopedWarehouseWhere({ id: 'u' }), { warehouse_id: { in: ['a', 'b'] } });
});
test('anonymous callers are rejected before checking the resolver', async () => {
  scope.setWarehouseScopeResolver({ canWrite: async () => { throw new Error('must not be called'); } });
  const denied = res();
  assert.equal(await scope.requireWarehouseWriteAccess({}, denied, 'a'), false);
  assert.equal(denied.statusCode, 401);
});
test('missing warehouse does not grant manager access', async () => {
  assert.equal(await scope.canReadWarehouse({ roles: ['ADMIN'] }, null), false);
  assert.equal(await scope.canWriteWarehouse({ is_superuser: 'true' }, null), false);
  assert.equal(await scope.canWriteWarehouse({ is_superuser: true }, null), true);
});
test('auth-service unavailable fails closed with 503 on reads and writes', async () => {
  const error = new scope.WarehouseScopeUnavailableError('scope offline');
  scope.setWarehouseScopeResolver({ canRead: async () => { throw error; }, canWrite: async () => { throw error; } });
  for (const check of [scope.requireWarehouseReadAccess, scope.requireWarehouseWriteAccess]) {
    const denied = res();
    assert.equal(await check({ user: { id: 'u' } }, denied, 'a'), false);
    assert.equal(denied.statusCode, 503);
    assert.equal(denied.body.code, error.code);
  }
});
