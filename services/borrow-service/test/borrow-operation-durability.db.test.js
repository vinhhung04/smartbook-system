const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const path = require('node:path');
const url = process.env.BORROW_TEST_DATABASE_URL;
const opts = { skip: !url && 'BORROW_TEST_DATABASE_URL not set' };
let prisma, loans, reservations;
let failIntentWrite = false, failCompletion = false;
const boundary = { reserve: [], consume: [], release: [], returned: [], onReserve: null, onConsume: null, onRelease: null, onReturn: null };
test.before(() => {
  if (!url) return;
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/borrow_audit'); assert.ok(['25432', '5432'].includes(target.port));
  process.env.DATABASE_URL = url;
  const { PrismaClient } = require('@prisma/client'); prisma = new PrismaClient();
  prisma.$use(async (params, next) => {
    if (params.model === 'integration_outbox' && params.action === 'create'
      && params.args.data.event_type === 'BORROW_OPERATION' && failIntentWrite) throw new Error('injected intent persistence failure');
    if (params.model === 'integration_outbox' && params.action === 'updateMany'
      && params.args.data.status === 'PUBLISHED' && failCompletion) { failCompletion = false; throw new Error('injected local completion failure'); }
    return next(params);
  });
  const mock = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
  mock('../src/lib/prisma', { prisma });
  mock('../src/lib/socket-emitter', { pushEvents: async () => {} });
  mock('../src/services/inventory-integration.service', {
    checkAvailability: async () => {}, getReturnLocations: async () => [],
    reserveStock: async input => { boundary.reserve.push(input); if (boundary.onReserve) await boundary.onReserve(input); },
    consumeReservation: async input => { boundary.consume.push(input); if (boundary.onConsume) await boundary.onConsume(input); },
    releaseReservation: async input => { boundary.release.push(input); if (boundary.onRelease) await boundary.onRelease(input); },
    returnBorrowedStock: async input => { boundary.returned.push(input); if (boundary.onReturn) await boundary.onReturn(input); },
  });
  loans = require('../src/controllers/loan.controller'); reservations = require('../src/controllers/reservation.controller');
});
test.after(async () => prisma?.$disconnect());
test.beforeEach(() => { for (const key of ['reserve', 'consume', 'release', 'returned']) boundary[key] = []; boundary.onReserve = boundary.onConsume = boundary.onRelease = boundary.onReturn = null; failIntentWrite = failCompletion = false; });
const actor = { id: randomUUID(), is_superuser: true, roles: ['ADMIN'], permissions: ['borrow.write'] };
async function call(handler, id, body = {}, key = randomUUID()) {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { id }, body, headers: { 'idempotency-key': key, authorization: 'Bearer synthetic-request-token-never-persist' }, user: actor }, res); return res;
}
async function fixture() {
  const customer = await prisma.customers.create({ data: { customer_code: `DUR-${randomUUID().slice(0, 12)}`, full_name: 'Isolated durability fixture' } });
  const plan = await prisma.membership_plans.create({ data: { code: `DUR-${randomUUID().slice(0, 12)}`, name: 'Durability', max_active_loans: 10, fine_per_day: 0 } });
  await prisma.customer_memberships.create({ data: { customer_id: customer.id, plan_id: plan.id, card_number: randomUUID(), start_date: new Date(Date.now() - 86400000) } });
  return { customer, warehouse: randomUUID(), variant: randomUUID() };
}
async function pendingOperation(kind, aggregateId) {
  return prisma.integration_outbox.findFirst({ where: { event_type: 'BORROW_OPERATION', aggregate_id: aggregateId, payload: { path: ['kind'], equals: kind } } });
}
async function recover(record) {
  const lease = new Date(Date.now() + 1800000);
  await prisma.integration_outbox.update({ where: { id: record.id }, data: { status: 'PROCESSING', lease_until: lease } });
  const current = await prisma.integration_outbox.findUnique({ where: { id: record.id } });
  // Dropping the client pool is a restart stand-in; only database state remains.
  await prisma.$disconnect();
  return require('../src/services/borrow-operation.service').recoverBorrowOperation(current, { prismaClient: prisma });
}
async function makeReservation(f, expiresAt = new Date(Date.now() + 86400000)) {
  return prisma.loan_reservations.create({ data: { reservation_number: `DUR-${randomUUID()}`, customer_id: f.customer.id, variant_id: f.variant, warehouse_id: f.warehouse, status: 'CONFIRMED', expires_at: expiresAt } });
}
async function makeLoan(f) {
  const loan = await prisma.loan_transactions.create({ data: { loan_number: `DUR-${randomUUID()}`, customer_id: f.customer.id, warehouse_id: f.warehouse, handled_by_user_id: actor.id, due_date: new Date(Date.now() + 86400000), total_items: 1 } });
  const item = await prisma.loan_items.create({ data: { loan_id: loan.id, variant_id: f.variant, due_date: loan.due_date } });
  return { loan, item };
}
test('PRA07: direct reserve/consume cannot run before a restartable approved plan exists', opts, async () => {
  const f = await fixture(); let stored;
  boundary.onReserve = async input => {
    stored = await prisma.integration_outbox.findFirst({ where: { event_type: 'BORROW_OPERATION', payload: { path: ['plan', 'reservationId'], equals: input.reservation_id } } });
    assert.ok(stored, 'durable approved operation must exist BEFORE remote reserve');
    assert.equal(stored.payload.plan.loanItems.length, 1);
    assert.equal(JSON.stringify(stored).includes('synthetic-request-token'), false);
  };
  boundary.onConsume = async input => {
    assert.equal(input.loan_id, stored.payload.plan.loanId);
    assert.equal(input.loan_number, stored.payload.plan.loanNumber);
    throw Object.assign(new Error('remote response lost after committing consume'), { status: 502 });
  };
  const response = await call(loans.createDirectLoan, null, { customer_id: f.customer.id, warehouse_id: f.warehouse, variant_id: f.variant, quantity: 1 });
  assert.equal(response.statusCode, 502);
  assert.ok(stored);
  const durable = await prisma.integration_outbox.findUnique({ where: { id: stored.id } });
  assert.ok(['PENDING', 'PROCESSING'].includes(durable.status));
  boundary.onConsume = null;
  assert.deepEqual(await recover(durable), { resolved: true });
  assert.equal(boundary.consume[1].loan_id, boundary.consume[0].loan_id);
  assert.equal(boundary.consume[1].loan_number, boundary.consume[0].loan_number);
  const created = await prisma.loan_transactions.findUnique({ where: { id: durable.payload.plan.loanId }, include: { loan_items: true } });
  assert.deepEqual(created.loan_items.map(row => row.id), durable.payload.plan.loanItems.map(row => row.id));
  assert.equal((await prisma.integration_outbox.findUnique({ where: { id: stored.id } })).status, 'PUBLISHED');
});
test('PRA07: reserve response loss is resumed from the same persisted reservation plan', opts, async () => {
  const f = await fixture();
  boundary.onReserve = async input => {
    const record = await pendingOperation('CREATE_RESERVATION', input.reservation_id);
    assert.ok(record); assert.equal(new Date(record.payload.plan.expiresAt).toISOString(), input.expires_at);
    throw Object.assign(new Error('reserve response lost'), { status: 502 });
  };
  const response = await call(reservations.createReservation, null, { customer_id: f.customer.id, warehouse_id: f.warehouse, variant_id: f.variant, quantity: 1 });
  assert.equal(response.statusCode, 502);
  const record = await pendingOperation('CREATE_RESERVATION', boundary.reserve[0].reservation_id);
  boundary.onReserve = null;
  assert.deepEqual(await recover(record), { resolved: true });
  assert.equal(boundary.reserve[0].reservation_id, boundary.reserve[1].reservation_id);
  assert.equal(boundary.reserve[0].expires_at, boundary.reserve[1].expires_at);
  assert.equal((await prisma.loan_reservations.findUnique({ where: { id: record.aggregate_id } })).status, 'PENDING');
});
test('PRA07: consume response loss rolls back Borrow writes but keeps stable conversion IDs for recovery', opts, async () => {
  const f = await fixture(); const reservation = await makeReservation(f);
  boundary.onConsume = async input => {
    const record = await pendingOperation('CONVERT_RESERVATION', reservation.id);
    assert.ok(record); assert.equal(record.payload.plan.loanId, input.loan_id);
    throw Object.assign(new Error('consume response lost'), { status: 502 });
  };
  assert.equal((await call(loans.convertReservationToLoan, reservation.id)).statusCode, 502);
  const record = await pendingOperation('CONVERT_RESERVATION', reservation.id);
  assert.equal(await prisma.loan_transactions.count({ where: { source_reservation_id: reservation.id } }), 0);
  boundary.onConsume = null;
  assert.deepEqual(await recover(record), { resolved: true });
  assert.equal(boundary.consume[0].loan_id, boundary.consume[1].loan_id);
  assert.equal(boundary.consume[0].loan_number, boundary.consume[1].loan_number);
  assert.equal(boundary.consume[0].idempotency_key, boundary.consume[1].idempotency_key);
  const items = await prisma.loan_items.findMany({ where: { loan_id: record.payload.plan.loanId } });
  assert.deepEqual(items.map(row => row.id), record.payload.plan.loanItems.map(row => row.id));
});
test('PRA07: return response loss preserves per-copy plan and replays exactly its remote identity', opts, async () => {
  const f = await fixture();
  const loan = await prisma.loan_transactions.create({ data: { loan_number: `DUR-${randomUUID()}`, customer_id: f.customer.id, warehouse_id: f.warehouse, handled_by_user_id: actor.id, due_date: new Date(Date.now() + 86400000), total_items: 1 } });
  const item = await prisma.loan_items.create({ data: { loan_id: loan.id, variant_id: f.variant, due_date: loan.due_date } });
  boundary.onReturn = async () => { assert.ok(await pendingOperation('RETURN_LOAN', loan.id)); throw Object.assign(new Error('return response lost'), { status: 502 }); };
  assert.equal((await call(loans.returnLoan, loan.id, { loan_item_id: item.id })).statusCode, 502);
  const record = await pendingOperation('RETURN_LOAN', loan.id); boundary.onReturn = null;
  assert.deepEqual(await recover(record), { resolved: true });
  assert.equal(boundary.returned[0].idempotency_key, boundary.returned[1].idempotency_key);
  assert.equal((await prisma.loan_items.findUnique({ where: { id: item.id } })).status, 'RETURNED');
  assert.equal((await prisma.integration_outbox.findUnique({ where: { id: record.id } })).status, 'PUBLISHED');
});
test('PRA07: expiry commits a release intent with local expiry and recovers lost response', opts, async () => {
  const f = await fixture(); const reservation = await makeReservation(f, new Date(Date.now() - 60000));
  boundary.onRelease = async () => {
    assert.ok(await pendingOperation('EXPIRE_RESERVATION', reservation.id));
    assert.equal((await prisma.loan_reservations.findUnique({ where: { id: reservation.id } })).status, 'EXPIRED');
    throw Object.assign(new Error('expiry response lost'), { status: 502 });
  };
  await assert.rejects(reservations.releaseExpiredReservation(reservation), /expiry response lost/);
  const record = await pendingOperation('EXPIRE_RESERVATION', reservation.id); boundary.onRelease = null;
  assert.deepEqual(await recover(record), { resolved: true });
  assert.equal(boundary.release[0].idempotency_key, boundary.release[1].idempotency_key);
  assert.equal((await prisma.integration_outbox.findUnique({ where: { id: record.id } })).status, 'PUBLISHED');
});
test('PRA07: intent storage failure prevents every direct remote mutation', opts, async () => {
  const f = await fixture(); failIntentWrite = true;
  const response = await call(loans.createDirectLoan, null, { customer_id: f.customer.id, warehouse_id: f.warehouse, variant_id: f.variant, quantity: 1 });
  assert.equal(response.statusCode, 500); assert.equal(boundary.reserve.length, 0); assert.equal(boundary.consume.length, 0);
});
test('PRA07: failure publishing local completion rolls back local loan and can replay remote success', opts, async () => {
  const f = await fixture(); failCompletion = true;
  assert.equal((await call(loans.createDirectLoan, null, { customer_id: f.customer.id, warehouse_id: f.warehouse, variant_id: f.variant, quantity: 1 })).statusCode, 502);
  const record = await prisma.integration_outbox.findFirst({ where: { event_type: 'BORROW_OPERATION', payload: { path: ['plan', 'loanId'], equals: boundary.consume[0].loan_id } } });
  assert.equal(await prisma.loan_transactions.count({ where: { id: record.payload.plan.loanId } }), 0);
  assert.deepEqual(await recover(record), { resolved: true });
  assert.equal(await prisma.loan_transactions.count({ where: { id: record.payload.plan.loanId } }), 1);
});
test('PRA07: actual process death at mocked Inventory response boundary leaves a recoverable plan', opts, async () => {
  const f = await fixture();
  const input = { body: { customer_id: f.customer.id, warehouse_id: f.warehouse, variant_id: f.variant, quantity: 1 }, key: randomUUID(), actor };
  const child = fork(path.join(__dirname, 'helpers/borrow-crash-child.cjs'), [JSON.stringify(input)], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const timer = setTimeout(() => child.kill('SIGKILL'), 20000);
  let message;
  child.on('message', value => { message = value; });
  try {
    const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code, signal) => resolve({ code, signal })); });
    assert.equal(exit.signal, 'SIGKILL'); assert.ok(message?.operation_id, 'child must reach the boundary with durable intent before death');
    const record = await prisma.integration_outbox.findUnique({ where: { id: message.operation_id } });
    assert.equal(record.status, 'PROCESSING'); assert.equal(record.payload.remote_started, true);
    assert.equal(await prisma.loan_transactions.count({ where: { id: message.loan_id } }), 0);
    assert.deepEqual(await recover(record), { resolved: true });
    assert.equal(await prisma.loan_transactions.count({ where: { id: message.loan_id } }), 1);
  } finally { clearTimeout(timer); }
});
test('PRA07: stale lease owners cannot mark, complete or defer a newer claim', opts, async () => {
  const f = await fixture();
  boundary.onConsume = async () => { throw Object.assign(new Error('uncertain consume'), { status: 502 }); };
  await call(loans.createDirectLoan, null, { customer_id: f.customer.id, warehouse_id: f.warehouse, variant_id: f.variant, quantity: 1 });
  const service = require('../src/services/borrow-operation.service');
  const old = await prisma.integration_outbox.findFirst({ where: { event_type: 'BORROW_OPERATION', payload: { path: ['plan', 'loanId'], equals: boundary.consume[0].loan_id } } });
  const newLease = new Date(Date.now() + 1800000);
  await prisma.integration_outbox.update({ where: { id: old.id }, data: { status: 'PROCESSING', lease_until: newLease } });
  await assert.rejects(service.markBorrowRemoteStarted(prisma, old), /chuyển sang/);
  await assert.rejects(service.completeBorrowOperation(prisma, old, { status: 200, body: {} }), /chuyển sang/);
  await service.deferBorrowOperation(prisma, old, new Error('old failure'));
  const current = await prisma.integration_outbox.findUnique({ where: { id: old.id } });
  assert.equal(current.status, 'PROCESSING'); assert.equal(current.lease_until.getTime(), newLease.getTime());
  await prisma.integration_outbox.update({ where: { id: old.id }, data: { status: 'MANUAL_REVIEW', lease_until: null } });
  assert.equal((await service.recoverBorrowOperation(await prisma.integration_outbox.findUnique({ where: { id: old.id } }))).manual, true);
});
test('PRA07: invalid notes never become an approved plan or mutate remote stock', opts, async () => {
  const f = await fixture(); const body = { customer_id: f.customer.id, warehouse_id: f.warehouse, variant_id: f.variant, quantity: 1, notes: { invalid: true } };
  for (const handler of [loans.createDirectLoan, reservations.createReservation]) {
    const response = await call(handler, null, body);
    assert.equal(response.statusCode, 400); assert.equal(boundary.reserve.length, 0); assert.equal(boundary.consume.length, 0);
  }
});
test('PRA07: a valid long client key keeps bounded stable Inventory identities across replay', opts, async () => {
  const f = await fixture(); const key = 'long-client-key-' + randomUUID().repeat(5);
  boundary.onReserve = async input => assert.ok(input.idempotency_key.length <= 100, 'Inventory movement key column is varchar100');
  boundary.onConsume = async input => assert.ok(input.idempotency_key.length <= 100);
  const body = { customer_id: f.customer.id, warehouse_id: f.warehouse, variant_id: f.variant, quantity: 1 };
  const first = await call(loans.createDirectLoan, null, body, key); assert.equal(first.statusCode, 201);
  const replay = await call(loans.createDirectLoan, null, body, key); assert.equal(replay.statusCode, 200); assert.equal(replay.body.data.id, first.body.data.id);
});
test('PRA07: a definitive reserve refusal cannot silently become a new loan after restart', opts, async () => {
  const f = await fixture(); boundary.onReserve = async () => { throw Object.assign(new Error('no stock available'), { status: 409 }); };
  const body = { customer_id: f.customer.id, warehouse_id: f.warehouse, variant_id: f.variant, quantity: 1 };
  assert.equal((await call(loans.createDirectLoan, null, body)).statusCode, 409);
  const record = await prisma.integration_outbox.findFirst({ where: { event_type: 'BORROW_OPERATION', payload: { path: ['plan', 'reservationId'], equals: boundary.reserve[0].reservation_id } } });
  assert.equal(record.status, 'PUBLISHED'); assert.equal(record.payload.response.status, 409);
  boundary.onReserve = null;
  assert.deepEqual(await require('../src/services/borrow-operation.service').recoverBorrowOperation(record), { resolved: true });
  assert.equal(boundary.consume.length, 0); assert.equal(await prisma.loan_transactions.count({ where: { id: record.payload.plan.loanId } }), 0);
});
test('PRA07: reserve conflict after an earlier unknown attempt remains manual, never falsely aborted', opts, async () => {
  const f = await fixture(), key = randomUUID();
  const body = { customer_id: f.customer.id, warehouse_id: f.warehouse, variant_id: f.variant, quantity: 1 };
  boundary.onReserve = async () => { throw Object.assign(new Error('unknown initial reserve'), { status: 502 }); };
  assert.equal((await call(loans.createDirectLoan, null, body, key)).statusCode, 502);
  boundary.onReserve = async () => { throw Object.assign(new Error('conflict on replay'), { status: 409 }); };
  assert.equal((await call(loans.createDirectLoan, null, body, key)).statusCode, 409);
  const record = await prisma.integration_outbox.findFirst({ where: { event_type: 'BORROW_OPERATION', payload: { path: ['plan', 'reservationId'], equals: boundary.reserve[0].reservation_id } } });
  assert.equal(record.status, 'MANUAL_REVIEW'); assert.notEqual(record.payload.state, 'ABORTED');
  assert.equal((await require('../src/services/borrow-operation.service').recoverBorrowOperation(record)).manual, true);
  assert.equal(boundary.consume.length, 0);
});
test('PRA07: fresh batch cutoff remains after the final Inventory acknowledgement', opts, async () => {
  const f = await fixture(); const { loan, item } = await makeLoan(f); let acknowledgedAt;
  boundary.onReturn = async () => { await new Promise(resolve => setTimeout(resolve, 30)); acknowledgedAt = Date.now(); };
  assert.equal((await call(loans.returnLoan, loan.id, { loan_item_id: item.id })).statusCode, 200);
  const stored = await prisma.loan_items.findUnique({ where: { id: item.id } });
  assert.ok(stored.return_date.getTime() >= acknowledgedAt, 'preserve the original after-ACK batch cutoff');
});
test('PRA07: unknown return across an accrual boundary needs review instead of choosing a new money cutoff', opts, async () => {
  const f = await fixture(); const { loan, item } = await makeLoan(f);
  await prisma.loan_items.update({ where: { id: item.id }, data: { due_date: new Date(Date.now() - 2 * 86400000) } });
  boundary.onReturn = async () => { throw Object.assign(new Error('unknown return'), { status: 502 }); };
  await call(loans.returnLoan, loan.id, { loan_item_id: item.id });
  const record = await pendingOperation('RETURN_LOAN', loan.id);
  // Simulate an approved request retained from the previous accrual day; only
  // isolated test metadata is moved in time, never a financial/history row.
  await prisma.integration_outbox.update({ where: { id: record.id }, data: { payload: { ...record.payload,
    plan: { ...record.payload.plan, requestedAt: new Date(Date.now() - 86400000).toISOString() } } } });
  boundary.onReturn = null;
  assert.equal((await recover(await prisma.integration_outbox.findUnique({ where: { id: record.id } }))).manual, true);
  assert.equal((await prisma.loan_items.findUnique({ where: { id: item.id } })).status, 'BORROWED');
});
test('PRA07: completion cutoff and prices survive a local failure and later policy change', opts, async () => {
  const f = await fixture(); const { loan, item } = await makeLoan(f); failCompletion = true;
  assert.equal((await call(loans.returnLoan, loan.id, { loan_item_id: item.id })).statusCode, 502);
  const record = await pendingOperation('RETURN_LOAN', loan.id);
  assert.ok(record.payload.completion?.completedAt, 'persist completion context before local business commit');
  const oldPolicy = record.payload.completion.pricing;
  await prisma.membership_plans.updateMany({ where: { customer_memberships: { some: { customer_id: f.customer.id } } }, data: { fine_per_day: 7000 } });
  assert.deepEqual(await recover(record), { resolved: true });
  const completed = await prisma.integration_outbox.findUnique({ where: { id: record.id } });
  assert.deepEqual(completed.payload.completion.pricing, oldPolicy);
  assert.equal((await prisma.loan_items.findUnique({ where: { id: item.id } })).return_date.toISOString(), record.payload.completion.completedAt);
});
test('PRA07: an exact due-date change within the same accrual day is reviewed, not overwritten', opts, async () => {
  const f = await fixture(); const { loan, item } = await makeLoan(f);
  boundary.onReturn = async () => { throw Object.assign(new Error('unknown return'), { status: 502 }); };
  await call(loans.returnLoan, loan.id, { loan_item_id: item.id });
  const record = await pendingOperation('RETURN_LOAN', loan.id);
  await prisma.loan_items.update({ where: { id: item.id }, data: { due_date: new Date(item.due_date.getTime() + 1000) } });
  boundary.onReturn = null;
  assert.equal((await recover(record)).manual, true);
  assert.equal((await prisma.loan_items.findUnique({ where: { id: item.id } })).status, 'BORROWED');
});
test('PRA07: fresh return spanning UTC midnight retains the baseline after-ACK accrual day', opts, async () => {
  const f = await fixture(); const { loan, item } = await makeLoan(f);
  const RealDate = Date, realNow = new RealDate();
  const today = RealDate.UTC(realNow.getUTCFullYear(), realNow.getUTCMonth(), realNow.getUTCDate());
  await prisma.loan_items.update({ where: { id: item.id }, data: { due_date: new RealDate(today - 2 * 86400000) } });
  await prisma.membership_plans.updateMany({ where: { customer_memberships: { some: { customer_id: f.customer.id } } }, data: { fine_per_day: 5000 } });
  let clock = today + 86400000 - 100;
  class FixtureDate extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  global.Date = FixtureDate;
  try {
    boundary.onReturn = async () => { clock = today + 86400000 + 100; };
    const response = await call(loans.returnLoan, loan.id, { loan_item_id: item.id });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  } finally { global.Date = RealDate; }
  const fine = await prisma.fines.findFirst({ where: { loan_item_id: item.id, fine_type: 'OVERDUE' } });
  assert.equal(Number(fine.amount), 15000); assert.equal(fine.accrual_through_days, 3);
  assert.equal((await prisma.loan_items.findUnique({ where: { id: item.id } })).return_date.getTime(), today + 86400000 + 100);
});
test('PRA07: unknown return with changed pricing is manual even within the same accrual day', opts, async () => {
  const f = await fixture(); const { loan, item } = await makeLoan(f);
  await prisma.loan_items.update({ where: { id: item.id }, data: { due_date: new Date(Date.now() - 2 * 86400000) } });
  boundary.onReturn = async () => { throw Object.assign(new Error('unknown return'), { status: 502 }); };
  await call(loans.returnLoan, loan.id, { loan_item_id: item.id }); const record = await pendingOperation('RETURN_LOAN', loan.id);
  await prisma.membership_plans.updateMany({ where: { customer_memberships: { some: { customer_id: f.customer.id } } }, data: { fine_per_day: 7000 } });
  boundary.onReturn = null;
  assert.equal((await recover(record)).manual, true);
  assert.equal(await prisma.fines.count({ where: { loan_item_id: item.id } }), 0);
});
test('PRA07: accrual beyond a persisted completion cutoff is preserved for manual reconciliation', opts, async () => {
  const f = await fixture(); const { loan, item } = await makeLoan(f);
  const due = new Date(Date.now() - 2 * 86400000);
  await prisma.loan_items.update({ where: { id: item.id }, data: { due_date: due } });
  await prisma.membership_plans.updateMany({ where: { customer_memberships: { some: { customer_id: f.customer.id } } }, data: { fine_per_day: 5000 } });
  failCompletion = true; assert.equal((await call(loans.returnLoan, loan.id, { loan_item_id: item.id })).statusCode, 502);
  const record = await pendingOperation('RETURN_LOAN', loan.id); assert.ok(record.payload.completion);
  const fineService = require('../src/services/fine.service');
  await prisma.$transaction(async tx => {
    await fineService.upsertFine(tx, { customerId: f.customer.id, loanItemId: item.id, fineType: 'OVERDUE', amount: 15000,
      overdueDays: 3, dailyRate: 5000, actorUserId: actor.id });
    await fineService.recomputeCustomerFineBalance(tx, f.customer.id);
  });
  assert.equal((await recover(record)).manual, true);
  const fine = await prisma.fines.findFirst({ where: { loan_item_id: item.id } });
  assert.equal(Number(fine.amount), 15000); assert.equal(fine.accrual_through_days, 3);
  assert.equal(await prisma.fine_payments.count({ where: { fine_id: fine.id } }), 0);
  assert.equal((await prisma.loan_items.findUnique({ where: { id: item.id } })).status, 'BORROWED');
});
test('PRA07: legacy incomplete returns without financial completion evidence require review', opts, async () => {
  const f = await fixture(); const { loan, item } = await makeLoan(f); const key = randomUUID();
  const body = { loan_item_id: item.id };
  const { normalizeReturnRequest, returnFingerprint } = require('../src/services/return-request.service');
  await prisma.loan_return_requests.create({ data: { loan_id: loan.id, idempotency_key: key,
    fingerprint: returnFingerprint(normalizeReturnRequest(body)), status: 'RETRYABLE', unresolved_item_ids: [item.id] } });
  const result = await call(loans.returnLoan, loan.id, body, key);
  assert.equal(result.statusCode, 409); assert.equal(boundary.returned.length, 0);
  assert.equal((await prisma.loan_items.findUnique({ where: { id: item.id } })).status, 'BORROWED');
  assert.equal((await pendingOperation('RETURN_LOAN', loan.id)).status, 'MANUAL_REVIEW');
});
test('PRA07: cancelled local reservation retains a release intent across lost response and replay', opts, async () => {
  const f = await fixture();
  const reservation = await prisma.loan_reservations.create({ data: { reservation_number: `DUR-${randomUUID()}`, customer_id: f.customer.id, variant_id: f.variant, warehouse_id: f.warehouse, status: 'CONFIRMED', expires_at: new Date(Date.now() + 86400000) } });
  boundary.onRelease = async () => {
    const intent = await pendingOperation('CANCEL_RESERVATION', reservation.id);
    assert.ok(intent, 'CANCELLED and release intent must commit together before release');
    assert.equal((await prisma.loan_reservations.findUnique({ where: { id: reservation.id } })).status, 'CANCELLED');
    throw Object.assign(new Error('release response lost'), { status: 502 });
  };
  const key = randomUUID(); const failed = await call(reservations.cancelReservation, reservation.id, {}, key);
  assert.equal(failed.statusCode, 502);
  assert.equal((await prisma.loan_reservations.findUnique({ where: { id: reservation.id } })).status, 'CANCELLED');
  boundary.onRelease = null;
  const replay = await call(reservations.cancelReservation, reservation.id, {}, key);
  assert.equal(replay.statusCode, 200);
  assert.equal(boundary.release.length, 2);
  assert.equal((await pendingOperation('CANCEL_RESERVATION', reservation.id)).status, 'PUBLISHED');
});
