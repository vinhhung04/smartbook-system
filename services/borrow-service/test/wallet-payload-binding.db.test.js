const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.BORROW_POLICY_DATABASE_URL;
const opts = { skip: !url && 'Independent audit PostgreSQL required' };
let db, account;
test.before(() => {
  if (!url) return;
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/borrow_audit');
  db = new (require('@prisma/client').PrismaClient)({ datasources: { db: { url } } });
  account = require('../src/services/account.service');
});
test.after(async () => db?.$disconnect());
async function fixture() {
  const customer = await db.customers.create({ data: { customer_code: `WKEY-${randomUUID().slice(0, 12)}`, full_name: 'Isolated wallet identity fixture' } });
  await db.customer_accounts.create({ data: { customer_id: customer.id, available_balance: 100000 } });
  return { customerId: customer.id, actorUserId: randomUUID(), amount: 10000, idempotencyKey: randomUUID(), referenceId: randomUUID(), referenceType: 'READINESS_TEST', note: 'Original operation', metadata: { method: 'CASH', request_reference: 'TEST-ONLY' } };
}
for (const operation of ['creditAccount', 'debitBorrowFee']) {
  test(`PRA20 ${operation}: legacy customer-scoped keys reconstruct immutable identity without rewriting history`, opts, async () => {
    const input = await fixture(), other = { ...input, customerId: (await fixture()).customerId };
    const createLegacy = data => db.$transaction(tx => account[operation](new Proxy(tx, { get(target, key) {
      if (key !== 'account_ledger') return Reflect.get(target, key);
      return new Proxy(tx.account_ledger, { get(model, method) {
        if (method !== 'create') return Reflect.get(model, method);
        return args => { const metadata = { ...args.data.metadata }; delete metadata._wallet_request; return model.create({ ...args, data: { ...args.data, metadata } }); };
      } });
    } }), data));
    const [first, second] = [await createLegacy(input), await createLegacy(other)];
    for (const [original, entry] of [[input, first.entry], [other, second.entry]]) {
      const replay = await db.$transaction(tx => account[operation](tx, { ...original, amount: '10000.00', metadata: { request_reference: 'TEST-ONLY', method: 'CASH' } }));
      assert.equal(replay.entry.id, entry.id);
      assert.equal(replay.idempotent, true);
      assert.deepEqual(await db.account_ledger.findUnique({ where: { id: entry.id } }), entry);
      await assert.rejects(db.$transaction(tx => account[operation](tx, { ...original, amount: 20000 })), e => e.code === 'IDEMPOTENCY_PAYLOAD_CONFLICT');
    }
  });
  test(`PRA20 ${operation}: a newly bound key cannot move money for another customer`, opts, async () => {
    const input = await fixture(), other = await fixture();
    await db.$transaction(tx => account[operation](tx, input));
    const before = await db.customer_accounts.findUnique({ where: { customer_id: other.customerId } });
    await assert.rejects(db.$transaction(tx => account[operation](tx, { ...input, customerId: other.customerId })), error => error.code === 'IDEMPOTENCY_PAYLOAD_CONFLICT');
    assert.deepEqual(await db.customer_accounts.findUnique({ where: { customer_id: other.customerId } }), before);
  });
  test(`PRA20 ${operation}: one committed ledger result survives concurrent same-key retries`, opts, async () => {
    const input = await fixture();
    const results = await Promise.all(Array.from({ length: 5 }, () => db.$transaction(tx => account[operation](tx, input))));
    assert.equal(new Set(results.map(r => r.entry.id)).size, 1);
    assert.equal(results.filter(r => !r.idempotent).length, 1);
    assert.equal(await db.account_ledger.count({ where: { customer_id: input.customerId, idempotency_key: input.idempotencyKey } }), 1);
  });
  for (const field of ['amount', 'actorUserId', 'referenceId', 'referenceType', 'note', 'metadata']) {
    test(`PRA20 ${operation}: same resource key with changed ${field} conflicts without moving money`, opts, async () => {
      const input = await fixture();
      await db.$transaction(tx => account[operation](tx, input));
      const before = await db.customer_accounts.findUnique({ where: { customer_id: input.customerId } });
      const changed = { amount: 20000, actorUserId: randomUUID(), referenceId: randomUUID(), referenceType: 'DIFFERENT_TEST', note: 'Different request', metadata: { method: 'BANK_TRANSFER' } };
      await assert.rejects(db.$transaction(tx => account[operation](tx, { ...input, [field]: changed[field] })), error => error.code === 'IDEMPOTENCY_PAYLOAD_CONFLICT');
      assert.deepEqual(await db.customer_accounts.findUnique({ where: { customer_id: input.customerId } }), before);
      assert.equal(await db.account_ledger.count({ where: { customer_id: input.customerId, idempotency_key: input.idempotencyKey } }), 1);
    });
  }
}

test('PRA20: concurrent cross-customer reuse binds one customer; the same key cannot switch CREDIT to DEBIT', opts, async () => {
  const first = await fixture(), second = { ...first, customerId: (await fixture()).customerId };
  const results = await Promise.allSettled([first, second].map(input => db.$transaction(tx => account.creditAccount(tx, input))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'IDEMPOTENCY_PAYLOAD_CONFLICT');
  const winner = results[0].status === 'fulfilled' ? first : second;
  await assert.rejects(db.$transaction(tx => account.debitBorrowFee(tx, winner)), e => e.code === 'IDEMPOTENCY_PAYLOAD_CONFLICT');
  assert.equal(await db.account_ledger.count({ where: { idempotency_key: first.idempotencyKey } }), 1);
});
