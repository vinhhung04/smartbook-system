const test = require('node:test');
const assert = require('node:assert/strict');
const { WarehouseScopeUnavailableError } = require('@smartbook/shared/warehouse-scope');
const { attachWarehouseScope, inScope, setWarehouseScopeResolver } = require('../src/middlewares/warehouse-scope.middleware');

const HN = '00000000-0000-0000-0000-000000000003';
const HCM = '00000000-0000-0000-0000-000000000002';

setWarehouseScopeResolver({
  resolve: async (user) => {
    if (user.is_superuser) return { all: true, read: null, write: null };
    if (user.id === 'down') throw new WarehouseScopeUnavailableError();
    return { all: false, read: new Set(user.id === 'hn' ? [HN] : []), write: new Set() };
  },
});

async function run(req) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let passed = false;
  await attachWarehouseScope()(req, res, () => { passed = true; });
  return { passed, res, scope: req.warehouseScope };
}

test('service-key calls (no user) and superusers are not filtered', async () => {
  assert.equal((await run({})).scope, null);
  assert.equal((await run({ user: { id: 'su', is_superuser: true } })).scope, null);
});

test('a scoped user only keeps rows of their warehouses (aggregates cannot leak HCM to a HN manager)', async () => {
  const { scope } = await run({ user: { id: 'hn' } });
  const rows = [{ warehouse_id: HN, out: 1 }, { warehouse_id: HCM, out: 3 }];
  assert.deepEqual(rows.filter((r) => inScope(scope, r.warehouse_id)), [{ warehouse_id: HN, out: 1 }]);
});

test('no scope means no rows; scope unavailable is 503', async () => {
  const none = await run({ user: { id: 'nobody' } });
  assert.equal(inScope(none.scope, HN), false);
  const down = await run({ user: { id: 'down' } });
  assert.equal(down.passed, false);
  assert.equal(down.res.statusCode, 503);
});
