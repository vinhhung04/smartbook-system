const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.BORROW_POLICY_DATABASE_URL;
const opts = { skip: !url && 'Independent audit PostgreSQL required' };
let db;
test.before(() => {
  if (!url) return;
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/borrow_audit');
  db = new (require('@prisma/client').PrismaClient)({ datasources: { db: { url } } });
});
test.after(async () => db?.$disconnect());
test('PRA07: read-only detector finds legacy terminal holds, missing loans, orphan remote holds and incomplete returns', opts, async () => {
  const { auditBorrowInventoryState } = require('../src/services/borrow-state-reconciliation.service');
  const customer = await db.customers.create({ data: { customer_code: `DETECT-${randomUUID().slice(0, 10)}`, full_name: 'Isolated custody detector fixture' } });
  const cancelled = await db.loan_reservations.create({ data: { reservation_number: `DET-${randomUUID().slice(0, 20)}`, customer_id: customer.id, variant_id: randomUUID(), warehouse_id: randomUUID(), status: 'CANCELLED', expires_at: new Date() } });
  const converted = await db.loan_reservations.create({ data: { ...Object.fromEntries(['customer_id', 'variant_id', 'warehouse_id', 'expires_at'].map(k => [k, cancelled[k]])), reservation_number: `DET-${randomUUID().slice(0, 20)}`, status: 'CONVERTED_TO_LOAN' } });
  const missingLoan = randomUUID(), orphan = randomUUID();
  const loan = await db.loan_transactions.create({ data: { loan_number: `DET-${randomUUID().slice(0, 20)}`, customer_id: customer.id, warehouse_id: cancelled.warehouse_id, handled_by_user_id: randomUUID(), due_date: new Date(), total_items: 1 } });
  const item = await db.loan_items.create({ data: { loan_id: loan.id, variant_id: cancelled.variant_id, due_date: new Date() } });
  const evidence = new Map([
    [cancelled.id, { reservation: { status: 'ACTIVE', quantity: 1 }, consume_movements: [], return_movements: [], truncated: false }],
    [converted.id, { reservation: { status: 'CONSUMED', quantity: 1 }, consume_movements: [{ reference_id: missingLoan, quantity: 1 }], return_movements: [], truncated: false }],
    [orphan, { reservation: { status: 'ACTIVE', quantity: 1 }, consume_movements: [], return_movements: [{ reference_id: loan.id, loan_item_id: item.id }], truncated: false }],
  ]);
  const scoped = { loan_reservations: {
    findMany: args => db.loan_reservations.findMany({ ...args, where: { AND: [args.where || {}, { customer_id: customer.id }] } }),
    findUnique: args => db.loan_reservations.findUnique(args),
  }, loan_transactions: db.loan_transactions, loan_items: db.loan_items, integration_outbox: { findMany: async () => [] } };
  const result = await auditBorrowInventoryState(scoped, {
    limit: 10,
    getInventoryState: async ({ reservationId }) => evidence.get(reservationId),
    getInventoryCandidates: async () => ({ data: [{ id: randomUUID(), source_reference_id: orphan, status: 'ACTIVE' }], next_cursor: null }),
  });
  const codes = result.issues.map(x => x.code);
  for (const code of ['ACTIVE_HOLD_AFTER_LOCAL_TERMINAL', 'LOCAL_CONVERTED_WITHOUT_LOAN', 'REMOTE_CONSUMED_WITHOUT_LOCAL_LOAN', 'REMOTE_HOLD_WITHOUT_LOCAL_RESERVATION', 'REMOTE_RETURN_WITHOUT_LOCAL_COMPLETION']) assert.ok(codes.includes(code), code);
  assert.equal((await db.loan_reservations.findUnique({ where: { id: cancelled.id } })).status, 'CANCELLED');
  assert.equal(await db.loan_transactions.count({ where: { id: missingLoan } }), 0);
  assert.equal(result.errors.length, 0);
  assert.equal((await db.loan_items.findUnique({ where: { id: item.id } })).status, 'BORROWED');
});
test('PRA07: detector pages stable UUID cursors and reports unavailable evidence instead of inventing consistency', opts, async () => {
  const { auditBorrowInventoryState } = require('../src/services/borrow-state-reconciliation.service');
  const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  const local = ids.map(id => ({ id, status: 'CANCELLED' }));
  const fake = { loan_reservations: { findMany: async args => local.filter(r => !args.where.id || r.id > args.where.id.gt).slice(0, args.take), findUnique: async () => null }, integration_outbox: { findMany: async () => [] } };
  const page1 = await auditBorrowInventoryState(fake, { limit: 1, getInventoryState: async () => { throw new Error('synthetic unavailable'); }, getInventoryCandidates: async () => ({ data: [], next_cursor: null }) });
  assert.equal(page1.errors.length, 1);
  assert.equal(page1.next_cursor.reservations, ids[0]);
  assert.equal(page1.complete, false);
  const page2 = await auditBorrowInventoryState(fake, { limit: 1, cursor: page1.next_cursor, getInventoryState: async () => { throw new Error('synthetic unavailable'); }, getInventoryCandidates: async () => { throw new Error('Completed stream must not restart'); } });
  assert.equal(page2.errors[0].reservation_id, ids[1]);
  assert.equal(page2.next_cursor.reservations, ids[1]);
});
