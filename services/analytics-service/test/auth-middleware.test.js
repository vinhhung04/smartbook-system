const assert = require('node:assert/strict');
const test = require('node:test');
const { authorizeAnyPermission } = require('../src/middlewares/auth.middleware');

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
}

test('analytics permission middleware rejects a user without reporting access', () => {
  const res = response();
  authorizeAnyPermission(['analytics.read'])({ user: { permissions: [] } }, res, () => {});
  assert.equal(res.statusCode, 403);
});

test('analytics permission middleware allows the expected permission', () => {
  let allowed = false;
  authorizeAnyPermission(['analytics.read'])({ user: { permissions: ['analytics.read'] } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);
});

// Copilot 3.2: a revoked token (logout, locked account, role change) is refused
// before any analytics data is read - the same Redis keys as auth-service.
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../src/middlewares/auth.middleware');
const { setRevocationStore } = require('../src/lib/token-revocation');

async function authenticate(token, store) {
  setRevocationStore(store);
  process.env.JWT_SECRET = 'test-secret';
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; } };
  let reached = false;
  await authenticateToken({ headers: { authorization: `Bearer ${token}` } }, res, () => { reached = true; });
  return { reached, res };
}

test('a logged-out token (jti blacklisted) never reaches an analytics handler', async () => {
  const token = jwt.sign({ sub: 'u1', jti: 'j1', permissions: ['analytics.read'] }, 'test-secret');
  const { reached, res } = await authenticate(token, { get: async (k) => (k === 'blacklist:token:j1' ? '1' : null) });
  assert.equal(reached, false);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(Object.keys(res.body), ['message']);
});

test('tokens issued before a revocation cutoff are refused; newer ones pass', async () => {
  const iat = Math.floor(Date.now() / 1000) - 60;
  const old = jwt.sign({ sub: 'u2', iat }, 'test-secret');
  const store = { get: async (k) => (k === 'user:tokens-valid-after:u2' ? String(iat + 10) : null) };
  assert.equal((await authenticate(old, store)).reached, false);
  const fresh = jwt.sign({ sub: 'u2', iat: iat + 20 }, 'test-secret');
  assert.equal((await authenticate(fresh, store)).reached, true);
});

test('a forged token is refused before the revocation lookup', async () => {
  let looked = false;
  const forged = jwt.sign({ sub: 'u3', is_superuser: true }, 'not-the-secret');
  const { reached, res } = await authenticate(forged, { get: async () => { looked = true; return null; } });
  assert.equal(reached, false);
  assert.equal(res.statusCode, 401);
  assert.equal(looked, false);
});

// Phase 5: Redis unreachable is "cannot tell", not "not revoked".
async function authenticateMethod(token, store, method) {
  setRevocationStore(store);
  process.env.JWT_SECRET = 'test-secret';
  const res = { statusCode: 200, body: null, headers: {}, status(code) { this.statusCode = code; return this; },
    json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
  let reached = false;
  await authenticateToken({ method, headers: { authorization: `Bearer ${token}` } }, res, () => { reached = true; });
  return { reached, res };
}

test('Redis down: a read continues (flagged), a write is refused with 503', async () => {
  const token = jwt.sign({ sub: 'u4', jti: 'j4', permissions: ['analytics.read'] }, 'test-secret');
  const down = { get: async () => { throw new Error('The client is closed'); } };
  const read = await authenticateMethod(token, down, 'GET');
  assert.equal(read.reached, true);
  assert.equal(read.res.headers['X-Token-Revocation-Check'], 'unverified');
  const write = await authenticateMethod(token, down, 'POST');
  assert.equal(write.reached, false);
  assert.equal(write.res.statusCode, 503);
});

// Phase 5: every analytics answer declares its population.
const { declareDataScope } = require('../src/middlewares/data-scope.middleware');

test('data scope is declared in the body meta and a header; errors are left alone', () => {
  const res = { statusCode: 200, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, json(b) { this.body = b; return this; } };
  declareDataScope('SYSTEM')({}, res, () => {});
  res.json({ data: { total: 1 } });
  assert.equal(res.headers['X-Data-Scope'], 'SYSTEM');
  assert.deepEqual(res.body, { data: { total: 1 }, meta: { data_scope: 'SYSTEM' } });
  const err = { statusCode: 403, headers: {}, body: null, setHeader() {}, json(b) { this.body = b; return this; } };
  declareDataScope('WAREHOUSE_SCOPED')({}, err, () => {});
  err.json({ message: 'no' });
  assert.deepEqual(err.body, { message: 'no' });
  assert.throws(() => declareDataScope('ALL'));
});
