// Mobile refresh tokens: rotation, reuse detection, logout revocation, and the
// controller's handling of locked users and the per-user revocation cutoff.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const { createRefreshTokenService, RefreshTokenError, hashToken } = require('../src/lib/refresh-tokens');

function memoryStore() {
  const data = new Map();
  return {
    data,
    get: async (key) => (data.has(key) ? data.get(key) : null),
    set: async (key, value) => { data.set(key, value); },
    getDel: async (key) => {
      const value = data.has(key) ? data.get(key) : null;
      data.delete(key);
      return value;
    },
    del: async (key) => { data.delete(key); },
  };
}

test('issue stores only a hash of the token', async () => {
  const store = memoryStore();
  const service = createRefreshTokenService(store);
  const { token } = await service.issue('user-1');
  assert.ok(token.length >= 40);
  assert.ok(![...store.data.keys()].some((key) => key.includes(token)));
  assert.ok(store.data.has(`refresh:token:${hashToken(token)}`));
});

test('a token can be consumed once; rotation keeps the family', async () => {
  const service = createRefreshTokenService(memoryStore());
  const first = await service.issue('user-1');
  const record = await service.consume(first.token);
  assert.equal(record.user_id, 'user-1');
  const second = await service.issue('user-1', record.family_id);
  assert.equal(second.familyId, first.familyId);
  assert.equal((await service.consume(second.token)).family_id, first.familyId);
});

test('reusing a rotated-away token revokes the whole family', async () => {
  const service = createRefreshTokenService(memoryStore());
  const first = await service.issue('user-1');
  const record = await service.consume(first.token);
  const second = await service.issue('user-1', record.family_id);

  await assert.rejects(service.consume(first.token), (err) => err instanceof RefreshTokenError && err.code === 'REUSED');
  // The legitimate holder's current token is gone too: the leak ends both sessions.
  await assert.rejects(service.consume(second.token), (err) => err instanceof RefreshTokenError && err.code === 'INVALID');
});

test('revoke (logout) ends the family', async () => {
  const service = createRefreshTokenService(memoryStore());
  const { token } = await service.issue('user-1');
  await service.revoke(token);
  await assert.rejects(service.consume(token), RefreshTokenError);
});

test('malformed tokens are rejected without touching the store', async () => {
  const service = createRefreshTokenService({
    get: async () => { throw new Error('must not be called'); },
    getDel: async () => { throw new Error('must not be called'); },
  });
  await assert.rejects(service.consume('short'), RefreshTokenError);
  await assert.rejects(service.consume(undefined), RefreshTokenError);
});

test('a store outage surfaces as an error, never as a valid token', async () => {
  const service = createRefreshTokenService({
    getDel: async () => { throw new Error('Redis is not connected'); },
  });
  await assert.rejects(service.consume('x'.repeat(43)), (err) => !(err instanceof RefreshTokenError));
});

// ---- controller: POST /auth/refresh ----------------------------------------

const USER_ID = '11111111-1111-4111-8111-111111111111';
const store = memoryStore();
const users = new Map();
const fakeRedis = {
  getStrict: (key) => store.get(key),
  setStrict: (key, value) => store.set(key, value),
  getDelStrict: (key) => store.getDel(key),
  delStrict: (key) => store.del(key),
  get: (key) => store.get(key),
  set: async (key, value) => { await store.set(key, value); return true; },
};
const fakePrisma = {
  user: { findUnique: async ({ where }) => users.get(where.id) ?? null },
  $queryRawUnsafe: async (sql) => (/permission/i.test(sql) ? [{ code: 'inventory.task.read' }] : [{ code: 'WAREHOUSE_STAFF' }]),
  $queryRaw: async () => [],
};

const realLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === '../lib/prisma') return fakePrisma;
  if (request === '../lib/redis' || (request === './redis' && parent?.filename?.endsWith('token-revocation.js'))) return fakeRedis;
  return realLoad.call(this, request, parent, isMain);
};
process.env.JWT_SECRET = 'test-secret';
const controller = require('../src/controllers/auth.controller');
const service = createRefreshTokenService(store);

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

function activeUser(overrides = {}) {
  return { id: USER_ID, username: 'staff', email: 's@x.vn', status: 'ACTIVE', is_superuser: false, deleted_at: null, password_hash: 'x', ...overrides };
}

test('refresh returns a new access token and a rotated refresh token', async () => {
  users.set(USER_ID, activeUser());
  const { token } = await service.issue(USER_ID);
  const r = res();
  await controller.refresh({ body: { refresh_token: token } }, r);
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(r.body.token);
  assert.ok(r.body.refresh_token && r.body.refresh_token !== token);
  assert.equal(r.body.user.password_hash, undefined);

  const replay = res();
  await controller.refresh({ body: { refresh_token: token } }, replay);
  assert.equal(replay.statusCode, 401);
  assert.equal(replay.body.code, 'REFRESH_TOKEN_REUSED');
});

test('refresh is refused for a locked account', async () => {
  users.set(USER_ID, activeUser({ status: 'LOCKED' }));
  const { token } = await service.issue(USER_ID);
  const r = res();
  await controller.refresh({ body: { refresh_token: token } }, r);
  assert.equal(r.statusCode, 401);
  assert.equal(r.body.code, 'REFRESH_TOKEN_REVOKED');
});

test('refresh is refused after a password change / role change cutoff', async () => {
  users.set(USER_ID, activeUser());
  const { token } = await service.issue(USER_ID);
  await store.set(`user:tokens-valid-after:${USER_ID}`, String(Math.floor(Date.now() / 1000) + 5));
  const r = res();
  await controller.refresh({ body: { refresh_token: token } }, r);
  assert.equal(r.statusCode, 401);
  store.data.delete(`user:tokens-valid-after:${USER_ID}`);
});

test('refresh/revoke ends the session without an access token', async () => {
  users.set(USER_ID, activeUser());
  const { token } = await service.issue(USER_ID);
  const revoked = res();
  await controller.revokeRefresh({ body: { refresh_token: token } }, revoked);
  assert.equal(revoked.statusCode, 200);
  const r = res();
  await controller.refresh({ body: { refresh_token: token } }, r);
  assert.equal(r.statusCode, 401);
});

test('refresh requires a token', async () => {
  const r = res();
  await controller.refresh({ body: {} }, r);
  assert.equal(r.statusCode, 400);
});
