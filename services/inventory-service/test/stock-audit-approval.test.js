const test = require('node:test');
const assert = require('node:assert/strict');

const {
  claimSubmittedAuditForApproval,
} = require('../src/services/stock-audit-approval.service');

test('claims a submitted audit with one conditional database update', async () => {
  const calls = [];
  const tx = {
    stock_audits: {
      updateMany: async (args) => {
        calls.push(args);
        return { count: 1 };
      },
    },
  };

  const claimed = await claimSubmittedAuditForApproval(tx, 'audit-1', 'user-1', new Date('2026-08-15T00:00:00Z'));

  assert.equal(claimed, true);
  assert.deepEqual(calls, [{
    where: { id: 'audit-1', status: 'SUBMITTED' },
    data: {
      status: 'COMPLETED',
      reviewed_by_user_id: 'user-1',
      completed_at: new Date('2026-08-15T00:00:00Z'),
      updated_at: new Date('2026-08-15T00:00:00Z'),
    },
  }]);
});

test('reports a conflict when another transaction already claimed the audit', async () => {
  const tx = {
    stock_audits: {
      updateMany: async () => ({ count: 0 }),
    },
  };

  const claimed = await claimSubmittedAuditForApproval(tx, 'audit-1', 'user-1', new Date());

  assert.equal(claimed, false);
});
