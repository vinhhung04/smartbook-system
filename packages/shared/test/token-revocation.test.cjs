const assert = require('node:assert/strict');
const test = require('node:test');

const { createRevocationChecker, revocationGuard, REVOKED, VALID, UNKNOWN } = require('../runtime/token-revocation.cjs');

function fakeRedis(initial = {}) {
  const data = new Map(Object.entries(initial));
  const state = { down: false, hang: false };
  return {
    state,
    data,
    async get(key) {
      if (state.hang) return new Promise(() => {});
      if (state.down) throw new Error('The client is closed');
      return data.has(key) ? data.get(key) : null;
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

const token = { jti: 'u1-1', sub: 'u1', iat: 1000 };

test('Redis answering: valid, logged out (jti), and issued before the cutoff', async () => {
  const redis = fakeRedis();
  const checker = createRevocationChecker({ get: redis.get });
  assert.equal((await checker.check(token)).state, VALID);
  redis.data.set('blacklist:token:u1-1', '1');
  assert.equal((await checker.check(token)).state, REVOKED);
  assert.equal((await checker.check({ jti: 'u1-2', sub: 'u1', iat: 1000 })).state, VALID);
  redis.data.set('user:tokens-valid-after:u1', '1500');
  assert.equal((await checker.check({ jti: 'u1-2', sub: 'u1', iat: 1000 })).state, REVOKED);
  assert.equal((await checker.check({ jti: 'u1-3', sub: 'u1', iat: 1600 })).state, VALID);
});

test('a Redis error is UNKNOWN, never "not revoked"', async () => {
  const redis = fakeRedis();
  redis.state.down = true;
  const checker = createRevocationChecker({ get: redis.get });
  assert.equal((await checker.check(token)).state, UNKNOWN);
});

test('a hanging Redis (timeout) is UNKNOWN within the timeout', async () => {
  const redis = fakeRedis();
  redis.state.hang = true;
  const checker = createRevocationChecker({ get: redis.get, timeoutMs: 50 });
  const t0 = Date.now();
  assert.equal((await checker.check(token)).state, UNKNOWN);
  assert.ok(Date.now() - t0 < 500);
});

test('bounded fallback: a revocation seen before the outage is kept for good', async () => {
  let clock = 0;
  const redis = fakeRedis({ 'blacklist:token:u1-1': '1' });
  const checker = createRevocationChecker({ get: redis.get, now: () => clock, staleOkMs: 60000 });
  assert.equal((await checker.check(token)).state, REVOKED);
  redis.state.down = true;
  clock = 10 * 60 * 1000; // ten minutes into the outage
  assert.equal((await checker.check(token)).state, REVOKED);
});

test('bounded fallback: an older cutoff still revokes while Redis is down', async () => {
  let clock = 0;
  const redis = fakeRedis({ 'user:tokens-valid-after:u1': '1500' });
  const checker = createRevocationChecker({ get: redis.get, now: () => clock });
  await checker.check({ jti: 'x', sub: 'u1', iat: 1600 });
  redis.state.down = true;
  clock = 10 * 60 * 1000;
  assert.equal((await checker.check({ jti: 'y', sub: 'u1', iat: 1000 })).state, REVOKED);
});

test('bounded fallback: a VALID answer is reused only within staleOkMs', async () => {
  let clock = 0;
  const redis = fakeRedis();
  const checker = createRevocationChecker({ get: redis.get, now: () => clock, staleOkMs: 60000 });
  assert.equal((await checker.check(token)).state, VALID);
  redis.state.down = true;
  clock = 30000;
  const within = await checker.check(token);
  assert.equal(within.state, VALID);
  assert.equal(within.stale, true);
  clock = 61000;
  assert.equal((await checker.check(token)).state, UNKNOWN);
});

test('Redis back after the outage: checks work again (restart / reconnect)', async () => {
  const redis = fakeRedis();
  const checker = createRevocationChecker({ get: redis.get, staleOkMs: 0 });
  redis.state.down = true;
  assert.equal((await checker.check(token)).state, UNKNOWN);
  redis.state.down = false;
  redis.data.set('blacklist:token:u1-1', '1');
  assert.equal((await checker.check(token)).state, REVOKED);
});

test('guard: revoked -> 401; unknown -> reads pass, writes 503; deny-all refuses reads too', () => {
  let res = fakeRes();
  assert.equal(revocationGuard({ method: 'GET' }, res, { state: REVOKED }), true);
  assert.equal(res.statusCode, 401);

  res = fakeRes();
  assert.equal(revocationGuard({ method: 'GET' }, res, { state: UNKNOWN }, { mode: 'deny-writes' }), false);
  assert.equal(res.headers['X-Token-Revocation-Check'], 'unverified');

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    res = fakeRes();
    assert.equal(revocationGuard({ method }, res, { state: UNKNOWN }, { mode: 'deny-writes' }), true);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'REVOCATION_UNVERIFIED');
  }

  res = fakeRes();
  assert.equal(revocationGuard({ method: 'GET' }, res, { state: UNKNOWN }, { mode: 'deny-all' }), true);
  assert.equal(res.statusCode, 503);

  res = fakeRes();
  assert.equal(revocationGuard({ method: 'POST' }, res, { state: VALID }), false);
});

test('guard: a request that only gives access up (logout) passes while revocation is unknown', () => {
  const res = fakeRes();
  assert.equal(revocationGuard({ method: 'POST' }, res, { state: UNKNOWN }, { mode: 'deny-all', allowWhenUnknown: true }), false);
  const revoked = fakeRes();
  assert.equal(revocationGuard({ method: 'POST' }, revoked, { state: REVOKED }, { allowWhenUnknown: true }), true);
  assert.equal(revoked.statusCode, 401);
});
