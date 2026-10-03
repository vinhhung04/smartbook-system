const test = require('node:test');
const assert = require('node:assert/strict');

const { upsertFine } = require('../src/services/fine.service');

// Fake transaction client that records the order of operations.
function createFakeTx({ existing = null } = {}) {
  const calls = [];
  const tx = {
    calls,
    async $executeRaw(strings, ...values) {
      calls.push({ op: 'lock', sql: strings.join('?'), values });
    },
    fines: {
      async findFirst(args) {
        calls.push({ op: 'findFirst', args });
        return existing;
      },
      async update(args) {
        calls.push({ op: 'update', args });
        return { ...existing, ...args.data };
      },
      async create(args) {
        calls.push({ op: 'create', args });
        return { id: 'new-fine', ...args.data };
      },
    },
  };
  return tx;
}

const base = { customerId: 'cust-1', loanItemId: 'item-1', fineType: 'OVERDUE', amount: 9000 };

test('upsertFine takes the per-(loan item, fine type) advisory lock before looking for an existing fine', async () => {
  const tx = createFakeTx();
  await upsertFine(tx, base);

  assert.deepEqual(tx.calls.map((c) => c.op), ['lock', 'findFirst', 'create']);
  assert.match(tx.calls[0].sql, /pg_advisory_xact_lock/);
  assert.deepEqual(tx.calls[0].values, ['fine:item-1:OVERDUE']);
});

test('upsertFine creates one UNPAID fine when none exists', async () => {
  const tx = createFakeTx();
  const fine = await upsertFine(tx, { ...base, actorUserId: 'staff-1', note: 'Quá hạn 3 ngày' });

  assert.equal(fine.status, 'UNPAID');
  assert.equal(fine.amount, 9000);
  assert.equal(tx.calls.filter((c) => c.op === 'create').length, 1);
});

test('upsertFine never re-bills a fine that is already PAID or WAIVED (one fine per loan item and type)', async () => {
  for (const status of ['PAID', 'WAIVED']) {
    const existing = { id: 'fine-1', status, amount: 8000, note: null };
    const tx = createFakeTx({ existing });
    const fine = await upsertFine(tx, { ...base, amount: 9000 });

    assert.equal(fine, existing, status);
    assert.deepEqual(tx.calls.map((c) => c.op), ['lock', 'findFirst'], `${status}: no update/create`);
  }
});

test('upsertFine updates an open fine in place when the amount grew, and is a no-op when unchanged', async () => {
  const open = { id: 'fine-1', status: 'UNPAID', amount: 8000, note: 'cũ' };

  const grew = createFakeTx({ existing: open });
  await upsertFine(grew, { ...base, amount: 9000 });
  assert.deepEqual(grew.calls.map((c) => c.op), ['lock', 'findFirst', 'update']);
  assert.equal(grew.calls[2].args.data.amount, 9000);

  const same = createFakeTx({ existing: open });
  const result = await upsertFine(same, { ...base, amount: 8000 });
  assert.equal(result, open);
  assert.deepEqual(same.calls.map((c) => c.op), ['lock', 'findFirst']);
});

test('upsertFine ignores a non-positive amount without touching the database', async () => {
  const tx = createFakeTx();
  assert.equal(await upsertFine(tx, { ...base, amount: 0 }), null);
  assert.equal(tx.calls.length, 0);
});
