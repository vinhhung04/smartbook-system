const test = require('node:test');
const assert = require('node:assert/strict');
const pgPath = require.resolve('pg');
const pools = [];
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: { Pool: class {
  constructor() { pools.push(this); }
} } };
process.env.INVENTORY_DATABASE_URL = 'postgresql://fixture.invalid/inventory';
process.env.BORROW_DATABASE_URL = 'postgresql://fixture.invalid/borrow';
const { closePools } = require('../src/lib/db');
test('both analytics pools receive cleanup and any failed close reaches the lifecycle result', async () => {
  let secondClosed = false;
  pools[0].end = async () => { throw new Error('first pool close failed'); };
  pools[1].end = async () => { secondClosed = true; };
  await assert.rejects(closePools(), /first pool close failed/);
  assert.equal(secondClosed, true);
});
