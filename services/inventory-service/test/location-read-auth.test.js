const test = require('node:test');
const assert = require('node:assert/strict');
const { authorizeLocationRead } = require('../src/middlewares/auth.middleware');

const guard = authorizeLocationRead(['inventory.warehouse.read']);

function run(user) {
  let status = 200;
  let passed = false;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  guard({ user }, res, () => { passed = true; });
  return passed ? 200 : status;
}

test('librarian handling loans may read branch locations (return shelf picker)', () => {
  assert.equal(run({ roles: ['LIBRARIAN'], permissions: ['borrow.loans.write'] }), 200);
  assert.equal(run({ roles: ['CUSTOMER_SERVICE'], permissions: ['borrow.loans.write'] }), 200);
});

test('librarian without loan write, or other roles without inventory read, are refused', () => {
  assert.equal(run({ roles: ['LIBRARIAN'], permissions: ['borrow.loans.read'] }), 403);
  assert.equal(run({ roles: ['CUSTOMER'], permissions: ['borrow.loans.write'] }), 403);
  assert.equal(run({ roles: ['LIBRARIAN'], permissions: ['inventory.warehouse.read'] }), 403);
});

test('warehouse roles keep their existing access', () => {
  assert.equal(run({ roles: ['WAREHOUSE_STAFF'], permissions: ['inventory.warehouse.read'] }), 200);
  assert.equal(run({ roles: ['WAREHOUSE_STAFF'], permissions: [] }), 403);
  assert.equal(run({ is_superuser: true }), 200);
});
