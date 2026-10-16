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
