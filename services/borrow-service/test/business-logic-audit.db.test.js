// Run only against an isolated migrated borrow database; inventory is the external boundary.
const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const url = process.env.BORROW_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const inventory = { consumed: [], released: [], returns: [], reallocated: [], locations: new Map(), onConsume: null, onRelease: null };
const inventoryPath = require.resolve('../src/services/inventory-integration.service');
require.cache[inventoryPath] = { id: inventoryPath, filename: inventoryPath, loaded: true, exports: {
  checkAvailability: async () => {},
  reserveStock: async () => {},
  consumeReservation: async args => { inventory.consumed.push(args); if (inventory.onConsume) await inventory.onConsume(); },
  releaseReservation: async args => { inventory.released.push(args); if (inventory.onRelease) await inventory.onRelease(); },
  returnBorrowedStock: async args => { inventory.returns.push(args); },
  reallocateReservationStock: async args => { inventory.reallocated.push(args); },
  getReturnLocations: async ({ locationIds }) => locationIds.map(id => ({ id, warehouse_id: inventory.locations.get(id), is_active: true })),
} };
// A shelf of the loan's branch to put a returned copy back on.
function shelf(loan) {
  const id = crypto.randomUUID();
  inventory.locations.set(id, loan.warehouse_id);
  return id;
}
// The shelf a CONFIRMED reservation's single copy was picked from.
const picked = () => ({ picks: [{ location_id: crypto.randomUUID(), quantity: 1 }] });
let prisma, loans, reservations, sweep;
before(() => {
  if (!url) return;
  if (process.env.BORROW_AUDIT_PRISMA_CLIENT) {
    const { PrismaClient } = require(process.env.BORROW_AUDIT_PRISMA_CLIENT);
    prisma = new PrismaClient();
    const prismaPath = require.resolve('../src/lib/prisma');
    require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma } };
  } else ({ prisma } = require('../src/lib/prisma'));
  loans = require('../src/controllers/loan.controller');
  reservations = require('../src/controllers/reservation.controller');
  ({ runOverdueSweep: sweep } = require('../src/services/fine.service'));
});
after(async () => { await prisma?.$disconnect(); });
const options = { skip: url ? false : 'BORROW_TEST_DATABASE_URL is not set' };
function invoke(handler, id, body = {}, key = crypto.randomUUID()) {
  const req = { params: { id }, body, headers: { 'idempotency-key': key }, user: { id: crypto.randomUUID(), is_superuser: true } };
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { resolve({ status: this.statusCode, body }); return this; } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
async function fixture(count = 2) {
  const customer = await prisma.customers.create({ data: { customer_code: `AUD-${crypto.randomUUID().slice(0, 12)}`, full_name: 'Business audit fixture' } });
  const plan = await prisma.membership_plans.create({ data: { code: `AUD-${crypto.randomUUID().slice(0, 12)}`, name: 'Audit', fine_per_day: 5000 } });
  await prisma.customer_memberships.create({ data: { customer_id: customer.id, plan_id: plan.id, card_number: crypto.randomUUID() } });
  const loan = await prisma.loan_transactions.create({ data: { loan_number: `AUD-${crypto.randomUUID()}`, customer_id: customer.id, handled_by_user_id: crypto.randomUUID(), warehouse_id: crypto.randomUUID(), due_date: new Date(Date.now() - 3 * 86400000), total_items: count } });
  await prisma.loan_items.createMany({ data: Array.from({ length: count }, () => ({ id: crypto.randomUUID(), loan_id: loan.id, variant_id: crypto.randomUUID(), due_date: loan.due_date })) });
  return { customer, plan, loan, items: await prisma.loan_items.findMany({ where: { loan_id: loan.id } }) };
}
test('SB21: returning the final active item preserves earlier LOST items in the loan aggregate', options, async () => {
  const { loan, items } = await fixture();
  const lost = await invoke(loans.returnLoan, loan.id, { loan_item_id: items[0].id, mark_lost: true });
  assert.equal(lost.status, 200);
  const returned = await invoke(loans.returnLoan, loan.id, { loan_item_id: items[1].id, returned_to_location_id: shelf(loan) });
  assert.equal(returned.status, 200);
  const stored = await prisma.loan_transactions.findUnique({ where: { id: loan.id }, include: { loan_items: true } });
  assert.equal(stored.status, 'LOST');
  assert.deepEqual(stored.loan_items.map(x => x.status).sort(), ['LOST', 'RETURNED']);
  assert.ok(stored.closed_at);
});
test('SB19: sweep and a return overlap after the scan; returned item is neither reopened nor fined', options, async () => {
  const { loan, items } = await fixture(1);
  let scannedResolve, resumeResolve;
  const scanned = new Promise(r => { scannedResolve = r; });
  const resume = new Promise(r => { resumeResolve = r; });
  const client = Object.create(prisma);
  Object.defineProperty(client, 'loan_items', { value: { findMany: async args => {
    const result = await prisma.loan_items.findMany({ ...args, where: { ...args.where, id: items[0].id } });
    scannedResolve(); await resume; return result;
  } } });
  const sweeping = sweep(client, { now: new Date(), limit: 10 });
  const returning = (async () => {
    await scanned;
    const response = await invoke(loans.returnLoan, loan.id, { loan_item_id: items[0].id, returned_to_location_id: shelf(loan) });
    assert.equal(response.status, 200);
    // Advance the job clock after return so stale accrual would visibly overcharge.
    resumeResolve();
  })();
  const [result] = await Promise.all([sweeping, returning]);
  assert.equal(result.processed_items, 0);
  assert.equal((await prisma.loan_items.findUnique({ where: { id: items[0].id } })).status, 'RETURNED');
  assert.equal((await prisma.loan_transactions.findUnique({ where: { id: loan.id } })).status, 'RETURNED');
  assert.equal(await prisma.borrow_audit_logs.count({ where: { entity_id: items[0].id, action_name: 'MARK_ITEM_OVERDUE' } }), 0);
});
test('SB23: concurrent conversion and cancellation have exactly one successful terminal transition', options, async () => {
  const { customer, plan, loan } = await fixture(0);
  await prisma.membership_plans.update({ where: { id: plan.id }, data: { deposit_per_item: 30000 } });
  const { creditAccount } = require('../src/services/account.service');
  await prisma.$transaction(tx => creditAccount(tx, { customerId: customer.id, amount: 100000, idempotencyKey: `audit-seed:${customer.id}`, referenceType: 'TEST_SEED' }));
  const reservation = await prisma.loan_reservations.create({ data: { reservation_number: `AUD-${crypto.randomUUID()}`, customer_id: customer.id, variant_id: crypto.randomUUID(), warehouse_id: loan.warehouse_id, quantity: 1, status: 'CONFIRMED', expires_at: new Date(Date.now() + 86400000) } });
  inventory.consumed.length = 0; inventory.released.length = 0;
  let startedResolve;
  const started = new Promise(r => { startedResolve = r; });
  inventory.onConsume = async () => { startedResolve(); await new Promise(r => setTimeout(r, 150)); };
  try {
    const conversion = invoke(loans.convertReservationToLoan, reservation.id, picked());
    const cancellation = (async () => { await started; return invoke(reservations.cancelReservation, reservation.id); })();
    const responses = await Promise.all([conversion, cancellation]);
    assert.deepEqual(responses.map(x => x.status).sort(), [201, 409]);
    const stored = await prisma.loan_reservations.findUnique({ where: { id: reservation.id } });
    assert.equal(stored.status, 'CONVERTED_TO_LOAN');
    assert.equal(await prisma.loan_transactions.count({ where: { source_reservation_id: reservation.id } }), 1);
    assert.equal(inventory.consumed.length, 1);
    assert.equal(inventory.released.length, 0);
    const account = await prisma.customer_accounts.findUnique({ where: { customer_id: customer.id } });
    assert.equal(Number(account.available_balance), 70000);
    assert.equal(Number(account.held_balance), 30000);
    assert.equal(await prisma.loan_item_deposits.count({ where: { customer_id: customer.id, status: 'HELD' } }), 1);
    assert.equal(await prisma.borrow_audit_logs.count({ where: { entity_id: reservation.id, action_name: 'CANCEL_RESERVATION' } }), 0);
  } finally { inventory.onConsume = null; }
});

async function reservationFixture() {
  const { customer, loan } = await fixture(0);
  return prisma.loan_reservations.create({ data: { reservation_number: `AUD-${crypto.randomUUID()}`, customer_id: customer.id, variant_id: crypto.randomUUID(), warehouse_id: loan.warehouse_id, quantity: 1, status: 'CONFIRMED', expires_at: new Date(Date.now() + 86400000) } });
}
test('SB23: cancellation winning before conversion prevents any consume or loan', options, async () => {
  const reservation = await reservationFixture();
  inventory.consumed.length = 0; inventory.released.length = 0;
  let releasingResolve;
  const releasing = new Promise(r => { releasingResolve = r; });
  inventory.onRelease = async () => { releasingResolve(); await new Promise(r => setTimeout(r, 100)); };
  try {
    const cancellation = invoke(reservations.cancelReservation, reservation.id);
    const conversion = (async () => { await releasing; return invoke(loans.convertReservationToLoan, reservation.id, picked()); })();
    const responses = await Promise.all([cancellation, conversion]);
    assert.deepEqual(responses.map(x => x.status), [200, 409]);
    assert.equal((await prisma.loan_reservations.findUnique({ where: { id: reservation.id } })).status, 'CANCELLED');
    assert.equal(await prisma.loan_transactions.count({ where: { source_reservation_id: reservation.id } }), 0);
    assert.equal(inventory.consumed.length, 0);
    assert.equal(inventory.released.length, 1);
  } finally { inventory.onRelease = null; }
});
test('SB06/SB23: concurrent conversion retries replay one committed loan and consume once', options, async () => {
  const reservation = await reservationFixture();
  inventory.consumed.length = 0;
  inventory.onConsume = async () => new Promise(r => setTimeout(r, 100));
  const key = crypto.randomUUID();
  try {
    const results = await Promise.all([invoke(loans.convertReservationToLoan, reservation.id, picked(), key), invoke(loans.convertReservationToLoan, reservation.id, picked(), key)]);
    assert.equal(await prisma.loan_transactions.count({ where: { source_reservation_id: reservation.id } }), 1);
    assert.deepEqual(results.map(x => x.status).sort(), [200, 201]);
    assert.equal(results[0].body.data.id, results[1].body.data.id);
    assert.equal(inventory.consumed.length, 1);
    assert.equal(await prisma.borrow_audit_logs.count({ where: { entity_id: results[0].body.data.id, action_name: 'CONVERT_RESERVATION_TO_LOAN' } }), 1);
  } finally { inventory.onConsume = null; }
});
test('SB23: uncertain inventory consume response rolls back local state and queues reconciliation', options, async () => {
  const reservation = await reservationFixture();
  inventory.onConsume = async () => { throw Object.assign(new Error('Response lost after remote movement'), { status: 409 }); };
  try {
    const result = await invoke(loans.convertReservationToLoan, reservation.id, picked());
    assert.equal(result.status, 502);
    assert.equal((await prisma.loan_reservations.findUnique({ where: { id: reservation.id } })).status, 'CONFIRMED');
    assert.equal(await prisma.loan_transactions.count({ where: { source_reservation_id: reservation.id } }), 0);
    const records = await prisma.integration_outbox.findMany({ where: { event_type: 'RESERVATION_CONSUME_UNRESOLVED', payload: { path: ['reservation_id'], equals: reservation.id } } });
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'PENDING');
  } finally { inventory.onConsume = null; }
});

test('SB21: concurrent returns of distinct items close from the committed state of all items', options, async () => {
  const { loan, items } = await fixture(2);
  const transaction = prisma.$transaction.bind(prisma);
  let arrivals = 0, release;
  const bothCounting = new Promise(r => { release = r; });
  prisma.$transaction = callback => transaction(tx => callback(new Proxy(tx, { get(target, key) {
    if (key !== 'loan_items') return target[key];
    return new Proxy(target.loan_items, { get(model, method) {
      if (method !== 'count') return model[method];
      return async args => {
        if (args.where.loan_id === loan.id && args.where.status?.in) {
          arrivals += 1;
          if (arrivals === 2) release();
          await Promise.race([bothCounting, new Promise(r => setTimeout(r, 200))]);
        }
        return model.count(args);
      };
    } });
  } })));
  try {
    const responses = await Promise.all([
      invoke(loans.returnLoan, loan.id, { loan_item_id: items[0].id, mark_lost: true }),
      invoke(loans.returnLoan, loan.id, { loan_item_id: items[1].id, returned_to_location_id: shelf(loan) }),
    ]);
    assert.deepEqual(responses.map(x => x.status), [200, 200]);
    const stored = await prisma.loan_transactions.findUnique({ where: { id: loan.id }, include: { loan_items: true } });
    assert.deepEqual(stored.loan_items.map(x => x.status).sort(), ['LOST', 'RETURNED']);
    assert.equal(stored.status, 'LOST');
    assert.ok(stored.closed_at);
  } finally { prisma.$transaction = transaction; }
});

test('SB20: existing per-item requests preserve separate GOOD, DAMAGED and LOST outcomes', options, async () => {
  const { loan, items } = await fixture(3);
  const cases = [
    { loan_item_id: items[0].id, item_condition_on_return: 'GOOD', notes: 'good copy', returned_to_location_id: shelf(loan) },
    { loan_item_id: items[1].id, item_condition_on_return: 'DAMAGED', notes: 'damaged cover', returned_to_location_id: shelf(loan) },
    { loan_item_id: items[2].id, mark_lost: true, notes: 'lost copy' },
  ];
  for (const payload of cases) assert.equal((await invoke(loans.returnLoan, loan.id, payload)).status, 200);
  const stored = await prisma.loan_items.findMany({ where: { loan_id: loan.id } });
  const byId = new Map(stored.map(x => [x.id, x]));
  assert.equal(byId.get(items[0].id).item_condition_on_return, 'GOOD');
  assert.equal(byId.get(items[1].id).item_condition_on_return, 'DAMAGED');
  assert.equal(byId.get(items[2].id).status, 'LOST');
  for (const payload of cases) assert.equal(byId.get(payload.loan_item_id).notes, payload.notes);
  assert.equal(await prisma.fines.count({ where: { loan_item_id: items[0].id, fine_type: 'DAMAGE' } }), 0);
  assert.equal(await prisma.fines.count({ where: { loan_item_id: items[1].id, fine_type: 'DAMAGE' } }), 1);
  assert.equal(await prisma.fines.count({ where: { loan_item_id: items[2].id, fine_type: 'LOST' } }), 1);
});

test('SB23: a successful consume taking over five seconds still commits the loan', options, async () => {
  const reservation = await reservationFixture();
  inventory.onConsume = async () => new Promise(r => setTimeout(r, 5300));
  try {
    const result = await invoke(loans.convertReservationToLoan, reservation.id, picked());
    assert.equal(result.status, 201);
    assert.equal((await prisma.loan_reservations.findUnique({ where: { id: reservation.id } })).status, 'CONVERTED_TO_LOAN');
    assert.equal(await prisma.loan_transactions.count({ where: { source_reservation_id: reservation.id } }), 1);
    assert.equal(await prisma.integration_outbox.count({ where: { event_type: 'RESERVATION_CONSUME_UNRESOLVED', payload: { path: ['reservation_id'], equals: reservation.id } } }), 0);
  } finally { inventory.onConsume = null; }
});

test('SB23: competing conversions reaching the membership cap reject locally before consuming stock', options, async () => {
  const first = await reservationFixture();
  const membership = await prisma.customer_memberships.findFirst({ where: { customer_id: first.customer_id } });
  await prisma.membership_plans.update({ where: { id: membership.plan_id }, data: { max_active_loans: 1 } });
  const second = await prisma.loan_reservations.create({ data: { reservation_number: `AUD-${crypto.randomUUID()}`, customer_id: first.customer_id, warehouse_id: first.warehouse_id, variant_id: crypto.randomUUID(), quantity: 1, status: 'CONFIRMED', expires_at: new Date(Date.now() + 86400000) } });
  inventory.consumed.length = 0;
  inventory.onConsume = async () => new Promise(r => setTimeout(r, 150));
  try {
    const results = await Promise.all([invoke(loans.convertReservationToLoan, first.id, picked()), invoke(loans.convertReservationToLoan, second.id, picked())]);
    assert.deepEqual(results.map(x => x.status).sort(), [201, 409]);
    assert.equal(inventory.consumed.length, 1);
    assert.equal(await prisma.loan_transactions.count({ where: { source_reservation_id: { in: [first.id, second.id] } } }), 1);
  } finally { inventory.onConsume = null; }
});

test('SB01: direct loans count active reserved quantities as well as borrowed items', options, async () => {
  const { customer, plan, loan } = await fixture(3);
  await prisma.membership_plans.update({ where: { id: plan.id }, data: { max_active_loans: 5 } });
  await prisma.loan_reservations.create({ data: { reservation_number: `AUD-${crypto.randomUUID()}`, customer_id: customer.id, warehouse_id: loan.warehouse_id, variant_id: crypto.randomUUID(), quantity: 2, status: 'CONFIRMED', expires_at: new Date(Date.now() + 86400000) } });
  const result = await invoke(loans.createDirectLoan, null, { customer_id: customer.id, warehouse_id: loan.warehouse_id, variant_id: crypto.randomUUID(), quantity: 1, picks: [{ location_id: crypto.randomUUID(), quantity: 1 }] });
  assert.equal(result.status, 409);
  assert.equal(await prisma.loan_transactions.count({ where: { customer_id: customer.id } }), 1);
});
test('SB02: future renewal cannot supersede membership active today', options, async () => {
  const { customer, plan, items } = await fixture(1);
  const futurePlan = await prisma.membership_plans.create({ data: { code: `AUD-${crypto.randomUUID().slice(0, 12)}`, name: 'Future premium', max_active_loans: 100, fine_per_day: 100000 } });
  await prisma.customer_memberships.create({ data: { customer_id: customer.id, plan_id: futurePlan.id, card_number: crypto.randomUUID(), start_date: new Date(Date.now() + 30 * 86400000) } });
  const { resolveActiveMembership } = require('../src/services/membership.service');
  assert.equal((await resolveActiveMembership(prisma, customer.id)).plan.id, plan.id);
  const client = Object.create(prisma);
  Object.defineProperty(client, 'loan_items', { value: { findMany: args => prisma.loan_items.findMany({ ...args, where: { ...args.where, id: items[0].id } }) } });
  await sweep(client, { limit: 10 });
  const fine = await prisma.fines.findFirst({ where: { loan_item_id: items[0].id, fine_type: 'OVERDUE' } });
  assert.equal(Number(fine.amount), 15000, 'sweep uses the current plan daily rate, not future renewal');
});
test('SB04: explicitly returning an already returned item does not repeat inventory or monetary effects', options, async () => {
  const { loan, items } = await fixture(2);
  const first = await invoke(loans.returnLoan, loan.id, { loan_item_id: items[0].id, returned_to_location_id: shelf(loan) });
  assert.equal(first.status, 200);
  const calls = inventory.returns.length;
  const duplicate = await invoke(loans.returnLoan, loan.id, { loan_item_id: items[0].id, returned_to_location_id: shelf(loan) });
  assert.equal(duplicate.status, 409);
  assert.equal(inventory.returns.length, calls);
  assert.equal((await prisma.loan_items.findUnique({ where: { id: items[1].id } })).status, 'BORROWED');
});
test('SB05: a wallet race after direct inventory consume queues the consumed stock for reconciliation', options, async () => {
  const { customer, plan, loan } = await fixture(0);
  const { creditAccount, holdFunds } = require('../src/services/account.service');
  await prisma.membership_plans.update({ where: { id: plan.id }, data: { deposit_per_item: 30000 } });
  await prisma.$transaction(tx => creditAccount(tx, { customerId: customer.id, amount: 30000, idempotencyKey: crypto.randomUUID(), referenceType: 'TEST_SEED' }));
  inventory.onConsume = () => prisma.$transaction(tx => holdFunds(tx, { customerId: customer.id, amount: 30000, idempotencyKey: crypto.randomUUID(), referenceType: 'TEST_COMPETING_HOLD' }));
  try {
    const result = await invoke(loans.createDirectLoan, null, { customer_id: customer.id, warehouse_id: loan.warehouse_id, variant_id: crypto.randomUUID(), quantity: 1, picks: [{ location_id: crypto.randomUUID(), quantity: 1 }] });
    assert.equal(result.status, 409);
    assert.equal(await prisma.loan_transactions.count({ where: { customer_id: customer.id } }), 1);
    assert.equal(await prisma.integration_outbox.count({ where: { event_type: 'DIRECT_LOAN_CONSUME_UNRESOLVED', payload: { path: ['customer_id'], equals: customer.id } } }), 1);
  } finally { inventory.onConsume = null; }
});
test('SB03 evidence: settled fine remains settled when later cumulative amount increases', options, async () => {
  const { customer, items } = await fixture(1);
  const { upsertFine } = require('../src/services/fine.service');
  for (const status of ['PAID', 'WAIVED']) {
    const fine = await prisma.fines.create({ data: { customer_id: customer.id, loan_item_id: items[0].id, fine_type: status === 'PAID' ? 'OVERDUE' : 'DAMAGE', amount: 50000, status } });
    const result = await prisma.$transaction(tx => upsertFine(tx, { customerId: customer.id, loanItemId: items[0].id, fineType: fine.fine_type, amount: 100000 }));
    assert.equal(result.status, status);
    assert.equal(Number(result.amount), 50000);
  }
});

test('SB05: conversion validates the deposit before remote inventory consume', options, async () => {
  const reservation = await reservationFixture();
  const membership = await prisma.customer_memberships.findFirst({ where: { customer_id: reservation.customer_id } });
  await prisma.membership_plans.update({ where: { id: membership.plan_id }, data: { deposit_per_item: 30000 } });
  const { creditAccount, holdFunds } = require('../src/services/account.service');
  await prisma.$transaction(tx => creditAccount(tx, { customerId: reservation.customer_id, amount: 30000, idempotencyKey: crypto.randomUUID(), referenceType: 'TEST_SEED' }));
  const original = prisma.$transaction.bind(prisma);
  let transactions = 0;
  inventory.consumed.length = 0;
  prisma.$transaction = async (callback, ...args) => {
    transactions += 1;
    if (transactions === 2) await original(tx => holdFunds(tx, { customerId: reservation.customer_id, amount: 30000, idempotencyKey: crypto.randomUUID(), referenceType: 'TEST_COMPETING_HOLD' }));
    return original(callback, ...args);
  };
  try {
    const result = await invoke(loans.convertReservationToLoan, reservation.id, picked());
    assert.equal(result.status, 409);
    assert.equal(inventory.consumed.length, 0);
    assert.equal(await prisma.loan_transactions.count({ where: { source_reservation_id: reservation.id } }), 0);
    assert.equal((await prisma.loan_reservations.findUnique({ where: { id: reservation.id } })).status, 'CONFIRMED');
  } finally { prisma.$transaction = original; }
});

test('SB02: overdue sweep preserves the rate of an expired but still ACTIVE membership', options, async () => {
  const { customer, items } = await fixture(1);
  await prisma.customer_memberships.updateMany({ where: { customer_id: customer.id }, data: { end_date: new Date(Date.now() - 86400000) } });
  const client = Object.create(prisma);
  Object.defineProperty(client, 'loan_items', { value: { findMany: args => prisma.loan_items.findMany({ ...args, where: { ...args.where, id: items[0].id } }) } });
  await sweep(client, { limit: 10 });
  const fine = await prisma.fines.findFirst({ where: { loan_item_id: items[0].id, fine_type: 'OVERDUE' } });
  assert.equal(Number(fine.amount), 15000);
});
