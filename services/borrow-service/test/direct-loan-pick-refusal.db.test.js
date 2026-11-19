const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.BORROW_TEST_DATABASE_URL;
const opts = { skip: !url && 'BORROW_TEST_DATABASE_URL not set' };
let prisma, controller;
const warehouse = randomUUID(), SHELF = randomUUID();
const actor = { id: randomUUID(), roles: ['ADMIN'], permissions: ['borrow.write'] };
// Per-test behaviour of the Inventory boundary.
const inventory = { pick: async () => {}, release: async () => {}, released: [] };

test.before(() => {
  if (!url) return;
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/borrow_audit');
  process.env.DATABASE_URL = url; const { PrismaClient } = require('@prisma/client'); prisma = new PrismaClient();
  const mock = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
  mock('../src/lib/prisma', { prisma }); mock('../src/lib/socket-emitter', { pushEvents: async () => {} });
  mock('../src/services/inventory-integration.service', { checkAvailability: async () => {}, reserveStock: async () => {}, consumeReservation: async () => {},
    reallocateReservationStock: input => inventory.pick(input),
    releaseReservation: async input => { inventory.released.push(input); return inventory.release(input); } });
  require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({ canWrite: async () => true });
  controller = require('../src/controllers/loan.controller');
});
test.after(async () => prisma?.$disconnect());

async function fixture() {
  const customer = await prisma.customers.create({ data: { customer_code: `PICK-${randomUUID().slice(0, 12)}`, full_name: 'Pick refusal fixture' } });
  const plan = await prisma.membership_plans.create({ data: { code: `PICK-${randomUUID().slice(0, 12)}`, name: 'Pick refusal plan' } });
  await prisma.customer_memberships.create({ data: { customer_id: customer.id, plan_id: plan.id, card_number: randomUUID(), start_date: new Date(Date.now() - 86400000) } });
  return { customer_id: customer.id, variant_id: randomUUID(), warehouse_id: warehouse, quantity: 1, pickup_location_id: SHELF };
}
async function call(body, key) {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(b) { this.body = b; return this; } };
  await controller.createDirectLoan({ body, params: {}, headers: { 'idempotency-key': key }, user: actor }, res); return res;
}
const releaseRows = key => prisma.integration_outbox.findMany({ where: { event_type: 'RELEASE_RESERVATION',
  payload: { path: ['idempotency_key'], string_contains: key } } });
const refused = () => { throw Object.assign(new Error('Kệ không đủ sách'), { status: 409 }); };

test('pick refusal commits a durable release intent even when the immediate release fails', opts, async () => {
  inventory.pick = refused; inventory.release = async () => { throw Object.assign(new Error('down'), { status: 503 }); };
  const key = randomUUID();
  const response = await call(await fixture(), key);
  assert.equal(response.statusCode, 409); assert.equal(response.body.code, 'BORROW_PICK_REFUSED');
  const rows = await releaseRows(key);
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'PENDING');
  assert.equal(rows[0].payload.reason, 'CANCELLED');
});

test('pick refusal marks the release intent published once the release succeeds', opts, async () => {
  inventory.pick = refused; inventory.release = async () => {};
  const key = randomUUID();
  assert.equal((await call(await fixture(), key)).statusCode, 409);
  const rows = await releaseRows(key);
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'PUBLISHED');
});

test('an ambiguous pick failure keeps the hold and queues no release', opts, async () => {
  inventory.pick = () => { throw Object.assign(new Error('timeout'), { status: 503 }); }; inventory.released = [];
  const key = randomUUID();
  const response = await call(await fixture(), key);
  assert.notEqual(response.statusCode, 409);
  assert.equal(inventory.released.length, 0);
  assert.equal((await releaseRows(key)).length, 0);
});
