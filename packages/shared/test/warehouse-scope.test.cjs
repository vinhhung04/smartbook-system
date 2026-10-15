const test = require('node:test');
const assert = require('node:assert/strict');
const { createWarehouseScopeResolver, WarehouseScopeUnavailableError } = require('../runtime/warehouse-scope.cjs');

const HN = '00000000-0000-0000-0000-000000000003';
const HCM = '00000000-0000-0000-0000-000000000002';
const USER = { id: '11111111-1111-4111-8111-111111111111', is_superuser: false };

function fakeAuth(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, key: init.headers['x-internal-service-key'] });
    return handler(url);
  };
  return { calls, fetchImpl };
}

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const user = (scopes, extra = {}) => json(200, { data: { user_id: USER.id, status: 'ACTIVE', is_superuser: false, scopes, ...extra } });
const resolver = (fetchImpl, extra = {}) =>
  createWarehouseScopeResolver({ authUrl: 'http://auth', internalKey: 'k', fetchImpl, ...extra });

test('superuser (verified JWT claim) reads and writes every warehouse without a lookup', async () => {
  const auth = fakeAuth(() => { throw new Error('must not be called'); });
  const scope = await resolver(auth.fetchImpl).resolve({ id: 'x', is_superuser: true });
  assert.equal(scope.all, true);
  assert.equal(auth.calls.length, 0);
});

test('manager scoped to Ha Noi only reads Ha Noi; READ never writes', async () => {
  const r = resolver(fakeAuth(() => user([{ warehouse_id: HN, access_level: 'READ' }])).fetchImpl);
  assert.equal(await r.canRead(USER, HN), true);
  assert.equal(await r.canRead(USER, HCM), false);
  assert.equal(await r.canWrite(USER, HN), false);
});

test('FULL, WRITE and OPERATOR write; READ_ONLY and unknown levels do not', async () => {
  const r = resolver(fakeAuth(() => user([
    { warehouse_id: 'a', access_level: 'FULL' }, { warehouse_id: 'b', access_level: 'OPERATOR' },
    { warehouse_id: 'c', access_level: 'WRITE' }, { warehouse_id: 'd', access_level: 'READ_ONLY' },
    { warehouse_id: 'e', access_level: 'SUPERVISOR' },
  ])).fetchImpl);
  const scope = await r.resolve(USER);
  assert.deepEqual([...scope.write].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...scope.read].sort(), ['a', 'b', 'c', 'd']);
});

test('no scope rows means no warehouse (fail-closed, was: every warehouse)', async () => {
  const scope = await resolver(fakeAuth(() => user([])).fetchImpl).resolve(USER);
  assert.equal(scope.all, false);
  assert.equal(scope.read.size, 0);
});

test('unknown, locked or deleted users get nothing', async () => {
  assert.equal((await resolver(fakeAuth(() => json(404, {})).fetchImpl).resolve(USER)).read.size, 0);
  const locked = user([{ warehouse_id: HN, access_level: 'FULL' }], { status: 'LOCKED' });
  assert.equal((await resolver(fakeAuth(() => locked).fetchImpl).resolve(USER)).read.size, 0);
  const deleted = user([{ warehouse_id: HN, access_level: 'FULL' }], { deleted: true });
  assert.equal((await resolver(fakeAuth(() => deleted).fetchImpl).resolve(USER)).read.size, 0);
});

test('auth-service down, failing or misconfigured is an error - never all warehouses', async () => {
  const down = fakeAuth(() => { throw new TypeError('fetch failed'); });
  await assert.rejects(resolver(down.fetchImpl).resolve(USER), WarehouseScopeUnavailableError);
  await assert.rejects(resolver(fakeAuth(() => json(500, {})).fetchImpl).resolve(USER), WarehouseScopeUnavailableError);
  const garbled = { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } };
  await assert.rejects(resolver(fakeAuth(() => garbled).fetchImpl).resolve(USER), WarehouseScopeUnavailableError);
  const noKey = createWarehouseScopeResolver({ authUrl: 'http://auth', internalKey: '', fetchImpl: async () => user([]) });
  await assert.rejects(noKey.resolve(USER), (error) => error.statusCode === 503);
});

test('the lookup carries the internal key and the user id from the token, nothing from the request', async () => {
  const auth = fakeAuth(() => user([]));
  await resolver(auth.fetchImpl).resolve(USER);
  assert.equal(auth.calls[0].url, `http://auth/internal/users/${USER.id}/warehouse-scopes`);
  assert.equal(auth.calls[0].key, 'k');
});

test('scopes are cached briefly per user; a revoked scope stops working after the TTL', async () => {
  let rows = [{ warehouse_id: HN, access_level: 'FULL' }];
  const auth = fakeAuth(() => user(rows));
  let now = 1_000_000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const r = resolver(auth.fetchImpl, { ttlMs: 30_000 });
    assert.equal(await r.canRead(USER, HN), true);
    rows = []; // access revoked in auth_db
    now += 10_000;
    assert.equal(await r.canRead(USER, HN), true); // within TTL
    now += 25_000;
    assert.equal(await r.canRead(USER, HN), false); // re-read after TTL
    assert.equal(auth.calls.length, 2);
  } finally {
    Date.now = realNow;
  }
});
