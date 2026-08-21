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
