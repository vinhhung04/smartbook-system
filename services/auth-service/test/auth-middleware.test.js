const assert = require('node:assert/strict');
const test = require('node:test');
const { authorizeAnyPermission } = require('../src/middlewares/auth.middleware');

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
}

test('auth permission middleware rejects a user without the required permission', () => {
  const res = response();
  authorizeAnyPermission(['iam.users.write'])({ auth: { permissions: [] } }, res, () => {});
  assert.equal(res.statusCode, 403);
});

test('auth permission middleware allows a superuser', () => {
  let allowed = false;
  authorizeAnyPermission(['iam.users.write'])({ auth: { is_superuser: true } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);
});
