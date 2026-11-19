const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.BORROW_POLICY_DATABASE_URL;
let prisma, fines, finalize;
const options = { skip: !url && 'BORROW_POLICY_DATABASE_URL not set' };
const actor = { id: randomUUID(), is_superuser: true, permissions: ['borrow.fines.manage'] };
test.before(async () => {
  if (!url) return;
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/borrow_audit');
  assert.ok(['25432', '5432'].includes(target.port), 'isolated audit PostgreSQL only');
  process.env.DATABASE_URL = url;
  const { PrismaClient } = require('@prisma/client');
  prisma = new PrismaClient();
  const p = require.resolve('../src/lib/prisma');
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { prisma } };
  const emitter = require.resolve('../src/lib/socket-emitter');
  require.cache[emitter] = { id: emitter, filename: emitter, loaded: true, exports: { pushEvents: async () => {} } };
  fines = require('../src/controllers/fine.controller');
  ({ finalizeVnpayPayment: finalize } = require('../src/services/vnpay-payment.service'));
});
test.after(async () => prisma?.$disconnect());
async function fixture(amounts = [100000]) {
  const customer = await prisma.customers.create({ data: { customer_code: `FIN-${randomUUID().slice(0, 12)}`, full_name: 'Independent financial fixture', total_fine_balance: amounts.reduce((a, b) => a + b, 0) } });
  const rows = [];
  for (const amount of amounts) rows.push(await prisma.fines.create({ data: { customer_id: customer.id, fine_type: 'DAMAGE', amount } }));
  return { customer, rows };
}
async function call(handler, fineId, body, key = randomUUID(), user = actor) {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
  await handler({ params: { id: fineId }, body, user, headers: key ? { 'idempotency-key': key } : {} }, res);
  return res;
}
async function intent(fine, extra = {}) {
  return prisma.fine_payment_intents.create({ data: { fine_id: fine.id, customer_id: fine.customer_id, txn_ref: `FIN${randomUUID().replaceAll('-', '')}`, amount: fine.amount, expires_at: new Date(Date.now() + 600000), ...extra } });
}
function callback(row, extra = {}) {
  return { vnp_TxnRef: row.txn_ref, vnp_ResponseCode: '00', vnp_Amount: String(Number(row.amount) * 100), vnp_TransactionNo: `VP${randomUUID().replaceAll('-', '')}`, ...extra };
}
test('PRA05: a lost-response retry replays the original partial payment and rejects changed identity', options, async () => {
  const { rows: [fine, other] } = await fixture([100000, 100000]);
  const key = randomUUID();
  const first = await call(fines.recordFinePayment, fine.id, { amount: 20000, transaction_reference: 'one-bank-transfer' }, key);
  const replay = await call(fines.recordFinePayment, fine.id, { amount: 20000, transaction_reference: 'one-bank-transfer' }, key);
  assert.equal(first.statusCode, 200); assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.data.payment_id, first.body.data.payment_id);
  assert.equal(await prisma.fine_payments.count({ where: { fine_id: fine.id } }), 1);
  for (const [id, body] of [[fine.id, { amount: 30000, transaction_reference: 'one-bank-transfer' }], [fine.id, { amount: 20000, transaction_reference: 'different-bank-transfer' }], [other.id, { amount: 20000, transaction_reference: 'one-bank-transfer' }]]) {
    assert.equal((await call(fines.recordFinePayment, id, body, key)).statusCode, 409);
  }
  assert.equal((await call(fines.recordFinePayment, fine.id, { amount: 20000, transaction_reference: 'one-bank-transfer' }, key, { ...actor, id: randomUUID() })).statusCode, 409);
});
test('PRA05: concurrent same-key requests record one payment; distinct keys remain distinct', options, async () => {
  const { rows: [fine] } = await fixture(); const key = randomUUID();
  const responses = await Promise.all([1, 2].map(() => call(fines.recordFinePayment, fine.id, { amount: 20000 }, key)));
  assert.deepEqual(responses.map(r => r.statusCode), [200, 200]);
  assert.equal(responses[0].body.data.payment_id, responses[1].body.data.payment_id);
  assert.equal((await call(fines.recordFinePayment, fine.id, { amount: 20000, transaction_reference: 'second-transfer' })).statusCode, 200);
  assert.equal(await prisma.fine_payments.count({ where: { fine_id: fine.id } }), 2);
});
test('PRA05: identity-less legacy payment is refused before changing money', options, async () => {
  const { rows: [fine] } = await fixture();
  assert.equal((await call(fines.recordFinePayment, fine.id, { amount: 20000 }, null)).statusCode, 400);
  assert.equal(await prisma.fine_payments.count({ where: { fine_id: fine.id } }), 0);
});
for (const kind of ['partial', 'waived', 'paid', 'expired']) {
  test(`PRA01: successful ${kind} fine callback preserves gross money and unapplied remainder`, options, async () => {
    const { rows: [fine] } = await fixture();
    const row = await intent(fine, kind === 'expired' ? { status: 'EXPIRED', expires_at: new Date(Date.now() - 60000) } : {});
    if (kind === 'partial') await call(fines.recordFinePayment, fine.id, { amount: 20000 });
    if (kind === 'paid') await call(fines.recordFinePayment, fine.id, { amount: 100000 });
    if (kind === 'waived') await call(fines.waiveFine, fine.id, { note: 'Authorized fixture waiver' });
    const params = callback(row);
    const result = await finalize(prisma, params);
    assert.equal(result.outcome, 'SUCCESS');
    assert.equal(result.intent.status, 'SUCCESS');
    const settlement = await prisma.provider_payment_settlements.findUnique({ where: { intent_id: row.id } });
    assert.equal(Number(settlement.received_amount), 100000);
    const applied = kind === 'partial' ? 80000 : ['waived', 'paid'].includes(kind) ? 0 : 100000;
    assert.equal(Number(settlement.applied_amount), applied);
    assert.equal(Number(settlement.unapplied_amount), 100000 - applied);
    assert.equal((await finalize(prisma, params)).outcome, 'ALREADY_FINALIZED');
    assert.equal(await prisma.provider_payment_settlements.count({ where: { intent_id: row.id } }), 1);
  });
}
test('PRA01: concurrent callbacks settle once and local commit failure remains retryable', options, async () => {
  const { rows: [fine] } = await fixture(); const row = await intent(fine); const params = callback(row);
  const failCommit = { $transaction: fn => prisma.$transaction(async tx => { await fn(tx); throw new Error('injected commit failure'); }) };
  await assert.rejects(finalize(failCommit, params), /injected commit failure/);
  assert.equal((await prisma.fine_payment_intents.findUnique({ where: { id: row.id } })).status, 'PENDING');
  assert.equal(await prisma.fine_payments.count({ where: { fine_id: fine.id } }), 0);
  const results = await Promise.all([finalize(prisma, params), finalize(prisma, params)]);
  assert.deepEqual(results.map(r => r.outcome).sort(), ['ALREADY_FINALIZED', 'SUCCESS']);
  assert.equal(await prisma.provider_payment_settlements.count({ where: { intent_id: row.id } }), 1);
});
test('PRA01: settled replay still validates amount and provider transaction identity', options, async () => {
  const { rows: [fine] } = await fixture(); const row = await intent(fine); const params = callback(row);
  assert.equal((await finalize(prisma, params)).outcome, 'SUCCESS');
  assert.equal((await finalize(prisma, { ...params, vnp_Amount: '1' })).outcome, 'AMOUNT_MISMATCH');
  assert.equal((await finalize(prisma, { ...params, vnp_TransactionNo: 'different-provider-identity' })).outcome, 'TRANSACTION_CONFLICT');
  assert.equal(await prisma.fine_payments.count({ where: { fine_id: fine.id } }), 1);
});
test('PRA01: one provider transaction cannot pay two different intents', options, async () => {
  const rows = [(await fixture([50000])).rows[0], (await fixture([50000])).rows[0]];
  const intents = await Promise.all(rows.map(row => intent(row)));
  const transactionNo = `VP${randomUUID().replaceAll('-', '')}`;
  const results = await Promise.all(intents.map(row => finalize(prisma, callback(row, { vnp_TransactionNo: transactionNo }))));
  assert.deepEqual(results.map(r => r.outcome).sort(), ['SUCCESS', 'TRANSACTION_CONFLICT']);
  assert.equal(await prisma.provider_payment_settlements.count({ where: { provider_transaction_no: transactionNo } }), 1);
  assert.equal(await prisma.fine_payments.count({ where: { fine_id: { in: rows.map(row => row.id) } } }), 1);
});
test('PRA01: a previously failed local intent still records a later verified provider success', options, async () => {
  const { rows: [fine] } = await fixture(); const row = await intent(fine, { status: 'FAILED', vnp_response_code: '24' });
  const result = await finalize(prisma, callback(row));
  assert.equal(result.outcome, 'SUCCESS');
  assert.equal(Number(result.settlement.received_amount), 100000);
});
test('PRA05: legacy transaction reference replay is scoped and still rejects changed amount', options, async () => {
  const { rows: [fine, other] } = await fixture([100000, 100000]);
  const body = { amount: 20000, transaction_reference: 'legitimate-reference' };
  const first = await call(fines.recordFinePayment, fine.id, body, null);
  const replay = await call(fines.recordFinePayment, fine.id.toUpperCase(), body, null);
  assert.equal(replay.body.data.payment_id, first.body.data.payment_id);
  assert.equal((await call(fines.recordFinePayment, fine.id, { ...body, amount: 30000 }, null)).statusCode, 409);
  assert.equal((await call(fines.recordFinePayment, other.id, body, null)).statusCode, 200);
});
test('PRA01: simultaneous live link creation returns one link and rejects the second', options, async () => {
  const oldCode = process.env.VNPAY_TMN_CODE, oldSecret = process.env.VNPAY_HASH_SECRET;
  process.env.VNPAY_TMN_CODE = 'isolated-fixture-merchant'; process.env.VNPAY_HASH_SECRET = 'isolated-fixture-signing-secret';
  try {
    const { createFinePaymentIntent } = require('../src/services/fine-payment-intent.service');
    const { customer, rows: [fine] } = await fixture();
    const responses = await Promise.all([1, 2].map(() => createFinePaymentIntent(prisma, { customerId: customer.id, fineId: fine.id, ipAddr: '127.0.0.1' })));
    assert.deepEqual(responses.map(r => r.code).sort(), [201, 409]);
    assert.equal(await prisma.fine_payment_intents.count({ where: { fine_id: fine.id, status: 'PENDING' } }), 1);
  } finally {
    if (oldCode == null) delete process.env.VNPAY_TMN_CODE; else process.env.VNPAY_TMN_CODE = oldCode;
    if (oldSecret == null) delete process.env.VNPAY_HASH_SECRET; else process.env.VNPAY_HASH_SECRET = oldSecret;
  }
});
test('PRA01: immutable settlement conserves money and has a durable unapplied case', options, async () => {
  const { rows: [fine] } = await fixture(); const row = await intent(fine);
  await call(fines.waiveFine, fine.id, { note: 'Authorized waiver' });
  const { settlement } = await finalize(prisma, callback(row));
  assert.equal(await prisma.integration_outbox.count({ where: { aggregate_id: settlement.id, event_type: 'PAYMENT_UNAPPLIED', status: 'PENDING' } }), 1);
  await assert.rejects(prisma.provider_payment_settlements.update({ where: { id: settlement.id }, data: { unapplied_amount: 0 } }), /append-only/);
  await assert.rejects(prisma.provider_payment_settlements.delete({ where: { id: settlement.id } }), /append-only/);
});
test('PRA06: different fines on one customer cannot overwrite a newer aggregate', options, async () => {
  const { customer, rows } = await fixture([50000, 50000]);
  // Widen the vulnerable READ COMMITTED interleaving; a correct customer lock
  // serializes before these reads, so the timer releases the first writer.
  let readCount = 0, release;
  const bothReads = new Promise(resolve => { release = resolve; });
  const instrumented = new Proxy(prisma, { get(p, key) {
    if (key === '$transaction') return fn => p.$transaction(tx => fn(new Proxy(tx, { get(t, field) {
      if (field === 'fines') return new Proxy(t.fines, { get(model, method) {
        if (method === 'findMany') return async args => { const data = await model.findMany(args); if (++readCount === 2) release(); await Promise.race([bothReads, new Promise(r => setTimeout(r, 100))]); return data; };
        return typeof model[method] === 'function' ? model[method].bind(model) : model[method];
      } });
      return typeof t[field] === 'function' ? t[field].bind(t) : t[field];
    } })), { timeout: 10000 });
    return typeof p[key] === 'function' ? p[key].bind(p) : p[key];
  } });
  const modulePath = require.resolve('../src/lib/prisma');
  const controllerPath = require.resolve('../src/controllers/fine.controller');
  const previous = require.cache[modulePath].exports;
  require.cache[modulePath].exports = { prisma: instrumented }; delete require.cache[controllerPath];
  try {
    const controller = require(controllerPath);
    const results = await Promise.all(rows.map(row => call(controller.recordFinePayment, row.id, { amount: 50000 })));
    assert.deepEqual(results.map(r => r.statusCode), [200, 200]);
    assert.equal(Number((await prisma.customers.findUnique({ where: { id: customer.id } })).total_fine_balance), 0);
  } finally { require.cache[modulePath].exports = previous; delete require.cache[controllerPath]; }
});
