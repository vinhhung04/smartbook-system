'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalRoles } = require('../runtime/roles.cjs');

test('a token issued before the rename still reads as MANAGER', () => {
  assert.deepEqual(canonicalRoles(['WAREHOUSE_MANAGER', 'LIBRARIAN']), ['MANAGER', 'LIBRARIAN']);
  assert.deepEqual(canonicalRoles(['warehouse_manager']), ['MANAGER']);
});

test('current codes pass unchanged, a role is never listed twice', () => {
  assert.deepEqual(canonicalRoles(['MANAGER', 'WAREHOUSE_MANAGER', 'ADMIN']), ['MANAGER', 'ADMIN']);
  assert.deepEqual(canonicalRoles(['WAREHOUSE_STAFF']), ['WAREHOUSE_STAFF']);
  assert.equal(canonicalRoles(undefined), undefined);
});
