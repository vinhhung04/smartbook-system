// Reservation idempotency (Phase E) against a real PostgreSQL: the primary-key
// constraint, the per-customer advisory lock and committed-vs-uncommitted reads
// cannot be checked with an in-memory fake. The real controller and Prisma run;
// only inventory-service is replaced (it is another process) by a stand-in that
// keeps inventory's contract: one stock hold per reservation_id.
//
// Runs only when BORROW_TEST_DATABASE_URL points at a disposable database with
// every borrow-service migration applied (it writes customers and reservations):
//   BORROW_TEST_DATABASE_URL=postgresql://... node --test test/reservation-idempotency.db.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, test, before, after, beforeEach } = require('node:test');

const url = process.env.BORROW_TEST_DATABASE_URL;
const skip = url ? false : 'BORROW_TEST_DATABASE_URL is not set';
if (url) process.env.DATABASE_URL = url;

// inventory-service stand-in: same dedup rule as borrow-integration.controller reserveFromBorrow
const inventory = { holds: new Map(), released: [], reserveCalls: 0, availabilityError: null, reserveDelayMs: 0 };
const inventoryPath = require.resolve('../src/services/inventory-integration.service');
require.cache[inventoryPath] = {
  id: inventoryPath,
  filename: inventoryPath,
  loaded: true,
  exports: {
    checkAvailability: async () => { if (inventory.availabilityError) throw inventory.availabilityError; },
    reserveStock: async (args) => {
      inventory.reserveCalls += 1;
      if (inventory.reserveDelayMs) await new Promise((r) => setTimeout(r, inventory.reserveDelayMs));
      if (!inventory.holds.has(args.reservation_id)) inventory.holds.set(args.reservation_id, args);
      return { data: { reservation_id: args.reservation_id } };
    },
    releaseReservation: async (args) => { inventory.released.push(args.reservation_id); inventory.holds.delete(args.reservation_id); },
  },
};

let prisma;
let createReservation;
const VARIANT = () => crypto.randomUUID();
const WAREHOUSE = crypto.randomUUID();

async function makeCustomer({ maxLoans = 5 } = {}) {
  const plan = await prisma.membership_plans.create({
    data: {
      code: `T${crypto.randomUUID().slice(0, 12)}`,
      name: 'Idempotency test plan',
      max_active_loans: maxLoans,
      reservation_hold_hours: 24,
    },
  });
  const customer = await prisma.customers.create({
    data: { customer_code: `T-${crypto.randomUUID().slice(0, 12)}`, full_name: 'Idempotency test reader', status: 'ACTIVE' },
  });
  await prisma.customer_memberships.create({
    data: {
      customer_id: customer.id,
      plan_id: plan.id,
      card_number: `C-${crypto.randomUUID().slice(0, 16)}`,
      status: 'ACTIVE',
      start_date: new Date(Date.now() - 86400000),
    },
  });
  return { customer, plan };
}

function call(body, { key, user = crypto.randomUUID() } = {}) {
  const req = {
    body,
    user: { id: user },
    headers: key ? { 'idempotency-key': key, authorization: 'Bearer test' } : { authorization: 'Bearer test' },
  };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    };
    createReservation(req, res);
  });
}

const payload = (customerId, variantId) => ({ customer_id: customerId, variant_id: variantId, warehouse_id: WAREHOUSE, quantity: 1 });
const countFor = (customerId) => prisma.loan_reservations.count({ where: { customer_id: customerId } });

describe('reservation idempotency (real PostgreSQL)', { skip }, () => {
  before(() => {
    ({ prisma } = require('../src/lib/prisma'));
    ({ createReservation } = require('../src/controllers/reservation.controller'));
  });
  after(async () => { await prisma?.$disconnect(); });
  beforeEach(() => {
    inventory.holds.clear(); inventory.released.length = 0; inventory.reserveCalls = 0;
    inventory.availabilityError = null; inventory.reserveDelayMs = 0;
  });

  test('retry after a lost response replays the reservation that was created', async () => {
    const { customer } = await makeCustomer();
    const user = crypto.randomUUID();
    const key = crypto.randomUUID();
    const body = payload(customer.id, VARIANT());
    const first = await call(body, { key, user });
    assert.equal(first.status, 201);
    const retry = await call(body, { key, user });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.idempotent, true);
    assert.equal(retry.body.data.id, first.body.data.id);
    assert.equal(await countFor(customer.id), 1);
  });

  test('retry when the first attempt never reached the database creates it once', async () => {
    const { customer } = await makeCustomer();
    const user = crypto.randomUUID();
    const key = crypto.randomUUID();
    const body = payload(customer.id, VARIANT());
    inventory.availabilityError = Object.assign(new Error('inventory unreachable'), { status: 503 });
    const failed = await call(body, { key, user });
    assert.equal(failed.status, 500);
    assert.equal(await countFor(customer.id), 0);
    inventory.availabilityError = null;
    const retry = await call(body, { key, user });
    assert.equal(retry.status, 201);
    assert.equal(await countFor(customer.id), 1);
  });

  test('retry of the reservation that reached the membership limit still replays (not 409)', async () => {
    const { customer } = await makeCustomer({ maxLoans: 5 });
    const user = crypto.randomUUID();
    for (let i = 0; i < 4; i += 1) {
      assert.equal((await call(payload(customer.id, VARIANT()), { key: crypto.randomUUID(), user })).status, 201);
    }
    const key = crypto.randomUUID();
    const fifth = payload(customer.id, VARIANT());
    assert.equal((await call(fifth, { key, user })).status, 201);
    const retry = await call(fifth, { key, user });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.idempotent, true);
    // a genuinely new sixth reservation is still refused
    const sixth = await call(payload(customer.id, VARIANT()), { key: crypto.randomUUID(), user });
    assert.equal(sixth.status, 409);
    assert.equal(await countFor(customer.id), 5);
  });

  test('retry after the membership changed replays instead of re-validating', async () => {
    const { customer } = await makeCustomer();
    const user = crypto.randomUUID();
    const key = crypto.randomUUID();
    const body = payload(customer.id, VARIANT());
    assert.equal((await call(body, { key, user })).status, 201);
    await prisma.customer_memberships.updateMany({ where: { customer_id: customer.id }, data: { status: 'EXPIRED' } });
    const retry = await call(body, { key, user });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.idempotent, true);
    // without the key the same request is now refused: the replay did not bypass the rule for new work
    const fresh = await call(payload(customer.id, VARIANT()), { key: crypto.randomUUID(), user });
    assert.equal(fresh.status, 409);
  });

  test('two concurrent requests with one key create one reservation and keep its stock hold', async () => {
    const { customer } = await makeCustomer();
    const user = crypto.randomUUID();
    const key = crypto.randomUUID();
    const body = payload(customer.id, VARIANT());
    inventory.reserveDelayMs = 50; // both requests are past the idempotency lookup before either inserts
    const results = await Promise.all([call(body, { key, user }), call(body, { key, user })]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 201], JSON.stringify(results.map((r) => r.body)));
    assert.equal(results[0].body.data.id, results[1].body.data.id);
    assert.equal(await countFor(customer.id), 1);
    assert.deepEqual(inventory.released, [], 'the losing request must not release the winner\'s stock hold');
    assert.equal(inventory.holds.size, 1);
  });

  test('one key reused with a different payload is a conflict', async () => {
    const { customer } = await makeCustomer();
    const user = crypto.randomUUID();
    const key = crypto.randomUUID();
    assert.equal((await call(payload(customer.id, VARIANT()), { key, user })).status, 201);
    const other = await call(payload(customer.id, VARIANT()), { key, user });
    assert.equal(other.status, 409);
    assert.equal(other.body.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await countFor(customer.id), 1);
  });

  test('the same key from two users never replays the other user\'s reservation', async () => {
    const a = await makeCustomer();
    const b = await makeCustomer();
    const key = crypto.randomUUID();
    const first = await call(payload(a.customer.id, VARIANT()), { key, user: crypto.randomUUID() });
    assert.equal(first.status, 201);
    const second = await call(payload(b.customer.id, VARIANT()), { key, user: crypto.randomUUID() });
    assert.equal(second.status, 201, 'a separate user gets a separate reservation, not a conflict or a replay');
    assert.notEqual(second.body.data.id, first.body.data.id);
    assert.equal(second.body.data.customer_id, b.customer.id);
  });

  test('a reservation created before key scoping (legacy id) still replays for its creator only', async () => {
    const { customer } = await makeCustomer();
    const user = crypto.randomUUID();
    const key = crypto.randomUUID();
    const { deterministicUuid } = require('@smartbook/shared/runtime');
    const legacyId = deterministicUuid(`reservation:${key}`);
    const variantId = VARIANT();
    await prisma.loan_reservations.create({
      data: {
        id: legacyId,
        reservation_number: `RSV-${legacyId.slice(0, 8).toUpperCase()}`,
        customer_id: customer.id, variant_id: variantId, warehouse_id: WAREHOUSE, quantity: 1,
        source_channel: 'WEB', status: 'PENDING', expires_at: new Date(Date.now() + 86400000),
        created_by_user_id: user,
      },
    });
    const retry = await call(payload(customer.id, variantId), { key, user });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.id, legacyId);
    const stranger = await call(payload(customer.id, variantId), { key, user: crypto.randomUUID() });
    assert.notEqual(stranger.body?.data?.id, legacyId);
  });

  test('replay after the connection pool is dropped (restart stand-in; the live E2E restarts the container)', async () => {
    const { customer } = await makeCustomer();
    const user = crypto.randomUUID();
    const key = crypto.randomUUID();
    const body = payload(customer.id, VARIANT());
    const first = await call(body, { key, user });
    assert.equal(first.status, 201);
    await prisma.$disconnect(); // the process's connections go away, as on a restart
    const retry = await call(body, { key, user });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.id, first.body.data.id);
  });

  test('missing Idempotency-Key is still rejected', async () => {
    const { customer } = await makeCustomer();
    const res = await call(payload(customer.id, VARIANT()));
    assert.equal(res.status, 400);
  });
});
