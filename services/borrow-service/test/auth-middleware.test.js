const assert = require('node:assert/strict');
const test = require('node:test');
const { authorizeAnyRole, authorizeCustomerSelf } = require('../src/middlewares/auth.middleware');

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
}

test('borrow role middleware normalizes the legacy customer-service role', () => {
  let allowed = false;
  authorizeAnyRole(['LIBRARIAN'])({ user: { roles: ['CUSTOMER_SERVICE'] } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);
});

test('customer self-service requires both role and permission', () => {
  const res = response();
  authorizeCustomerSelf({ user: { roles: ['CUSTOMER'], permissions: [] } }, res, () => {});
  assert.equal(res.statusCode, 403);
});
