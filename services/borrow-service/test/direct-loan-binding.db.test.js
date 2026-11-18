const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { deterministicUuid } = require('@smartbook/shared/runtime');
const url = process.env.BORROW_TEST_DATABASE_URL;
const opts = { skip: !url && 'BORROW_TEST_DATABASE_URL not set' };
let prisma, controller;
const warehouseA = randomUUID(), warehouseB = randomUUID();
const actorA = { id: randomUUID(), roles: ['ADMIN'], permissions: ['borrow.write'] };
const actorB = { id: randomUUID(), roles: ['ADMIN'], permissions: ['borrow.write'] };
const SHELF = randomUUID();
const otherB = { id: randomUUID(), roles: ['ADMIN'], permissions: ['borrow.write'] };
test.before(() => {
  if (!url) return;
  const target = new URL(url); assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.pathname, '/borrow_audit');
  process.env.DATABASE_URL = url; const { PrismaClient } = require('@prisma/client'); prisma = new PrismaClient();
  const mock = (path, exports) => { const id = require.resolve(path); require.cache[id] = { id, filename: id, loaded: true, exports }; };
  mock('../src/lib/prisma', { prisma }); mock('../src/lib/socket-emitter', { pushEvents: async () => {} });
  mock('../src/services/inventory-integration.service', { checkAvailability: async () => {}, reserveStock: async () => {}, consumeReservation: async () => {},
    reallocateReservationStock: async () => {}, releaseReservation: async () => {} });
  require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({ canWrite: async (user, warehouse) =>
    (user.id === actorA.id && warehouse === warehouseA) || ([actorB.id, otherB.id].includes(user.id) && warehouse === warehouseB) });
  controller = require('../src/controllers/loan.controller');
});
test.after(async () => prisma?.$disconnect());
async function call(body, key, actor) {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  await controller.createDirectLoan({ body, params: {}, headers: { 'idempotency-key': key }, user: actor }, res); return res;
}
async function legacy() {
  const customer = await prisma.customers.create({ data: { customer_code: `LEG-${randomUUID().slice(0, 12)}`, full_name: 'Isolated legacy replay' } });
  const key = randomUUID(), variant = randomUUID();
  const reservation = await prisma.loan_reservations.create({ data: { id: deterministicUuid(`direct-loan:reservation:${key}`),
    reservation_number: `LEG-${randomUUID()}`, customer_id: customer.id, variant_id: variant, warehouse_id: warehouseB,
    quantity: 1, pickup_location_id: SHELF, source_channel: 'COUNTER', status: 'CONVERTED_TO_LOAN', created_by_user_id: actorB.id, expires_at: new Date(Date.now() + 86400000) } });
  const loan = await prisma.loan_transactions.create({ data: { id: deterministicUuid(`direct-loan:loan:${key}`), loan_number: `LEG-${randomUUID()}`,
    customer_id: customer.id, warehouse_id: warehouseB, handled_by_user_id: actorB.id, source_reservation_id: reservation.id,
    due_date: new Date(Date.now() + 86400000), total_items: 1 } });
  // pickup_location_id: the shelf the copies were taken from (khoa); part of the bound request.
  return { key, loan, body: { customer_id: customer.id, variant_id: variant, warehouse_id: warehouseB, quantity: 1, pickup_location_id: SHELF } };
}
test('PRA04: legacy direct replay authorizes the stored warehouse before returning any loan data', opts, async () => {
  const f = await legacy(); const response = await call({ ...f.body, warehouse_id: warehouseA }, f.key, actorA);
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.stringify(response.body).includes(f.loan.id), false);
  assert.equal((await call(f.body, f.key, actorB)).statusCode, 200);
});
test('PRA04: legacy key binds the original actor, customer, quantity and variant', opts, async () => {
  const f = await legacy();
  for (const [body, actor] of [[f.body, otherB], [{ ...f.body, customer_id: randomUUID() }, actorB],
    [{ ...f.body, quantity: 2 }, actorB], [{ ...f.body, variant_id: randomUUID() }, actorB]]) {
    const response = await call(body, f.key, actor);
    assert.equal(response.statusCode, 409); assert.equal(response.body.data, undefined);
  }
});
test('PRA04: current approved request replays after response loss and rejects changed actor or payload', opts, async () => {
  const f = await legacy();
  const plan = await prisma.membership_plans.create({ data: { code: `NEW-${randomUUID().slice(0, 12)}`, name: 'Current direct-loan fixture' } });
  await prisma.customer_memberships.create({ data: { customer_id: f.body.customer_id, plan_id: plan.id, card_number: randomUUID(), start_date: new Date(Date.now() - 86400000) } });
  const key = randomUUID();
  const first = await call(f.body, key, actorB);
  assert.equal(first.statusCode, 201, JSON.stringify(first.body));
  const replay = await call(f.body, key, actorB);
  assert.equal(replay.statusCode, 200); assert.equal(replay.body.data.id, first.body.data.id);
  assert.equal(await prisma.loan_transactions.count({ where: { id: first.body.data.id } }), 1);
  for (const [body, actor] of [[f.body, otherB], [{ ...f.body, variant_id: randomUUID() }, actorB], [{ ...f.body, quantity: 2 }, actorB]]) {
    const response = await call(body, key, actor); assert.equal(response.statusCode, 409); assert.equal(response.body.data, undefined);
  }
});
