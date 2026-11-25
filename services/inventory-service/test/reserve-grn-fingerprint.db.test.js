const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const url = process.env.INVENTORY_AUDIT_TEST_DATABASE_URL;
test('PRA20: reserve and delivery receipt retries bind normalized actor/resource/payload', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && /^\/inventory_audit[a-z_]*$/.test(target.pathname));
  process.env.DATABASE_URL = url;
  const { PrismaClient } = process.env.INVENTORY_AUDIT_PRISMA_CLIENT ? require(process.env.INVENTORY_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  const prisma = new PrismaClient();
  const prismaPath = require.resolve('../src/lib/prisma');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma } };
  const emitterPath = require.resolve('../src/lib/socket-emitter');
  require.cache[emitterPath] = { id: emitterPath, filename: emitterPath, loaded: true, exports: { pushToRooms: async () => {} } };
  require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({ canWrite: async () => true });
  const { reserveFromBorrow, releaseBorrowReservation } = require('../src/controllers/borrow-integration.controller');
  const { createGoodsReceiptFromInvoice } = require('../src/controllers/supplier-delivery.controller');
  const actor = { id: randomUUID(), is_superuser: true, roles: ['MANAGER'] };
  // Exact claims of inventory-integration.service.js:createServiceAuthHeader.
  // Controller tests receive this only after authenticateToken has verified it.
  const borrowService = { id: '00000000-0000-0000-0000-000000000001', sub: '00000000-0000-0000-0000-000000000001',
    email: 'borrow-service@smartbook.local', full_name: 'Borrow Service', is_superuser: true,
    service: 'borrow-service', iss: 'borrow-service', aud: 'inventory-service',
    permissions: ['borrow.read', 'borrow.write', 'inventory.stock.read', 'inventory.stock.write'] };
  async function invoke(fn, body, { user = actor, id, key = body.idempotency_key } = {}) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await fn({ params: { id }, body, user, get: () => key, headers: { 'idempotency-key': key } }, res);
    return res;
  }
  const warehouse = () => prisma.warehouses.create({ data: { code: `FP-${randomUUID().slice(0, 10)}`, name: 'Fingerprint audit', warehouse_type: 'LIBRARY' } });
  const [wh, otherWh] = await Promise.all([warehouse(), warehouse()]);
  const location = await prisma.locations.create({ data: { warehouse_id: wh.id, location_code: 'FP-SHELF' } });
  const book = await prisma.books.create({ data: { title: 'Fingerprint audit' } });
  const variants = await Promise.all([0, 1].map(() => prisma.book_variants.create({ data: { book_id: book.id, sku: `FP-${randomUUID()}`, is_borrowable: true } })));
  for (const variant of variants) await prisma.stock_balances.create({ data: { variant_id: variant.id, warehouse_id: wh.id, location_id: location.id,
    on_hand_qty: 100, available_qty: 100 } });
  const reserveBody = () => ({ reservation_id: randomUUID(), reservation_number: `FP-${randomUUID()}`, customer_id: randomUUID(),
    variant_id: variants[0].id, warehouse_id: wh.id, quantity: 2, expires_at: '2030-01-01T00:00:00.000Z',
    created_by_user_id: actor.id, reservation_channel: 'CUSTOMER', idempotency_key: `FP-${randomUUID()}` });
  async function receiptFixture(create = true) {
    const supplier = await prisma.suppliers.create({ data: { code: `FP-${randomUUID().slice(0, 10)}`, name: `Fingerprint supplier ${randomUUID()}` } });
    const po = await prisma.purchase_orders.create({ data: { po_number: `FP-${randomUUID()}`, supplier_id: supplier.id, warehouse_id: wh.id,
      ordered_by_user_id: actor.id, status: 'SUPPLIER_CONFIRMED', purchase_order_items: { create: variants.map(v => ({ variant_id: v.id, ordered_qty: 100 })) } },
    include: { purchase_order_items: true } });
    const delivery = await prisma.supplier_delivery_invoices.create({ data: { invoice_number: `FP-${randomUUID()}`, purchase_order_id: po.id, supplier_id: supplier.id,
      supplier_delivery_invoice_items: { create: po.purchase_order_items.map(line => ({ purchase_order_item_id: line.id, variant_id: line.variant_id, invoiced_qty: 10, unit_cost: 5 })) } },
    include: { supplier_delivery_invoice_items: true } });
    const key = `FP-${randomUUID()}`;
    const body = { warehouse_id: wh.id, note: 'Original receipt', items: delivery.supplier_delivery_invoice_items.map(line => ({
      invoice_item_id: line.id, delivered_qty: 10, damaged_qty: 1, rejected_qty: 1, unit_cost: 5,
    })) };
    let receipt = null;
    if (create) {
      const created = await invoke(createGoodsReceiptFromInvoice, body, { id: delivery.id, key });
      assert.equal(created.statusCode, 201, JSON.stringify(created.body));
      receipt = created.body.data;
    }
    return { body, key, delivery, receipt };
  }
  try {
    await t.test('reserve identical normalized payload replays without a second hold', async () => {
      const body = reserveBody();
      assert.equal((await invoke(reserveFromBorrow, body)).statusCode, 201);
      const replay = await invoke(reserveFromBorrow, { ...body, quantity: '2', expires_at: '2030-01-01T07:00:00+07:00' });
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.idempotent, true);
      assert.equal(await prisma.stock_reservations.count({ where: { source_reference_id: body.reservation_id } }), 1);
    });
    await t.test('reserve numeric normalization and applied stock quantity use the same value', async () => {
      const body = { ...reserveBody(), quantity: '2e1' };
      const created = await invoke(reserveFromBorrow, body);
      assert.equal(created.statusCode, 201);
      assert.equal(created.body.data.quantity, 20);
      const replay = await invoke(reserveFromBorrow, { ...body, quantity: 20 });
      assert.equal(replay.statusCode, 200);
      const movement = await prisma.stock_movements.findUnique({ where: { idempotency_key: body.idempotency_key } });
      assert.equal(movement.quantity, movement.metadata.borrow_request.quantity);
    });
    const reserveChanges = {
      actor: body => ({ body, user: { ...actor, id: randomUUID() } }),
      variant: body => ({ body: { ...body, variant_id: variants[1].id } }),
      quantity: body => ({ body: { ...body, quantity: 3 } }),
      warehouse: body => ({ body: { ...body, warehouse_id: otherWh.id } }),
      customer: body => ({ body: { ...body, customer_id: randomUUID() } }),
      expiry: body => ({ body: { ...body, expires_at: '2030-01-02T00:00:00Z' } }),
      creator: body => ({ body: { ...body, created_by_user_id: randomUUID() } }),
      channel: body => ({ body: { ...body, reservation_channel: 'STAFF' } }),
      reservation_number: body => ({ body: { ...body, reservation_number: `FP-${randomUUID()}` } }),
    };
    for (const [field, change] of Object.entries(reserveChanges)) await t.test(`reserve same key changed ${field} conflicts without mutating stock`, async () => {
      const body = reserveBody();
      const first = await invoke(reserveFromBorrow, body);
      assert.equal(first.statusCode, 201, JSON.stringify(first.body));
      const snapshot = await prisma.stock_balances.findMany({ where: { warehouse_id: wh.id }, orderBy: { id: 'asc' } });
      const changed = change(body);
      const replay = await invoke(reserveFromBorrow, changed.body, { user: changed.user || actor });
      assert.equal(replay.statusCode, 409, `same key changed ${field} must not silently return the old hold`);
      assert.deepEqual(await prisma.stock_balances.findMany({ where: { warehouse_id: wh.id }, orderBy: { id: 'asc' } }), snapshot);
    });
    await t.test('approved staff reserve can recover with Borrow service principal and the persisted original creator', async () => {
      const body = reserveBody();
      const first = await invoke(reserveFromBorrow, body);
      assert.equal(first.statusCode, 201);
      const replay = await invoke(reserveFromBorrow, body, { user: borrowService });
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.data.id, first.body.data.id);
      assert.equal(await prisma.stock_reservations.count({ where: { source_reference_id: body.reservation_id } }), 1);
    });
    await t.test('customer reserve using service-token fallback keeps the original customer actor on recovery', async () => {
      const customerActor = randomUUID();
      const body = { ...reserveBody(), customer_id: customerActor, created_by_user_id: customerActor };
      const first = await invoke(reserveFromBorrow, body, { user: borrowService });
      assert.equal(first.statusCode, 201);
      const replay = await invoke(reserveFromBorrow, body, { user: borrowService });
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.data.id, first.body.data.id);
    });
    await t.test('Borrow service recovery cannot change the approved original actor', async () => {
      const body = reserveBody();
      assert.equal((await invoke(reserveFromBorrow, body)).statusCode, 201);
      const replay = await invoke(reserveFromBorrow, { ...body, created_by_user_id: randomUUID() }, { user: borrowService });
      assert.equal(replay.statusCode, 409);
    });
    await t.test('ordinary authenticated staff cannot delegate the actor by supplying another creator', async () => {
      const body = { ...reserveBody(), created_by_user_id: randomUUID() };
      const result = await invoke(reserveFromBorrow, body);
      assert.ok([403, 409].includes(result.statusCode), 'body creator is not proof of an approved service recovery');
      assert.equal(await prisma.stock_reservations.count({ where: { source_reference_id: body.reservation_id } }), 0);
    });
    await t.test('copying service email with an ordinary authenticated actor does not grant recovery delegation', async () => {
      const body = reserveBody();
      assert.equal((await invoke(reserveFromBorrow, body)).statusCode, 201);
      const counterfeit = { ...borrowService, id: randomUUID(), sub: randomUUID() };
      assert.equal((await invoke(reserveFromBorrow, body, { user: counterfeit })).statusCode, 409);
    });
    for (const claim of ['service', 'iss', 'aud']) await t.test(`reserved service actor without matching signed ${claim} cannot delegate recovery`, async () => {
      const body = reserveBody();
      assert.equal((await invoke(reserveFromBorrow, body)).statusCode, 201);
      const wrongPrincipal = { ...borrowService, [claim]: 'unrelated-service' };
      assert.equal((await invoke(reserveFromBorrow, body, { user: wrongPrincipal })).statusCode, 409);
    });
    await t.test('concurrent identical reserve creates one hold and replays the winner', async () => {
      const body = reserveBody();
      const results = await Promise.all([invoke(reserveFromBorrow, body), invoke(reserveFromBorrow, body)]);
      assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 201]);
      assert.equal(results[0].body.data.id, results[1].body.data.id);
      assert.equal(await prisma.stock_reservations.count({ where: { source_reference_id: body.reservation_id } }), 1);
    });
    await t.test('concurrent changed reserve payload conflicts while committing one hold only', async () => {
      const body = reserveBody();
      const results = await Promise.all([invoke(reserveFromBorrow, body), invoke(reserveFromBorrow, { ...body, quantity: 3 })]);
      assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409]);
      assert.equal(await prisma.stock_reservations.count({ where: { source_reference_id: body.reservation_id } }), 1);
    });
    await t.test('same external reservation cannot be rebound to a second key', async () => {
      const body = reserveBody();
      assert.equal((await invoke(reserveFromBorrow, body)).statusCode, 201);
      assert.equal((await invoke(reserveFromBorrow, { ...body, idempotency_key: `FP-${randomUUID()}` })).statusCode, 409);
      assert.equal(await prisma.stock_reservations.count({ where: { source_reference_id: body.reservation_id } }), 1);
    });
    await t.test('released reservation original-key replay stays terminal and never holds stock again', async () => {
      const body = reserveBody();
      assert.equal((await invoke(reserveFromBorrow, body)).statusCode, 201);
      assert.equal((await invoke(releaseBorrowReservation, { reservation_id: body.reservation_id, reason: 'CANCELLED', idempotency_key: `FP-${randomUUID()}` })).statusCode, 200);
      const replay = await invoke(reserveFromBorrow, body);
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.data.status, 'CANCELLED');
      assert.equal(await prisma.stock_reservations.count({ where: { source_reference_id: body.reservation_id, status: 'ACTIVE' } }), 0);
    });
    await t.test('legacy reserve with no immutable caller/channel identity requires explicit reconciliation', async () => {
      const body = reserveBody();
      assert.equal((await invoke(reserveFromBorrow, body)).statusCode, 201);
      const movement = await prisma.stock_movements.findUnique({ where: { idempotency_key: body.idempotency_key } });
      await prisma.stock_movements.update({ where: { id: movement.id }, data: { metadata: { reservation_number: body.reservation_number, customer_id: body.customer_id } } });
      const before = await prisma.stock_balances.findMany({ where: { warehouse_id: wh.id }, orderBy: { id: 'asc' } });
      const replay = await invoke(reserveFromBorrow, body);
      assert.equal(replay.statusCode, 409);
      assert.equal(replay.body.code, 'LEGACY_RESERVE_RECONCILIATION_REQUIRED');
      assert.deepEqual(await prisma.stock_balances.findMany({ where: { warehouse_id: wh.id }, orderBy: { id: 'asc' } }), before);
    });
    await t.test('concurrent identical GRN request creates one receipt and replays the winner', async () => {
      const f = await receiptFixture(false);
      const results = await Promise.all([0, 1].map(() => invoke(createGoodsReceiptFromInvoice, f.body, { id: f.delivery.id, key: f.key })));
      assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 201]);
      assert.equal(results[0].body.data.id, results[1].body.data.id);
    });
    await t.test('concurrent same-key GRN changed cost returns conflict rather than a server error', async () => {
      const f = await receiptFixture(false);
      const changed = { ...f.body, items: f.body.items.map(line => ({ ...line, unit_cost: 6 })) };
      const results = await Promise.all([f.body, changed].map(body => invoke(createGoodsReceiptFromInvoice, body, { id: f.delivery.id, key: f.key })));
      assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409]);
      assert.equal(await prisma.goods_receipts.count({ where: { supplier_delivery_invoice_id: f.delivery.id } }), 1);
    });
    await t.test('GRN exact replay accepts item reordering and numeric normalization', async () => {
      const f = await receiptFixture();
      const body = { ...f.body, items: [...f.body.items].reverse().map(line => ({ ...line, delivered_qty: '10', unit_cost: '5.00' })) };
      const replay = await invoke(createGoodsReceiptFromInvoice, body, { id: f.delivery.id, key: f.key });
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.data.id, f.receipt.id);
    });
    await t.test('GRN omitted cost resolves the real Prisma Decimal invoice default consistently', async () => {
      const f = await receiptFixture(false);
      const body = { ...f.body, items: f.body.items.map(({ unit_cost, ...line }) => line) };
      const first = await invoke(createGoodsReceiptFromInvoice, body, { id: f.delivery.id, key: f.key });
      assert.equal(first.statusCode, 201, JSON.stringify(first.body));
      const replay = await invoke(createGoodsReceiptFromInvoice, f.body, { id: f.delivery.id, key: f.key });
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.data.id, first.body.data.id);
    });
    const receiptChanges = {
      actor: f => ({ body: f.body, user: { ...actor, id: randomUUID() } }),
      delivered: f => ({ body: { ...f.body, items: f.body.items.map((line, i) => i ? line : { ...line, delivered_qty: 9 }) } }),
      damaged: f => ({ body: { ...f.body, items: f.body.items.map((line, i) => i ? line : { ...line, damaged_qty: 2 }) } }),
      rejected: f => ({ body: { ...f.body, items: f.body.items.map((line, i) => i ? line : { ...line, rejected_qty: 2 }) } }),
      cost: f => ({ body: { ...f.body, items: f.body.items.map((line, i) => i ? line : { ...line, unit_cost: 6 }) } }),
      item: f => ({ body: { ...f.body, items: f.body.items.slice(0, 1) } }),
      note: f => ({ body: { ...f.body, note: 'Changed request note' } }),
    };
    for (const [field, change] of Object.entries(receiptChanges)) await t.test(`GRN same key changed ${field} conflicts without editing stored receipt`, async () => {
      const f = await receiptFixture();
      const before = await prisma.goods_receipt_items.findMany({ where: { goods_receipt_id: f.receipt.id }, orderBy: { id: 'asc' } });
      const changed = change(f);
      const replay = await invoke(createGoodsReceiptFromInvoice, changed.body, { id: f.delivery.id, key: f.key, user: changed.user || actor });
      assert.equal(replay.statusCode, 409);
      assert.deepEqual(await prisma.goods_receipt_items.findMany({ where: { goods_receipt_id: f.receipt.id }, orderBy: { id: 'asc' } }), before);
      assert.equal(await prisma.goods_receipts.count({ where: { supplier_delivery_invoice_id: f.delivery.id } }), 1);
    });
    await t.test('GRN replay binds original create payload even after a later draft count edit', async () => {
      const f = await receiptFixture();
      await prisma.goods_receipt_items.updateMany({ where: { goods_receipt_id: f.receipt.id }, data: { actual_quantity: 8, damaged_qty: 2 } });
      const replay = await invoke(createGoodsReceiptFromInvoice, f.body, { id: f.delivery.id, key: f.key });
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.data.id, f.receipt.id);
    });
    await t.test('legacy GRN without immutable creation identity cannot infer it from mutable receipt items', async () => {
      const f = await receiptFixture();
      const creation = await prisma.inventory_audit_logs.findFirst({ where: { entity_id: f.receipt.id, action_name: 'GOODS_RECEIPT_CREATED_FROM_SUPPLIER_INVOICE' } });
      const { request_identity, ...legacyData } = creation.after_data;
      await prisma.inventory_audit_logs.update({ where: { id: creation.id }, data: { after_data: legacyData } });
      const replay = await invoke(createGoodsReceiptFromInvoice, f.body, { id: f.delivery.id, key: f.key });
      assert.equal(replay.statusCode, 409);
      assert.equal(replay.body.code, 'LEGACY_RECEIPT_RECONCILIATION_REQUIRED');
    });
  } finally { await prisma.$disconnect(); }
});
