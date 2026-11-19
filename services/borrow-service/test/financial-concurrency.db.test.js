const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.BORROW_POLICY_DATABASE_URL || process.env.BORROW_TEST_DATABASE_URL;
const options = { skip: !url && 'A verified independent audit database is required' };
let prisma, controller;
const actor = { id: randomUUID(), is_superuser: true, permissions: ['borrow.fines.manage'] };

test.before(() => {
  if (!url) return;
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.pathname, '/borrow_audit');
  assert.ok(['25432', '5432'].includes(target.port));
  process.env.DATABASE_URL = url;
  const { PrismaClient } = process.env.BORROW_AUDIT_PRISMA_CLIENT ? require(process.env.BORROW_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  prisma = new PrismaClient({ datasources: { db: { url } } });
  const p = require.resolve('../src/lib/prisma');
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { prisma } };
  const emitter = require.resolve('../src/lib/socket-emitter');
  require.cache[emitter] = { id: emitter, filename: emitter, loaded: true, exports: { pushEvents: async () => {} } };
  controller = require('../src/controllers/fine.controller');
});
test.after(async () => prisma?.$disconnect());

async function fixture(amounts = [50000, 50000]) {
  const customer = await prisma.customers.create({ data: { customer_code: `RACE-${randomUUID().slice(0, 12)}`, full_name: 'Independent financial race', total_fine_balance: amounts.reduce((s, n) => s + n, 0) } });
  const fines = [];
  for (const amount of amounts) fines.push(await prisma.fines.create({ data: { customer_id: customer.id, fine_type: 'DAMAGE', amount } }));
  return { customer, fines };
}
async function invoke(handler, fine, body) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ params: { id: fine.id }, body, headers: { 'idempotency-key': randomUUID() }, user: actor }, response);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  return response;
}
async function assertDebt(customerId, expected) {
  const customer = await prisma.customers.findUnique({ where: { id: customerId } });
  assert.equal(Number(customer.total_fine_balance), expected);
  const fines = await prisma.fines.findMany({ where: { customer_id: customerId }, include: { fine_payments: true } });
  const debt = fines.reduce((sum, f) => sum + (['PAID', 'WAIVED'].includes(f.status) ? 0 : Math.max(0, Number(f.amount) - Number(f.waived_amount) - f.fine_payments.reduce((paid, p) => paid + Number(p.amount), 0))), 0);
  assert.equal(debt, expected);
}

test('PRA06: two different fines waived simultaneously leave the customer debt zero', options, async () => {
  const { customer, fines } = await fixture();
  await Promise.all(fines.map(f => invoke(controller.waiveFine, f, { note: 'Approved independent waiver' })));
  assert.equal(await prisma.fines.count({ where: { customer_id: customer.id, status: 'WAIVED' } }), 2);
  await assertDebt(customer.id, 0);
});

test('PRA06: payment and waiver of different fines share one customer aggregate', options, async () => {
  const { customer, fines } = await fixture();
  await Promise.all([
    invoke(controller.recordFinePayment, fines[0], { amount: 50000 }),
    invoke(controller.waiveFine, fines[1], { note: 'Approved independent waiver' }),
  ]);
  assert.equal(await prisma.fine_payments.count({ where: { fine_id: fines[0].id } }), 1);
  await assertDebt(customer.id, 0);
});

test('PRA06: concurrent partial payment and waiver on one fine conserve the full obligation', options, async () => {
  const { customer, fines: [fine] } = await fixture([50000]);
  await Promise.all([
    invoke(controller.recordFinePayment, fine, { amount: 25000 }),
    invoke(controller.waiveFine, fine, { amount: 25000, note: 'Approved partial waiver' }),
  ]);
  const stored = await prisma.fines.findUnique({ where: { id: fine.id }, include: { fine_payments: true } });
  assert.equal(Number(stored.waived_amount), 25000);
  assert.equal(stored.fine_payments.reduce((s, p) => s + Number(p.amount), 0), 25000);
  await assertDebt(customer.id, 0);
});

test('PRA06: six concurrent payments on distinct fines cannot restore an obsolete cached debt', options, async () => {
  const { customer, fines } = await fixture(Array(6).fill(10000));
  await Promise.all(fines.map(f => invoke(controller.recordFinePayment, f, { amount: 10000 })));
  assert.equal(await prisma.fine_payments.count({ where: { fine_id: { in: fines.map(f => f.id) } } }), 6);
  await assertDebt(customer.id, 0);
});

test('PRA06: overdue accrual racing payment bills uncovered days once and recomputes actual debt', options, async () => {
  const { customer } = await fixture([]);
  const due = new Date(Date.now() - 10 * 86400000);
  const loan = await prisma.loan_transactions.create({ data: { loan_number: `RACE-${randomUUID().replaceAll('-', '')}`, customer_id: customer.id, warehouse_id: randomUUID(), handled_by_user_id: actor.id, due_date: due, total_items: 1 } });
  const item = await prisma.loan_items.create({ data: { loan_id: loan.id, variant_id: randomUUID(), due_date: due } });
  const { upsertFine, recomputeCustomerFineBalance } = require('../src/services/fine.service');
  const accrue = days => prisma.$transaction(async tx => {
    const result = await upsertFine(tx, { customerId: customer.id, loanItemId: item.id, fineType: 'OVERDUE', amount: days * 5000, overdueDays: days, dailyRate: 5000 });
    await recomputeCustomerFineBalance(tx, customer.id);
    return result;
  }, { timeout: 10000 });
  const fine = await accrue(8); // Two new days have elapsed since the last sweep.
  await Promise.all([accrue(10), invoke(controller.recordFinePayment, fine, { amount: 40000 })]);
  const rows = await prisma.fines.findMany({ where: { loan_item_id: item.id }, include: { fine_payments: true } });
  assert.equal(rows.reduce((s, f) => s + Number(f.amount), 0), 50000);
  assert.equal(rows.flatMap(f => f.fine_payments).reduce((s, p) => s + Number(p.amount), 0), 40000);
  await assertDebt(customer.id, 10000);
});
