const test = require('node:test');
const assert = require('node:assert/strict');

const {
  claimDraftReceiptForPosting,
} = require('../src/services/goods-receipt-posting.service');

test('claims a draft receipt with one conditional database update', async () => {
  const calls = [];
  const tx = {
    goods_receipts: {
      updateMany: async (args) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  const claimed = await claimDraftReceiptForPosting(tx, 'receipt-1', new Date('2026-08-15T00:00:00Z'));

  assert.equal(claimed, true);
  assert.deepEqual(calls, [{
    where: { id: 'receipt-1', status: 'DRAFT' },
    data: {
      status: 'POSTED',
      received_at: new Date('2026-08-15T00:00:00Z'),
      updated_at: new Date('2026-08-15T00:00:00Z'),
    },
  }]);
});

test('reports an idempotent replay when another transaction already claimed the receipt', async () => {
  const tx = {
    goods_receipts: {
      updateMany: async () => ({ count: 0 }),
    },
  };

  const claimed = await claimDraftReceiptForPosting(tx, 'receipt-1', new Date());

  assert.equal(claimed, false);
});
