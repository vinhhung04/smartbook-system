const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const url = process.env.INVENTORY_AUDIT_TEST_DATABASE_URL;

// Opt-in, append-only PostgreSQL regressions. Each scenario owns fresh fixtures;
// neither the service database nor pre-existing audit data is removed or reset.
test('PRA02/03: receipt entrypoints preserve delivery uniqueness and transfer custody', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && /^\/inventory_audit[a-z_]*$/.test(target.pathname));
  process.env.DATABASE_URL = url;
  const { PrismaClient } = process.env.INVENTORY_AUDIT_PRISMA_CLIENT
    ? require(process.env.INVENTORY_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  const prisma = new PrismaClient();
  const prismaPath = require.resolve('../src/lib/prisma');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma } };
  const emitterPath = require.resolve('../src/lib/socket-emitter');
  require.cache[emitterPath] = { id: emitterPath, filename: emitterPath, loaded: true, exports: { pushToRooms: async () => {} } };
  require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({ canWrite: async () => true });
  const { createGoodsReceipt, updateGoodsReceipt } = require('../src/controllers/goods-receipt.controller');
  const { createGoodsReceiptFromInvoice } = require('../src/controllers/supplier-delivery.controller');
  const { confirmTransferReceiving } = require('../src/controllers/transfer-receiving.controller');
  const actor = { id: randomUUID(), is_superuser: true, roles: ['MANAGER'] };
  async function invoke(fn, id, body = {}, key = randomUUID()) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      await fn({ params: { id }, body, user: actor, headers: { 'idempotency-key': key }, get: () => key }, res);
      if (res.body?.code !== 'CONCURRENCY_CONFLICT' || attempt === 3) return res;
    }
  }
  const warehouse = () => prisma.warehouses.create({ data: { code: `RI-${randomUUID().slice(0, 12)}`, name: 'Receipt entrypoint audit' } });
  const [source, destination] = await Promise.all([warehouse(), warehouse()]);
  const book = await prisma.books.create({ data: { title: `Receipt entrypoint audit ${randomUUID()}` } });
  const variant = () => prisma.book_variants.create({ data: { book_id: book.id, sku: `RI-${randomUUID()}` } });
  async function procurementFixture() {
    const v = await variant();
    const supplier = await prisma.suppliers.create({ data: { code: `RI-${randomUUID().slice(0, 12)}`, name: `Receipt supplier ${randomUUID()}` } });
    const po = await prisma.purchase_orders.create({ data: {
      po_number: `RI-${randomUUID()}`, supplier_id: supplier.id, warehouse_id: destination.id,
      ordered_by_user_id: actor.id, status: 'SUPPLIER_CONFIRMED', supplier_response_status: 'ACCEPTED',
      purchase_order_items: { create: { variant_id: v.id, ordered_qty: 100 } },
    }, include: { purchase_order_items: true } });
    const delivery = () => prisma.supplier_delivery_invoices.create({ data: {
      purchase_order_id: po.id, supplier_id: supplier.id, invoice_number: `RI-${randomUUID()}`, created_by_user_id: actor.id,
      supplier_delivery_invoice_items: { create: { purchase_order_item_id: po.purchase_order_items[0].id, variant_id: v.id, invoiced_qty: 10, unit_cost: 1 } },
    }, include: { supplier_delivery_invoice_items: true } });
    const dn = await delivery();
    const generic = (invoice = dn, byNumber = false) => invoke(createGoodsReceipt, undefined, {
      warehouse_id: destination.id, purchase_order_id: po.id,
      ...(byNumber ? { invoice_number: invoice.invoice_number } : { supplier_delivery_invoice_id: invoice.id }),
      items: [{ variant_id: v.id, quantity: 10, unit_cost: 1 }],
    });
    const specialized = (invoice = dn) => invoke(createGoodsReceiptFromInvoice, invoice.id, {
      warehouse_id: destination.id, items: [{ invoice_item_id: invoice.supplier_delivery_invoice_items[0].id, delivered_qty: 10 }],
    });
    return { v, po, dn, delivery, generic, specialized };
  }
  const activeCount = dn => prisma.goods_receipts.count({ where: { supplier_delivery_invoice_id: dn.id, status: { not: 'CANCELLED' } } });
  const balances = v => prisma.stock_balances.findMany({ where: { variant_id: v.id, warehouse_id: destination.id } });
  const custody = rows => rows.reduce((sum, row) => sum + row.on_hand_qty, 0);
  async function transferFixture() {
    const v = await variant();
    const order = await prisma.transfer_orders.create({ data: {
      transfer_number: `RI-${randomUUID()}`, from_warehouse_id: source.id, to_warehouse_id: destination.id,
      requested_by_user_id: actor.id, received_by_user_id: actor.id, status: 'IN_TRANSIT',
      transfer_order_items: { create: { variant_id: v.id, quantity: 10, shipped_qty: 10 } },
    }, include: { transfer_order_items: true } });
    const receipt = await prisma.goods_receipts.create({ data: {
      receipt_number: `RI-${randomUUID()}`, warehouse_id: destination.id, source_type: 'TRANSFER', source_reference_id: order.id,
      status: 'DRAFT', received_by_user_id: actor.id, goods_receipt_items: { create: { variant_id: v.id, quantity: 10, unit_cost: 1 } },
    }, include: { goods_receipt_items: true } });
    const counted = { items: [{ transfer_order_item_id: order.transfer_order_items[0].id, delivered_qty: 10, damaged_qty: 2, rejected_qty: 0 }] };
    return { v, order, receipt, counted };
  }
  try {
    await t.test('PRA02: generic delivery-ID and invoice-number routes cannot create a second active receipt', async () => {
      const f = await procurementFixture();
      assert.equal((await f.generic()).statusCode, 201);
      const duplicate = await f.generic(f.dn, true);
      assert.equal(duplicate.statusCode, 409, 'same physical delivery must be rejected through invoice-number lookup too');
      assert.equal(await activeCount(f.dn), 1);
    });
    await t.test('PRA02: specialized receipt followed by generic creation cannot bypass the delivery guard', async () => {
      const f = await procurementFixture();
      assert.equal((await f.specialized()).statusCode, 201);
      assert.equal((await f.generic()).statusCode, 409);
      assert.equal(await activeCount(f.dn), 1);
    });
    await t.test('PRA02: simultaneous generic creations admit one receipt for one delivery', async () => {
      const f = await procurementFixture();
      const results = await Promise.all([f.generic(), f.generic(f.dn, true)]);
      assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 409]);
      assert.equal(await activeCount(f.dn), 1);
    });
    await t.test('PRA02: simultaneous specialized and generic creation share the delivery guard', async () => {
      const f = await procurementFixture();
      const results = await Promise.all([f.specialized(), f.generic()]);
      assert.deepEqual(results.map(r => r.statusCode).sort(), [201, 409]);
      assert.equal(await activeCount(f.dn), 1);
    });
    await t.test('PRA02: different partial deliveries remain receivable and cancelled receipts can be replaced', async () => {
      const f = await procurementFixture();
      const second = await f.delivery();
      const firstReceipt = await f.generic();
      assert.equal(firstReceipt.statusCode, 201);
      assert.equal((await invoke(updateGoodsReceipt, firstReceipt.body.data.id, { status: 'POSTED' })).statusCode, 200);
      const secondReceipt = await f.generic(second);
      assert.equal(secondReceipt.statusCode, 201);
      assert.equal((await invoke(updateGoodsReceipt, secondReceipt.body.data.id, { status: 'CANCELLED' })).statusCode, 200);
      assert.equal(custody(await balances(f.v)), 10);
      const replacement = await f.generic(second);
      assert.equal(replacement.statusCode, 201);
      assert.equal(await activeCount(second), 1);
      assert.equal((await invoke(updateGoodsReceipt, replacement.body.data.id, { status: 'POSTED' })).statusCode, 200);
      assert.equal(custody(await balances(f.v)), 20);
      assert.equal((await prisma.purchase_order_items.findUnique({ where: { id: f.po.purchase_order_items[0].id } })).received_qty, 20);
    });
    await t.test('PRA02: historical duplicate active drafts cannot be posted into duplicate stock', async () => {
      const f = await procurementFixture();
      const first = await f.generic();
      const duplicate = await prisma.goods_receipts.create({ data: {
        receipt_number: `RI-${randomUUID()}`, warehouse_id: destination.id, purchase_order_id: f.po.id,
        supplier_delivery_invoice_id: f.dn.id, source_type: 'SUPPLIER_INVOICE', source_reference_id: f.dn.id,
        status: 'DRAFT', goods_receipt_items: { create: { variant_id: f.v.id, quantity: 10, unit_cost: 1 } },
      } });
      const responses = await Promise.all([first.body.data.id, duplicate.id].map(id => invoke(updateGoodsReceipt, id, { status: 'POSTED' })));
      assert.deepEqual(responses.map(r => r.statusCode), [409, 409]);
      assert.equal(custody(await balances(f.v)), 0);
      assert.equal(await activeCount(f.dn), 2, 'historical records remain for explicit operator reconciliation');
    });
    await t.test('PRA02: posted receipt in receiving hold can be cancelled and recreated without duplicate stock', async () => {
      const f = await procurementFixture();
      const first = await f.generic();
      assert.equal((await invoke(updateGoodsReceipt, first.body.data.id, { status: 'POSTED' })).statusCode, 200);
      const cancelled = await invoke(updateGoodsReceipt, first.body.data.id, { status: 'CANCELLED' });
      assert.equal(cancelled.statusCode, 200, JSON.stringify(cancelled.body));
      assert.equal(custody(await balances(f.v)), 0);
      assert.equal((await prisma.purchase_order_items.findUnique({ where: { id: f.po.purchase_order_items[0].id } })).received_qty, 0);
      const replacement = await f.generic();
      assert.equal(replacement.statusCode, 201);
      assert.equal((await invoke(updateGoodsReceipt, replacement.body.data.id, { status: 'POSTED' })).statusCode, 200);
      assert.equal(custody(await balances(f.v)), 10);
    });
    await t.test('PRA02: concurrent posting retry and cancellation cannot resurrect a cancelled receipt', async () => {
      const f = await procurementFixture();
      const receipt = await f.generic();
      assert.equal((await invoke(updateGoodsReceipt, receipt.body.data.id, { status: 'POSTED' })).statusCode, 200);
      const [replay, cancellation] = await Promise.all([
        invoke(updateGoodsReceipt, receipt.body.data.id, { status: 'POSTED' }),
        invoke(updateGoodsReceipt, receipt.body.data.id, { status: 'CANCELLED' }),
      ]);
      assert.ok([200, 400].includes(replay.statusCode));
      assert.equal(cancellation.statusCode, 200);
      assert.equal((await prisma.goods_receipts.findUnique({ where: { id: receipt.body.data.id } })).status, 'CANCELLED');
      assert.equal(custody(await balances(f.v)), 0);
    });
    await t.test('PRA03: generic transfer posting completes the transfer atomically', async () => {
      const f = await transferFixture();
      assert.equal((await invoke(updateGoodsReceipt, f.receipt.id, { status: 'POSTED' })).statusCode, 200);
      assert.equal((await prisma.transfer_orders.findUnique({ where: { id: f.order.id } })).status, 'RECEIVED');
      assert.equal((await prisma.transfer_order_items.findUnique({ where: { id: f.order.transfer_order_items[0].id } })).received_qty, 10);
      assert.equal(custody(await balances(f.v)), 10);
    });
    await t.test('PRA03: dedicated confirmation after generic posting cannot add damaged custody again', async () => {
      const f = await transferFixture();
      assert.equal((await invoke(updateGoodsReceipt, f.receipt.id, { status: 'POSTED' })).statusCode, 200);
      const result = await invoke(confirmTransferReceiving, f.order.id, f.counted);
      assert.equal(result.statusCode, 200);
      assert.equal(custody(await balances(f.v)), 10, 'retry must preserve the already committed full receipt, not add two damaged copies');
      assert.equal(await prisma.transfer_discrepancies.count({ where: { transfer_order_id: f.order.id } }), 0);
      assert.equal((await prisma.transfer_order_items.findUnique({ where: { id: f.order.transfer_order_items[0].id } })).received_qty, 10);
    });
    await t.test('PRA03: generic transfer counts split eight accepted and two damaged before stock posting', async () => {
      const f = await transferFixture();
      const response = await invoke(updateGoodsReceipt, f.receipt.id, { status: 'POSTED', items: [{
        id: f.receipt.goods_receipt_items[0].id, actual_quantity: 10, damaged_qty: 2, rejected_qty: 0,
      }] });
      assert.equal(response.statusCode, 200);
      const rows = await balances(f.v);
      assert.equal(custody(rows), 10);
      assert.equal(rows.reduce((sum, row) => sum + row.damaged_qty, 0), 2);
      assert.equal((await prisma.transfer_order_items.findUnique({ where: { id: f.order.transfer_order_items[0].id } })).received_qty, 8);
      assert.equal(await prisma.transfer_discrepancies.count({ where: { transfer_order_id: f.order.id } }), 1);
      assert.equal((await invoke(confirmTransferReceiving, f.order.id, f.counted)).statusCode, 200);
      assert.equal(custody(await balances(f.v)), 10);
    });
    await t.test('PRA03: concurrent generic posting and dedicated confirmation settle one counted outcome', async () => {
      const f = await transferFixture();
      const results = await Promise.all([
        invoke(updateGoodsReceipt, f.receipt.id, { status: 'POSTED', items: [{
          id: f.receipt.goods_receipt_items[0].id, actual_quantity: 10, damaged_qty: 2, rejected_qty: 0,
        }] }),
        invoke(confirmTransferReceiving, f.order.id, f.counted),
      ]);
      assert.deepEqual(results.map(r => r.statusCode), [200, 200]);
      assert.equal(custody(await balances(f.v)), 10);
      assert.equal((await prisma.transfer_orders.findUnique({ where: { id: f.order.id } })).status, 'RECEIVED');
      assert.equal((await prisma.transfer_order_items.findUnique({ where: { id: f.order.transfer_order_items[0].id } })).received_qty, 8);
      assert.equal(await prisma.transfer_discrepancies.count({ where: { transfer_order_id: f.order.id } }), 1);
      assert.equal((await invoke(confirmTransferReceiving, f.order.id, f.counted)).statusCode, 200);
      assert.equal(custody(await balances(f.v)), 10);
    });
    await t.test('PRA03: legacy posted full receipt reconciles transfer state without applying new damage counts', async () => {
      const f = await transferFixture();
      const { postTransferReceiptToReceiving } = require('../src/services/transfer-receipt-stock.service');
      await prisma.$transaction(async tx => {
        await tx.goods_receipts.update({ where: { id: f.receipt.id }, data: { status: 'POSTED' } });
        await postTransferReceiptToReceiving(tx, f.receipt, actor.id);
      });
      assert.equal((await invoke(confirmTransferReceiving, f.order.id, f.counted)).statusCode, 200);
      assert.equal(custody(await balances(f.v)), 10);
      assert.equal((await prisma.transfer_order_items.findUnique({ where: { id: f.order.transfer_order_items[0].id } })).received_qty, 10);
      assert.equal(await prisma.transfer_discrepancies.count({ where: { transfer_order_id: f.order.id } }), 0);
    });
    await t.test('PRA03: ambiguous legacy posted counts require reconciliation without changing stock', async () => {
      const f = await transferFixture();
      const { postTransferReceiptToReceiving } = require('../src/services/transfer-receipt-stock.service');
      await prisma.$transaction(async tx => {
        await tx.goods_receipts.update({ where: { id: f.receipt.id }, data: { status: 'POSTED' } });
        await tx.goods_receipt_items.update({ where: { id: f.receipt.goods_receipt_items[0].id }, data: { damaged_qty: 2 } });
        await postTransferReceiptToReceiving(tx, f.receipt, actor.id);
      });
      assert.equal((await invoke(confirmTransferReceiving, f.order.id, f.counted)).statusCode, 409);
      assert.equal(custody(await balances(f.v)), 10);
      assert.equal((await prisma.transfer_orders.findUnique({ where: { id: f.order.id } })).status, 'IN_TRANSIT');
      assert.equal(await prisma.transfer_discrepancies.count({ where: { transfer_order_id: f.order.id } }), 0);
    });
    await t.test('PRA03: cancelling a full transfer receipt restores the receiving task and retry creates one active receipt', async () => {
      const f = await transferFixture();
      assert.equal((await invoke(updateGoodsReceipt, f.receipt.id, { status: 'POSTED' })).statusCode, 200);
      assert.equal((await invoke(updateGoodsReceipt, f.receipt.id, { status: 'CANCELLED' })).statusCode, 200);
      assert.equal(custody(await balances(f.v)), 0);
      assert.equal((await prisma.transfer_orders.findUnique({ where: { id: f.order.id } })).status, 'IN_TRANSIT');
      assert.equal((await invoke(confirmTransferReceiving, f.order.id)).statusCode, 200);
      const replay = await invoke(confirmTransferReceiving, f.order.id);
      assert.equal(replay.statusCode, 200);
      assert.notEqual(replay.body.data.goods_receipt_id, f.receipt.id);
      assert.equal(custody(await balances(f.v)), 10);
      assert.equal(await prisma.goods_receipts.count({ where: { source_type: 'TRANSFER', source_reference_id: f.order.id, status: 'POSTED' } }), 1);
    });
    await t.test('PRA03: generic counting across duplicate variant lines preserves accepted and damaged totals', async () => {
      const f = await transferFixture();
      await prisma.transfer_order_items.update({ where: { id: f.order.transfer_order_items[0].id }, data: { quantity: 4, shipped_qty: 4 } });
      await prisma.transfer_order_items.create({ data: { transfer_order_id: f.order.id, variant_id: f.v.id, quantity: 6, shipped_qty: 6 } });
      await prisma.goods_receipt_items.update({ where: { id: f.receipt.goods_receipt_items[0].id }, data: { quantity: 4, actual_quantity: 4 } });
      await prisma.goods_receipt_items.create({ data: { goods_receipt_id: f.receipt.id, variant_id: f.v.id, quantity: 6, actual_quantity: 6, damaged_qty: 2 } });
      assert.equal((await invoke(updateGoodsReceipt, f.receipt.id, { status: 'POSTED' })).statusCode, 200);
      assert.equal(custody(await balances(f.v)), 10);
      const lines = await prisma.transfer_order_items.findMany({ where: { transfer_order_id: f.order.id } });
      assert.equal(lines.reduce((sum, line) => sum + line.received_qty, 0), 8);
      assert.equal((await balances(f.v)).reduce((sum, row) => sum + row.damaged_qty, 0), 2);
      assert.equal(await prisma.goods_receipt_items.count({ where: { goods_receipt_id: f.receipt.id } }), 2, 'counting retains historical item rows');
    });
    await t.test('PRA03: invalid generic counted outcome rolls back counts, receipt, transfer and stock', async () => {
      const f = await transferFixture();
      const result = await invoke(updateGoodsReceipt, f.receipt.id, { status: 'POSTED', items: [{
        id: f.receipt.goods_receipt_items[0].id, actual_quantity: 10, damaged_qty: 11,
      }] });
      assert.equal(result.statusCode, 400);
      assert.equal((await prisma.goods_receipts.findUnique({ where: { id: f.receipt.id } })).status, 'DRAFT');
      const item = await prisma.goods_receipt_items.findUnique({ where: { id: f.receipt.goods_receipt_items[0].id } });
      assert.equal(item.actual_quantity, null);
      assert.equal(item.damaged_qty, 0);
      assert.equal((await prisma.transfer_orders.findUnique({ where: { id: f.order.id } })).status, 'IN_TRANSIT');
      assert.equal(custody(await balances(f.v)), 0);
      assert.equal(await prisma.transfer_discrepancies.count({ where: { transfer_order_id: f.order.id } }), 0);
    });
    await t.test('PRA03: generic posting emits one receipt event and one accepted-stock delta across retries', async () => {
      const f = await transferFixture();
      assert.equal((await invoke(updateGoodsReceipt, f.receipt.id, { status: 'POSTED' })).statusCode, 200);
      assert.equal((await invoke(updateGoodsReceipt, f.receipt.id, { status: 'POSTED' })).statusCode, 200);
      assert.equal((await invoke(confirmTransferReceiving, f.order.id)).statusCode, 200);
      assert.equal(await prisma.integration_outbox.count({ where: { aggregate_id: f.receipt.id, event_type: 'goods_receipt.posted' } }), 1);
      const events = await prisma.integration_outbox.findMany({ where: { aggregate_id: f.v.id, event_type: 'inventory.stock.changed' } });
      assert.equal(events.length, 1);
      assert.equal(events[0].payload.delta_qty, 10);
    });
    await t.test('PRA03: dedicated receive-in-full normalizes stale draft counts to the selected full outcome', async () => {
      const f = await transferFixture();
      await prisma.goods_receipt_items.update({ where: { id: f.receipt.goods_receipt_items[0].id }, data: {
        quantity: 8, actual_quantity: 10, delivered_qty: 10, damaged_qty: 2,
      } });
      assert.equal((await invoke(confirmTransferReceiving, f.order.id)).statusCode, 200);
      assert.equal(custody(await balances(f.v)), 10);
      assert.equal((await prisma.transfer_order_items.findUnique({ where: { id: f.order.transfer_order_items[0].id } })).received_qty, 10);
      const item = await prisma.goods_receipt_items.findUnique({ where: { id: f.receipt.goods_receipt_items[0].id } });
      assert.equal(item.quantity, 10);
      assert.equal(item.damaged_qty, 0);
      assert.equal(await prisma.transfer_discrepancies.count({ where: { transfer_order_id: f.order.id } }), 0);
    });
  } finally {
    await prisma.$disconnect();
  }
});
