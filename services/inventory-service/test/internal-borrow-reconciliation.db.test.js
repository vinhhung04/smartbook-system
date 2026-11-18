const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');

const url = process.env.INVENTORY_AUDIT_TEST_DATABASE_URL;
test('internal Borrow reconciliation reads scoped custody evidence on PostgreSQL', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && /^\/inventory_audit[a-z_]*$/.test(target.pathname));
  const { PrismaClient } = process.env.INVENTORY_AUDIT_PRISMA_CLIENT ? require(process.env.INVENTORY_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  let server;
  try {
    const { createInternalBorrowReconciliationRouter } = require('../src/routes/internal-borrow-reconciliation.routes');
    const key = randomUUID();
    let configuredKey = key;
    const app = express();
    app.use('/internal', createInternalBorrowReconciliationRouter({ prisma, internalKey: () => configuredKey }));
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = `http://127.0.0.1:${server.address().port}/internal/borrow-reconciliation`;
    const reservationId = randomUUID(), loanId = randomUUID(), loanItemId = randomUUID(), customerId = randomUUID();
    const warehouse = await prisma.warehouses.create({ data: { code: `BR-${randomUUID().slice(0, 10)}`, name: 'Borrow read audit' } });
    const book = await prisma.books.create({ data: { title: 'Borrow read audit' } });
    const variant = await prisma.book_variants.create({ data: { book_id: book.id, sku: `BR-${randomUUID()}` } });
    const location = await prisma.locations.create({ data: { warehouse_id: warehouse.id, location_code: 'BR-SHELF' } });
    const hold = await prisma.stock_reservations.create({ data: { reservation_code: `BR-${randomUUID()}`, variant_id: variant.id,
      warehouse_id: warehouse.id, location_id: location.id, customer_id: customerId, source_service: 'BORROW',
      source_reference_id: reservationId, quantity: 2, expires_at: new Date(Date.now() + 3600000) } });
    const movement = (type, referenceId, metadata = {}, extra = {}) => prisma.stock_movements.create({ data: {
      movement_number: `BR-${randomUUID()}`, movement_type: type, reference_type: 'LOAN_TRANSACTION', reference_id: referenceId,
      warehouse_id: warehouse.id, variant_id: variant.id, quantity: 1, source_service: 'BORROW_SERVICE',
      metadata: { customer_id: customerId, private_name: 'Must never appear', ...metadata }, ...extra,
    } });
    const consume = await movement('BORROW', loanId, { reservation_id: reservationId, loan_number: 'BR-LOAN' });
    const returned = await movement('RETURN', loanId, { loan_item_id: loanItemId, item_condition_on_return: 'GOOD' }, { idempotency_key: `BR-${randomUUID()}` });
    await movement('RETURN', randomUUID(), { loan_item_id: randomUUID() });
    await movement('BORROW', randomUUID(), { reservation_id: randomUUID() });
    await movement('BORROW', loanId, { reservation_id: reservationId }, { reverted: true });
    await movement('BORROW', loanId, { reservation_id: reservationId }, { source_service: 'UNRELATED_SERVICE' });
    async function get(params = {}, auth = key) {
      const response = await fetch(`${base}?${new URLSearchParams(params)}`, { headers: auth ? { 'x-internal-service-key': auth } : {} });
      return { status: response.status, body: await response.json() };
    }
    await t.test('candidate discovery pages legacy remote orphan holds without exposing customers', async () => {
      await prisma.stock_reservations.create({ data: { reservation_code: `BR-${randomUUID()}`, variant_id: variant.id,
        warehouse_id: warehouse.id, location_id: location.id, source_service: 'BORROW',
        source_reference_id: randomUUID(), quantity: 1, status: 'CONSUMED', expires_at: new Date() } });
      const candidates = async (query = '', auth = key) => {
        const response = await fetch(`${base}/candidates?${query}`, { headers: auth ? { 'x-internal-service-key': auth } : {} });
        return { status: response.status, body: await response.json() };
      };
      assert.equal((await candidates('', null)).status, 403);
      assert.equal((await candidates('after=invalid')).status, 400);
      const first = await candidates('limit=1');
      assert.equal(first.status, 200);
      assert.equal(first.body.data.length, 1);
      assert.equal(first.body.next_cursor, first.body.data[0].id);
      const second = await candidates(`limit=1&after=${first.body.next_cursor}`);
      assert.equal(second.status, 200);
      assert.ok(second.body.data[0].id > first.body.data[0].id);
      assert.ok(!JSON.stringify(first.body).includes('customer_id'));
      assert.ok(first.body.data.every(row => ['ACTIVE', 'CONSUMED'].includes(row.status)));
    });
    await t.test('missing, wrong and unconfigured service keys fail closed', async () => {
      assert.equal((await get({ external_reservation_id: reservationId }, null)).status, 403);
      assert.equal((await get({ external_reservation_id: reservationId }, 'wrong')).status, 403);
      configuredKey = '';
      assert.equal((await get({ external_reservation_id: reservationId }, key)).status, 403);
      configuredKey = key;
    });
    await t.test('requires exact UUID identifiers and offers no write routes', async () => {
      for (const params of [{}, { external_reservation_id: 'invalid' }, { external_reservation_id: reservationId, external_loan_id: 'invalid' }]) {
        assert.equal((await get(params)).status, 400);
      }
      assert.equal((await fetch(base, { method: 'POST', headers: { 'x-internal-service-key': key } })).status, 404);
    });
    await t.test('returns exact linked holds, consume and return evidence without customer PII or mutations', async () => {
      const before = await prisma.stock_reservations.findUnique({ where: { id: hold.id } });
      const response = await get({ external_reservation_id: reservationId.toUpperCase() });
      assert.equal(response.status, 200);
      const data = response.body.data;
      assert.deepEqual(data.reservation, { id: hold.id, source_reference_id: reservationId, status: 'ACTIVE', quantity: 2,
        warehouse_id: warehouse.id, variant_id: variant.id, location_id: location.id });
      assert.deepEqual(data.consume_movements.map(row => row.id), [consume.id]);
      assert.deepEqual(data.return_movements.map(row => row.id), [returned.id]);
      assert.equal(data.return_movements[0].loan_item_id, loanItemId);
      assert.equal(data.return_movements[0].item_condition_on_return, 'GOOD');
      assert.equal(data.truncated, false);
      assert.ok(!JSON.stringify(data).includes(customerId));
      assert.ok(!JSON.stringify(data).includes('Must never appear'));
      assert.deepEqual(await prisma.stock_reservations.findUnique({ where: { id: hold.id } }), before);
      assert.equal(await prisma.stock_movements.count({ where: { reference_id: loanId } }), 4);
    });
    await t.test('optional loan UUID finds committed return evidence when reservation hold or consume is absent', async () => {
      const missingReservation = randomUUID();
      const response = await get({ external_reservation_id: missingReservation, external_loan_id: loanId });
      assert.equal(response.status, 200);
      assert.equal(response.body.data.reservation, null);
      assert.deepEqual(response.body.data.return_movements.map(row => row.id), [returned.id]);
    });
    await t.test('caps evidence lists and explicitly signals an incomplete snapshot', async () => {
      await prisma.stock_movements.createMany({ data: Array.from({ length: 101 }, () => ({
        movement_number: `BR-${randomUUID()}`, movement_type: 'RETURN', reference_type: 'LOAN_TRANSACTION', reference_id: loanId,
        warehouse_id: warehouse.id, variant_id: variant.id, quantity: 1, source_service: 'BORROW_SERVICE',
        metadata: { loan_item_id: randomUUID(), item_condition_on_return: 'GOOD' },
      })) });
      const response = await get({ external_reservation_id: reservationId });
      assert.equal(response.status, 200);
      assert.equal(response.body.data.return_movements.length, 100);
      assert.equal(response.body.data.truncated, true);
    });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await prisma.$disconnect();
  }
});
