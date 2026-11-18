const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const url = process.env.BORROW_POLICY_DATABASE_URL;
let prisma, fineController;
const { upsertFine, daysOverdue } = require('../src/services/fine.service');
const { previewReturnSettlement } = require('../src/services/deposit.service');
test.before(() => {
  if (!url) return;
  process.env.DATABASE_URL = url;
  const { PrismaClient } = process.env.BORROW_AUDIT_PRISMA_CLIENT ? require(process.env.BORROW_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  prisma = new PrismaClient();
  const path = require.resolve('../src/lib/prisma');
  require.cache[path] = { id: path, filename: path, loaded: true, exports: { prisma } };
  fineController = require('../src/controllers/fine.controller');
});
test.after(async () => { await prisma?.$disconnect(); });
const opts = { skip: !url && 'BORROW_POLICY_DATABASE_URL not set' };
const actor = { id: randomUUID(), is_superuser: true, permissions: ['borrow.fines.manage'] };
async function invoke(handler, fineId, body, user = actor) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { id: fineId }, body, user, headers: { 'idempotency-key': randomUUID() } }, response);
  return response;
}
async function fixture() {
  const id = randomUUID();
  const customer = await prisma.customers.create({ data: { customer_code: `POL-${id.slice(0, 12)}`, full_name: 'Fine policy reader' } });
  const due = new Date(Date.now() - 10 * 86400000);
  const loan = await prisma.loan_transactions.create({ data: { loan_number: `POL-${id}`, customer_id: customer.id, warehouse_id: randomUUID(), handled_by_user_id: actor.id, due_date: due, total_items: 1 } });
  const item = await prisma.loan_items.create({ data: { loan_id: loan.id, variant_id: randomUUID(), due_date: due } });
  return { customer, item };
}
const accrue = (f, days) => prisma.$transaction(tx => upsertFine(tx, {
  customerId: f.customer.id, loanItemId: f.item.id, fineType: 'OVERDUE', amount: days * 5000,
  overdueDays: days, dailyRate: 5000,
}));
test('SB03 PG: paid period stays immutable; subsequent days form one idempotent incremental period', opts, async () => {
  const f = await fixture();
  const first = await accrue(f, 10);
  assert.equal((await invoke(fineController.recordFinePayment, first.id, { amount: 50000, payment_method: 'CASH' })).statusCode, 200);
  const second = await accrue(f, 20);
  assert.equal(Number(second.amount), 50000);
  assert.notEqual(second.id, first.id);
  await Promise.all([accrue(f, 20), accrue(f, 20)]);
  assert.equal(await prisma.fines.count({ where: { loan_item_id: f.item.id } }), 2);
  const paid = await prisma.fines.findUnique({ where: { id: first.id } });
  assert.equal(paid.status, 'PAID'); assert.equal(Number(paid.amount), 50000);
  assert.equal(second.accrual_from_days, 10); assert.equal(second.accrual_through_days, 20);
});
test('SB03 PG: ordinary waiver permits later accrual; authorized full-episode waiver stops it', opts, async () => {
  const f = await fixture();
  const first = await accrue(f, 10);
  assert.equal((await invoke(fineController.waiveFine, first.id, { note: 'Waive accrued amount' })).statusCode, 200);
  const second = await accrue(f, 12);
  assert.equal(Number(second.amount), 10000);
  const response = await invoke(fineController.waiveFine, second.id, { note: 'Approved exceptional full episode', waive_future: true });
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(await accrue(f, 20), null);
  assert.equal((await prisma.overdue_fine_episodes.findUnique({ where: { loan_item_id: f.item.id } })).waived_future, true);
});
test('SB03 PG: full-episode waiver requires explicit fine permission and reason without side effects', opts, async () => {
  const f = await fixture(); const fine = await accrue(f, 10);
  assert.equal((await invoke(fineController.waiveFine, fine.id, { waive_future: true })).statusCode, 400);
  assert.equal((await invoke(fineController.waiveFine, fine.id, { waive_future: true, note: 'No authority' }, { id: actor.id, permissions: ['borrow.write'] })).statusCode, 403);
  assert.equal((await prisma.fines.findUnique({ where: { id: fine.id } })).status, 'UNPAID');
});
test('SB03 PG: payment racing accrual cannot lose a payment or bill a covered day twice', opts, async () => {
  const f = await fixture(); const fine = await accrue(f, 10);
  const [paid] = await Promise.all([invoke(fineController.recordFinePayment, fine.id, { amount: 50000 }), accrue(f, 10)]);
  assert.equal(paid.statusCode, 200);
  assert.equal(await prisma.fine_payments.count({ where: { fine_id: fine.id } }), 1);
  assert.equal(await prisma.fines.count({ where: { loan_item_id: f.item.id } }), 1);
  assert.equal((await prisma.fines.findUnique({ where: { id: fine.id } })).status, 'PAID');
});
test('SB03 PG: amount-only legacy history is adopted prospectively, never backbilled', opts, async () => {
  const f = await fixture();
  const legacy = await prisma.fines.create({ data: { customer_id: f.customer.id, loan_item_id: f.item.id, fine_type: 'OVERDUE', amount: 5000, status: 'PAID' } });
  const preview = await previewReturnSettlement(prisma, { items: [f.item], membershipLimits: { fine_per_day: 5000 } });
  assert.equal(preview.totals.penalty, 0, 'preview cannot backbill a legacy settled episode either');
  assert.equal(await accrue(f, 30), null);
  const next = await accrue(f, 31);
  assert.equal(Number(next.amount), 5000);
  assert.equal(Number((await prisma.fines.findUnique({ where: { id: legacy.id } })).amount), 5000);
});
test('SB03 PG: return preview sums open periods and excludes settled periods', opts, async () => {
  const f = await fixture(); const first = await accrue(f, 10);
  await invoke(fineController.recordFinePayment, first.id, { amount: 50000 });
  const future = new Date(Date.now() + 2 * 86400000);
  const preview = await previewReturnSettlement(prisma, { items: [f.item], returnedAt: future, membershipLimits: { fine_per_day: 5000 } });
  assert.equal(preview.totals.penalty, (daysOverdue(f.item.due_date, future) - 10) * 5000);
  assert.equal(preview.items[0].fines.length, 1);
});
test('SB03 PG: renewed due date does not reuse the old overdue-day coverage', opts, async () => {
  const f = await fixture(); const first = await accrue(f, 10);
  await invoke(fineController.recordFinePayment, first.id, { amount: 50000 });
  await prisma.loan_items.update({ where: { id: f.item.id }, data: { due_date: new Date(Date.now() - 2 * 86400000) } });
  const next = await accrue(f, 2);
  assert.equal(Number(next.amount), 10000); assert.equal(next.accrual_from_days, 0);
  assert.notEqual(new Date(next.accrual_due_date).getTime(), new Date(first.accrual_due_date).getTime());
});
test('SB03 PG: additive migrations preserve legacy financial history and establish a prospective cutoff', opts, async () => {
  const schema = `fine_policy_${randomUUID().replaceAll('-', '')}`;
  const rollback = new Error('ROLLBACK_MIGRATION_FIXTURE');
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${schema}, public`);
      await tx.$executeRawUnsafe('CREATE TABLE loan_items (id uuid PRIMARY KEY, due_date timestamptz NOT NULL)');
      await tx.$executeRawUnsafe('CREATE TABLE fines (id uuid PRIMARY KEY, loan_item_id uuid, fine_type text, amount numeric(10,2), status text, paid_at timestamptz)');
      const item = randomUUID(); const fine = randomUUID(); const due = new Date(Date.now() - 10 * 86400000);
      await tx.$executeRaw`INSERT INTO loan_items (id,due_date) VALUES (${item}::uuid,${due})`;
      await tx.$executeRaw`INSERT INTO fines VALUES (${fine}::uuid,${item}::uuid,'OVERDUE',5000,'PAID','2026-10-01T00:00:00Z')`;
      for (const name of ['20261117140000_overdue_fine_periods', '20261117141000_overdue_fine_due_dates']) {
        const sql = readFileSync(path.resolve(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8');
        for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      }
      const [stored] = await tx.$queryRawUnsafe('SELECT * FROM fines');
      const [episode] = await tx.$queryRawUnsafe('SELECT * FROM overdue_fine_episodes');
      assert.equal(Number(stored.amount), 5000); assert.equal(stored.status, 'PAID');
      assert.equal(new Date(stored.paid_at).toISOString(), '2026-10-01T00:00:00.000Z');
      assert.equal(episode.baseline_days, 10); assert.equal(episode.waived_future, false);
      assert.equal(stored.accrual_through_days, 10);
      assert.equal(new Date(stored.accrual_due_date).getTime(), due.getTime());
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
});
