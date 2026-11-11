// Online wallet top-up through VNPay against a real PostgreSQL (claims, row locks and
// the unique ledger key cannot be checked with an in-memory fake).
// Runs only with DEPOSIT_TEST_DATABASE_URL pointing at a disposable, migrated database
// (same variable as deposit.db.test.js).

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, test, before, after } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const { reconcileCustomerAccount, getCustomerAccountSnapshot } = require('../src/services/account.service');
const { finalizeVnpayCallback } = require('../src/controllers/vnpay-webhook.controller');

const url = process.env.DEPOSIT_TEST_DATABASE_URL;
const skip = url ? false : 'DEPOSIT_TEST_DATABASE_URL is not set';
let prisma;

async function makeCustomer() {
  return prisma.customers.create({
    data: { customer_code: `T-${crypto.randomUUID().slice(0, 12)}`, full_name: 'Top-up test reader' },
  });
}

async function makeIntent(customerId, amount = 50000) {
  return prisma.wallet_topup_intents.create({
    data: {
      customer_id: customerId,
      txn_ref: `TU${Date.now()}${crypto.randomBytes(3).toString('hex')}`,
      amount,
      expires_at: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
}

function callback(intent, overrides = {}) {
  return {
    vnp_TxnRef: intent.txn_ref,
    vnp_ResponseCode: '00',
    vnp_Amount: String(Number(intent.amount) * 100),
    vnp_TransactionNo: `VNP${Date.now()}`,
    vnp_BankCode: 'NCB',
    ...overrides,
  };
}

async function wallet(customerId) {
  const account = await prisma.customer_accounts.findUnique({ where: { customer_id: customerId } });
  return account ? Number(account.available_balance) : 0;
}

describe('VNPay wallet top-up (PostgreSQL)', { skip }, () => {
  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
  });
  after(async () => {
    await prisma?.$disconnect();
  });

  test('a confirmed payment credits the wallet once, with a VNPAY_TOPUP ledger entry', async () => {
    const customer = await makeCustomer();
    const intent = await makeIntent(customer.id, 50000);
    const result = await finalizeVnpayCallback(prisma, callback(intent));

    assert.equal(result.kind, 'TOPUP');
    assert.equal(result.outcome, 'SUCCESS');
    assert.equal(await wallet(customer.id), 50000);
    const entry = await prisma.account_ledger.findFirst({ where: { customer_id: customer.id } });
    assert.equal(entry.entry_type, 'CREDIT');
    assert.equal(entry.reference_type, 'VNPAY_TOPUP');
    assert.equal(entry.idempotency_key, `vnpay-topup:${intent.txn_ref}`);
    const saved = await prisma.wallet_topup_intents.findUnique({ where: { id: intent.id } });
    assert.equal(saved.status, 'SUCCESS');
    assert.equal(saved.ledger_entry_id, entry.id);
    assert.equal((await prisma.$transaction((tx) => reconcileCustomerAccount(tx, customer.id))).ok, true);
  });

  test('a repeated callback is answered as already finalized and credits nothing more', async () => {
    const customer = await makeCustomer();
    const intent = await makeIntent(customer.id, 20000);
    await finalizeVnpayCallback(prisma, callback(intent));
    const again = await finalizeVnpayCallback(prisma, callback(intent));

    assert.equal(again.outcome, 'ALREADY_FINALIZED');
    assert.equal(again.intent.status, 'SUCCESS');
    assert.equal(await wallet(customer.id), 20000);
    assert.equal(await prisma.account_ledger.count({ where: { customer_id: customer.id } }), 1);
  });

  test('return URL and IPN arriving together credit exactly once', async () => {
    const customer = await makeCustomer();
    const intent = await makeIntent(customer.id, 30000);
    const results = await Promise.all([
      finalizeVnpayCallback(prisma, callback(intent)),
      finalizeVnpayCallback(prisma, callback(intent)),
    ]);

    assert.deepEqual(results.map((row) => row.outcome).sort(), ['ALREADY_FINALIZED', 'SUCCESS']);
    assert.equal(await wallet(customer.id), 30000);
  });

  test('a failed or cancelled payment credits nothing', async () => {
    const customer = await makeCustomer();
    const intent = await makeIntent(customer.id, 40000);
    const result = await finalizeVnpayCallback(prisma, callback(intent, { vnp_ResponseCode: '24' }));

    assert.equal(result.outcome, 'PAYMENT_FAILED');
    assert.equal((await prisma.wallet_topup_intents.findUnique({ where: { id: intent.id } })).status, 'FAILED');
    assert.equal(await wallet(customer.id), 0);
  });

  test('an amount that does not match the intent is rejected', async () => {
    const customer = await makeCustomer();
    const intent = await makeIntent(customer.id, 40000);
    const result = await finalizeVnpayCallback(prisma, callback(intent, { vnp_Amount: '99900000' }));

    assert.equal(result.outcome, 'AMOUNT_MISMATCH');
    assert.equal(await wallet(customer.id), 0);
  });

  test('a locked wallet leaves the intent PENDING so VNPay can retry later', async () => {
    const customer = await makeCustomer();
    await prisma.customer_accounts.create({ data: { customer_id: customer.id, status: 'SUSPENDED' } });
    const intent = await makeIntent(customer.id, 15000);
    await assert.rejects(finalizeVnpayCallback(prisma, callback(intent)), /SUSPENDED/);
    assert.equal((await prisma.wallet_topup_intents.findUnique({ where: { id: intent.id } })).status, 'PENDING');
  });

  test('opening a new reader wallet twice at once does not fail (first visit to the wallet page)', async () => {
    const customer = await makeCustomer();
    const results = await Promise.all([
      prisma.$transaction((tx) => getCustomerAccountSnapshot(tx, customer.id)),
      prisma.$transaction((tx) => getCustomerAccountSnapshot(tx, customer.id)),
    ]);
    assert.equal(results[0].account.id, results[1].account.id);
    assert.equal(await prisma.customer_accounts.count({ where: { customer_id: customer.id } }), 1);
  });

  test('a callback for a fine payment still goes to the fine flow', async () => {
    const result = await finalizeVnpayCallback(prisma, { vnp_TxnRef: 'SB-not-a-topup', vnp_ResponseCode: '00', vnp_Amount: '100' });
    assert.equal(result.kind, 'FINE');
    assert.equal(result.outcome, 'NOT_FOUND');
  });
});
