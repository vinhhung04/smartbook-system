const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.BORROW_POLICY_DATABASE_URL;
test('PRA05: a pre-upgrade partial payment cannot be allocated again by a legacy reference-only retry', { skip: !url }, async () => {
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/borrow_audit');
  process.env.DATABASE_URL = url;
  const db = new (require('@prisma/client').PrismaClient)();
  const p = require.resolve('../src/lib/prisma');
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { prisma: db } };
  const emitter = require.resolve('../src/lib/socket-emitter');
  require.cache[emitter] = { id: emitter, filename: emitter, loaded: true, exports: { pushEvents: async () => {} } };
  const actor = randomUUID(), reference = `LEGACY-${randomUUID()}`;
  try {
    const customer = await db.customers.create({ data: { customer_code: `LGP-${randomUUID().slice(0, 12)}`, full_name: 'Isolated pre-upgrade payment fixture', total_fine_balance: 80000 } });
    const fine = await db.fines.create({ data: { customer_id: customer.id, fine_type: 'DAMAGE', amount: 100000, status: 'PARTIALLY_PAID' } });
    const historical = await db.fine_payments.create({ data: { fine_id: fine.id, payment_method: 'TRANSFER', amount: 20000, transaction_reference: reference, paid_by_user_id: actor, note: 'Pre-upgrade payment' } });
    const { recordFinePayment } = require('../src/controllers/fine.controller');
    const invoke = async transaction_reference => {
      const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
      await recordFinePayment({ params: { id: fine.id }, user: { id: actor, is_superuser: true }, headers: {}, body: { amount: 20000, payment_method: 'TRANSFER', transaction_reference, note: 'Pre-upgrade payment' } }, res);
      return res;
    };
    const replay = await invoke(reference);
    assert.equal(replay.statusCode, 409, 'No original durable request result exists; require review instead of allocating money twice');
    assert.equal(replay.body.code, 'LEGACY_PAYMENT_REVIEW_REQUIRED');
    assert.equal(await db.fine_payments.count({ where: { fine_id: fine.id } }), 1);
    assert.deepEqual(await db.fine_payments.findUnique({ where: { id: historical.id } }), historical);
    assert.equal(Number((await db.customers.findUnique({ where: { id: customer.id } })).total_fine_balance), 80000);
    const fresh = await invoke(`NEW-${randomUUID()}`);
    assert.equal(fresh.statusCode, 200);
    assert.equal(await db.fine_payments.count({ where: { fine_id: fine.id } }), 2);
  } finally { await db.$disconnect(); }
});
