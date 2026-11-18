const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.BORROW_POLICY_DATABASE_URL;
let prisma, loans, sweep, resolveActiveMembership;
const opts = { skip: !url && 'BORROW_POLICY_DATABASE_URL not set' };
test.before(() => {
  if (!url) return;
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/borrow_audit');
  process.env.DATABASE_URL = url; const { PrismaClient } = require('@prisma/client'); prisma = new PrismaClient();
  const mock = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
  mock('../src/lib/prisma', { prisma }); mock('../src/lib/socket-emitter', { pushEvents: async () => {} });
  // Copies go back to a named shelf of the loan's branch (khoa: returned_to_location_id).
  mock('../src/services/inventory-integration.service', { returnBorrowedStock: async () => ({}),
    getReturnLocations: async ({ locationIds }) => [...new Set(locationIds)].map(id => ({ id, warehouse_id: shelves.get(id), is_active: true })) });
  loans = require('../src/controllers/loan.controller'); ({ runOverdueSweep: sweep } = require('../src/services/fine.service'));
  ({ resolveActiveMembership } = require('../src/services/membership.service'));
});
test.after(async () => prisma?.$disconnect());
const actor = { id: randomUUID(), is_superuser: true };
const shelves = new Map();
async function invoke(handler, loan, item) {
  const response = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { id: loan.id }, method: 'POST', query: {}, body: { loan_item_id: item.id, returned_to_location_id: loan.shelf }, user: actor, headers: { 'idempotency-key': randomUUID() } }, response);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body)); return response;
}
async function fixture() {
  const customer = await prisma.customers.create({ data: { customer_code: `EXP-${randomUUID().slice(0, 12)}`, full_name: 'Isolated expired policy fixture' } });
  const plan = await prisma.membership_plans.create({ data: { code: `EXP-${randomUUID().slice(0, 12)}`, name: 'Expired ACTIVE rate', fine_per_day: 5000 } });
  await prisma.customer_memberships.create({ data: { customer_id: customer.id, plan_id: plan.id, card_number: randomUUID(),
    start_date: new Date(Date.now() - 10 * 86400000), end_date: new Date(Date.now() - 86400000), status: 'ACTIVE' } });
  const future = await prisma.membership_plans.create({ data: { code: `FUT-${randomUUID().slice(0, 12)}`, name: 'Future policy not effective', fine_per_day: 100000 } });
  await prisma.customer_memberships.create({ data: { customer_id: customer.id, plan_id: future.id, card_number: randomUUID(), start_date: new Date(Date.now() + 86400000), status: 'ACTIVE' } });
  const loan = await prisma.loan_transactions.create({ data: { loan_number: `EXP-${randomUUID()}`, customer_id: customer.id, warehouse_id: randomUUID(), handled_by_user_id: actor.id,
    due_date: new Date(Date.now() - 3 * 86400000), total_items: 1 } });
  const item = await prisma.loan_items.create({ data: { loan_id: loan.id, variant_id: randomUUID(), due_date: loan.due_date } });
  loan.shelf = randomUUID(); shelves.set(loan.shelf, loan.warehouse_id);
  return { customer, loan, item };
}
async function sweepOnly(item) {
  return sweep({ loan_items: { findMany: args => prisma.loan_items.findMany({ ...args, where: { AND: [args.where, { id: item.id }] } }) },
    customer_memberships: prisma.customer_memberships, $transaction: prisma.$transaction.bind(prisma) });
}
async function total(itemId) {
  const rows = await prisma.fines.findMany({ where: { loan_item_id: itemId, fine_type: 'OVERDUE' } });
  return rows.reduce((sum, row) => sum + Number(row.amount), 0);
}
test('expired ACTIVE fine policy is independent of sweep-before-return ordering and never enables checkout', opts, async t => {
  const before = await fixture(), after = await fixture();
  assert.equal(await resolveActiveMembership(prisma, before.customer.id), null);
  assert.equal(await resolveActiveMembership(prisma, after.customer.id), null);
  await sweepOnly(before.item);
  await invoke(loans.returnLoan, before.loan, before.item);
  const preview = await invoke(loans.previewLoanReturn, after.loan, after.item);
  await invoke(loans.returnLoan, after.loan, after.item);
  await sweepOnly(after.item);
  const control = await total(before.item.id), actual = await total(after.item.id);
  t.diagnostic(JSON.stringify({ sweep_first: control, return_first: actual, return_preview: preview.body.data.totals.penalty }));
  assert.equal(control, 15000, 'approved SB02 sweep behavior stays unchanged and excludes future membership');
  assert.equal(actual, control, 'return must not permanently lose the same accrued obligation merely because sweep ran later');
  assert.equal(preview.body.data.totals.penalty, control);
  assert.equal(await resolveActiveMembership(prisma, after.customer.id), null, 'fine-policy reuse does not make the expired card eligible for checkout');
});
