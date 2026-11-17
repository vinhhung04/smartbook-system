const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.BORROW_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
let prisma, controller;
const inventory = { calls: [], failAt: 0, onReturn: null };
const integrationPath = require.resolve('../src/services/inventory-integration.service');
require.cache[integrationPath] = { id: integrationPath, filename: integrationPath, loaded: true, exports: {
  returnBorrowedStock: async input => {
    inventory.calls.push(input);
    if (inventory.onReturn) await inventory.onReturn(input);
    if (inventory.calls.length === inventory.failAt) throw Object.assign(new Error('Uncertain remote return'), { status: 502 });
  },
  getReturnLocations: async () => [],
} };
test.before(() => {
  if (!url) return;
  const { PrismaClient } = process.env.BORROW_AUDIT_PRISMA_CLIENT ? require(process.env.BORROW_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  prisma = new PrismaClient();
  const p = require.resolve('../src/lib/prisma');
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { prisma } };
  controller = require('../src/controllers/loan.controller');
});
test.after(async () => prisma?.$disconnect());
const opts = { skip: !url && 'BORROW_TEST_DATABASE_URL not set' };
async function fixture() {
  inventory.calls = []; inventory.failAt = 0; inventory.onReturn = null;
  const customer = await prisma.customers.create({ data: { customer_code: `MIX-${randomUUID().slice(0, 10)}`, full_name: 'Mixed return audit' } });
  const plan = await prisma.membership_plans.create({ data: { code: `MIX-${randomUUID().slice(0, 10)}`, name: 'Mixed return', fine_per_day: 0, deposit_per_item: 30000 } });
  await prisma.customer_memberships.create({ data: { customer_id: customer.id, plan_id: plan.id, card_number: randomUUID(), start_date: new Date(Date.now() - 86400000) } });
  const loan = await prisma.loan_transactions.create({ data: { loan_number: `MIX-${randomUUID()}`, customer_id: customer.id, handled_by_user_id: randomUUID(), warehouse_id: randomUUID(), due_date: new Date(Date.now() + 86400000), total_items: 3 } });
  await prisma.loan_items.createMany({ data: [1, 2, 3].map(() => ({ id: randomUUID(), loan_id: loan.id, variant_id: randomUUID(), due_date: loan.due_date })) });
  const items = await prisma.loan_items.findMany({ where: { loan_id: loan.id }, orderBy: { id: 'asc' } });
  const { creditAccount } = require('../src/services/account.service');
  const { holdLoanItemDeposits } = require('../src/services/deposit.service');
  await prisma.$transaction(async tx => {
    await creditAccount(tx, { customerId: customer.id, amount: 90000, entryType: 'TOPUP', idempotencyKey: `mixed-credit-${randomUUID()}` });
    await holdLoanItemDeposits(tx, { customerId: customer.id, loanId: loan.id, loanNumber: loan.loan_number, items, amountPerItem: 30000 });
  });
  const payload = { items: items.map((item, index) => ({ loan_item_id: item.id, item_condition_on_return: ['GOOD', 'DAMAGED', 'LOST'][index], notes: `copy ${index}`, settlement_reason: index ? 'Staff verified condition' : '' })) };
  return { customer, loan, items, payload };
}
async function call(handler, loan, body, key = randomUUID(), method = 'POST') {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(data) { this.body = data; return this; } };
  await handler({ params: { id: loan.id }, method, body, query: {}, headers: { 'idempotency-key': key }, user: { id: randomUUID(), is_superuser: true } }, res);
  return res;
}
test('SB20: one request previews and settles GOOD, DAMAGED and LOST independently', opts, async () => {
  const f = await fixture();
  const preview = await call(controller.previewLoanReturn, f.loan, f.payload);
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.data.totals.penalty, 150000);
  const key = randomUUID();
  const returned = await call(controller.returnLoan, f.loan, f.payload, key);
  assert.equal(returned.statusCode, 200, JSON.stringify(returned.body));
  const stored = await prisma.loan_items.findMany({ where: { loan_id: f.loan.id }, orderBy: { id: 'asc' } });
  assert.deepEqual(stored.map(i => i.status), ['RETURNED', 'RETURNED', 'LOST']);
  assert.deepEqual(stored.map(i => i.notes), ['copy 0', 'copy 1', 'copy 2']);
  assert.deepEqual(inventory.calls.map(i => i.item_condition_on_return), ['GOOD', 'DAMAGED', 'LOST']);
  assert.equal(returned.body.data.item_results.length, 3);
  const deposits = await prisma.loan_item_deposits.findMany({ where: { loan_id: f.loan.id }, orderBy: { loan_item_id: 'asc' } });
  assert.deepEqual(deposits.map(d => Number(d.refunded_amount)), [30000, 0, 0]);
  assert.equal((await prisma.loan_transactions.findUnique({ where: { id: f.loan.id } })).status, 'LOST');
  const replay = await call(controller.returnLoan, f.loan, { items: [...f.payload.items].reverse() }, key);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(inventory.calls.length, 3);
  const conflict = await call(controller.returnLoan, f.loan, { items: f.payload.items.map(i => ({ ...i, notes: 'different payload' })) }, key);
  assert.equal(conflict.statusCode, 409);
});
test('SB20: duplicate, foreign, inactive and unexplained damaged copies fail before any stock call', opts, async () => {
  const f = await fixture();
  for (const rows of [
    [f.payload.items[0], f.payload.items[0]],
    [{ ...f.payload.items[0], loan_item_id: randomUUID() }],
    [{ ...f.payload.items[1], settlement_reason: '', notes: '' }],
    [{ ...f.payload.items[0], item_condition_on_return: 'INVALID' }],
    [{ ...f.payload.items[0], returned_to_location_id: randomUUID() }],
  ]) {
    const result = await call(controller.returnLoan, f.loan, { items: rows });
    assert.ok([400, 409].includes(result.statusCode), JSON.stringify(result.body));
    assert.equal(inventory.calls.length, 0);
  }
});
test('SB20: uncertain mid-batch remote return is reconciled with per-copy outcomes', opts, async () => {
  const f = await fixture(); inventory.failAt = 2;
  const key = randomUUID();
  const result = await call(controller.returnLoan, f.loan, f.payload, key);
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.detail.reconciliation_queued, true);
  assert.deepEqual(result.body.detail.item_results.map(r => r.status), ['RECONCILIATION_REQUIRED', 'UNKNOWN', 'NOT_PROCESSED']);
  const outbox = await prisma.integration_outbox.findFirst({ where: { aggregate_id: f.loan.id, event_type: 'LOAN_RETURN_UNRESOLVED' } });
  assert.deepEqual(outbox.payload.loan_item_ids, f.items.slice(0, 2).map(i => i.id));
  assert.equal(await prisma.loan_items.count({ where: { loan_id: f.loan.id, status: 'BORROWED' } }), 3);
  inventory.failAt = 0;
  const retried = await call(controller.returnLoan, f.loan, f.payload, key);
  assert.equal(retried.statusCode, 200);
  assert.equal(await prisma.loan_items.count({ where: { loan_id: f.loan.id, status: 'BORROWED' } }), 0);
  assert.equal((await prisma.loan_return_requests.findUnique({ where: { idempotency_key: key } })).status, 'COMPLETED');
  assert.equal((await prisma.integration_outbox.findUnique({ where: { id: outbox.id } })).status, 'PUBLISHED');
});
test('SB20: concurrent batches cannot bind one parent key to different copies', opts, async () => {
  const f = await fixture();
  const key = randomUUID();
  let startedResolve, releaseResolve;
  const started = new Promise(resolve => { startedResolve = resolve; });
  const release = new Promise(resolve => { releaseResolve = resolve; });
  inventory.onReturn = async () => { startedResolve(); await release; };
  const first = call(controller.returnLoan, f.loan, { items: [f.payload.items[0]] }, key);
  await started;
  const conflict = await call(controller.returnLoan, f.loan, { items: [f.payload.items[1]] }, key);
  assert.equal(conflict.statusCode, 409);
  assert.equal(inventory.calls.length, 1, 'conflicting batch must never reach inventory');
  releaseResolve();
  assert.equal((await first).statusCode, 200);
});
