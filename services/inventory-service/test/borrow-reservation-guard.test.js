const test = require('node:test');
const assert = require('node:assert/strict');

const {
  releaseReservedStock,
  consumeReservedStock,
} = require('../src/services/borrow-reservation-guard.service');

test('releaseReservedStock applies one conditional update guarded by reserved_qty', async () => {
  const calls = [];
  const tx = {
    stock_balances: {
      updateMany: async (args) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  const claimed = await releaseReservedStock(tx, { variant_id: 'v-1', location_id: 'l-1', quantity: 2 });

  assert.equal(claimed, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].where, { variant_id: 'v-1', location_id: 'l-1', reserved_qty: { gte: 2 } });
  assert.deepEqual(calls[0].data.available_qty, { increment: 2 });
  assert.deepEqual(calls[0].data.reserved_qty, { decrement: 2 });
});

test('releaseReservedStock reports conflict when reserved_qty no longer covers the quantity', async () => {
  const tx = {
    stock_balances: {
      updateMany: async () => ({ count: 0 }),
    },
  };

  const claimed = await releaseReservedStock(tx, { variant_id: 'v-1', location_id: 'l-1', quantity: 2 });

  assert.equal(claimed, false);
});

test('consumeReservedStock applies one conditional update guarded by reserved_qty', async () => {
  const calls = [];
  const tx = {
    stock_balances: {
      updateMany: async (args) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  const claimed = await consumeReservedStock(tx, { variant_id: 'v-1', location_id: 'l-1', quantity: 3 });

  assert.equal(claimed, true);
  assert.deepEqual(calls[0].where, { variant_id: 'v-1', location_id: 'l-1', reserved_qty: { gte: 3 } });
  assert.deepEqual(calls[0].data.reserved_qty, { decrement: 3 });
  assert.deepEqual(calls[0].data.borrowed_qty, { increment: 3 });
});

test('consumeReservedStock reports conflict when reserved_qty no longer covers the quantity', async () => {
  const tx = {
    stock_balances: {
      updateMany: async () => ({ count: 0 }),
    },
  };

  const claimed = await consumeReservedStock(tx, { variant_id: 'v-1', location_id: 'l-1', quantity: 3 });

  assert.equal(claimed, false);
});
