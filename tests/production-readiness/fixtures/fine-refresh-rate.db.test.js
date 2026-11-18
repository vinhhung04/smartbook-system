// Isolated follow-up review fixture, deliberately outside service test globs.
// Run against borrow_audit only; all sweep reads are limited to this test's item.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const serviceRoot = process.env.BORROW_SERVICE_ROOT || path.resolve(__dirname, '../../../services/borrow-service');
const url = process.env.BORROW_POLICY_DATABASE_URL;

test('financial review: payment refresh and sweep agree after membership daily-rate change', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.pathname === '/borrow_audit');
  process.env.DATABASE_URL = url;
  const { PrismaClient } = require(path.join(serviceRoot, 'node_modules/@prisma/client'));
  const prisma = new PrismaClient();
  const prismaPath = require.resolve(path.join(serviceRoot, 'src/lib/prisma'));
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma } };
  const emitterPath = require.resolve(path.join(serviceRoot, 'src/lib/socket-emitter'));
  require.cache[emitterPath] = { id: emitterPath, filename: emitterPath, loaded: true,
    exports: { pushEvent: async () => {}, pushEvents: async () => {} } };
  const { upsertFine, runOverdueSweep } = require(path.join(serviceRoot, 'src/services/fine.service'));
  const { recordFinePayment } = require(path.join(serviceRoot, 'src/controllers/fine.controller'));
  const actor = { id: randomUUID(), is_superuser: true, permissions: ['borrow.fines.manage'] };
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const due = new Date(today.getTime() - 12 * 86400000);
  async function fixture() {
    const tag = randomUUID();
    const customer = await prisma.customers.create({ data: { customer_code: `RF-${tag.slice(0, 12)}`, full_name: 'Isolated rate refresh review' } });
    const plan = await prisma.membership_plans.create({ data: { code: `RF-${tag.slice(0, 12)}`, name: 'Isolated changing-rate plan', fine_per_day: 5000 } });
    await prisma.customer_memberships.create({ data: { customer_id: customer.id, plan_id: plan.id, card_number: `RF-${tag}`, start_date: new Date(due.getTime() - 86400000) } });
    const loan = await prisma.loan_transactions.create({ data: { loan_number: `RF-${tag}`, customer_id: customer.id,
      warehouse_id: randomUUID(), handled_by_user_id: actor.id, due_date: due, total_items: 1 } });
    const item = await prisma.loan_items.create({ data: { loan_id: loan.id, variant_id: randomUUID(), due_date: due } });
    const historical = await prisma.$transaction(tx => upsertFine(tx, { customerId: customer.id, loanItemId: item.id,
      fineType: 'OVERDUE', amount: 50000, overdueDays: 10, dailyRate: 5000, actorUserId: actor.id }));
    await prisma.membership_plans.update({ where: { id: plan.id }, data: { fine_per_day: 7000 } });
    return { customer, item, historical };
  }
  function sweepOnly(itemId) {
    return runOverdueSweep({
      loan_items: { findMany: args => prisma.loan_items.findMany({ ...args, where: { AND: [args.where, { id: itemId }] } }) },
      customer_memberships: prisma.customer_memberships,
      $transaction: prisma.$transaction.bind(prisma),
    }, { now, limit: 10 });
  }
  const periods = itemId => prisma.fines.findMany({ where: { loan_item_id: itemId }, orderBy: { accrual_from_days: 'asc' }, include: { fine_payments: true } });
  try {
    await t.test('control: sweep preserves ten old-rate days and opens two current-rate days', async () => {
      const f = await fixture();
      await sweepOnly(f.item.id);
      const rows = await periods(f.item.id);
      assert.deepEqual(rows.map(row => [row.accrual_from_days, row.accrual_through_days, Number(row.accrual_daily_rate), Number(row.amount)]),
        [[0, 10, 5000, 50000], [10, 12, 7000, 14000]]);
      t.diagnostic('Current sweep policy: 10×5000 + 2×7000 = 64000; historical rate is not applied to new days.');
    });
    await t.test('payment-first refresh must produce the same periods and cannot permanently cover new days at the old rate', async () => {
      const f = await fixture();
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
      await recordFinePayment({ params: { id: f.historical.id }, body: { amount: 50000, payment_method: 'CASH' }, user: actor,
        headers: { 'idempotency-key': `RF-${randomUUID()}` } }, res);
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      const immediatelyAfterPayment = await periods(f.item.id);
      await sweepOnly(f.item.id);
      const afterSweep = await periods(f.item.id);
      const total = rows => rows.reduce((sum, row) => sum + Number(row.amount), 0);
      t.diagnostic(JSON.stringify({ expected_total: 64000, after_payment: total(immediatelyAfterPayment), after_sweep: total(afterSweep),
        stored_periods: afterSweep.map(row => ({ from: row.accrual_from_days, through: row.accrual_through_days, rate: Number(row.accrual_daily_rate), amount: Number(row.amount) })) }));
      assert.equal(total(afterSweep), 64000, 'a later sweep must not consider underpriced payment-refreshed days already covered');
      assert.deepEqual(afterSweep.map(row => [row.accrual_from_days, row.accrual_through_days, Number(row.accrual_daily_rate), Number(row.amount)]),
        [[0, 10, 5000, 50000], [10, 12, 7000, 14000]]);
    });
  } finally { await prisma.$disconnect(); }
});
