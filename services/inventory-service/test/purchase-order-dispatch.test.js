const test = require('node:test');
const assert = require('node:assert/strict');

const {
  claimApprovedOrderForDispatch,
} = require('../src/services/purchase-order-dispatch.service');

test('claims an approved purchase order with one conditional database update', async () => {
  const calls = [];
  const tx = {
    purchase_orders: {
      updateMany: async (args) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  const claimed = await claimApprovedOrderForDispatch(tx, 'po-1', new Date('2026-08-15T00:00:00Z'));

  assert.equal(claimed, true);
  assert.deepEqual(calls, [{
    where: { id: 'po-1', status: 'APPROVED' },
    data: {
      status: 'SENT_TO_SUPPLIER',
      updated_at: new Date('2026-08-15T00:00:00Z'),
    },
  }]);
});

test('reports a conflict when another transaction already claimed the purchase order', async () => {
  const tx = {
    purchase_orders: {
      updateMany: async () => ({ count: 0 }),
    },
  };

  const claimed = await claimApprovedOrderForDispatch(tx, 'po-1', new Date());

  assert.equal(claimed, false);
});
