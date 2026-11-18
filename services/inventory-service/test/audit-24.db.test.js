// Opt-in PostgreSQL verification; use a migrated, disposable inventory_audit* DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.INVENTORY_AUDIT_TEST_DATABASE_URL;

test('SmartBook audit: migrated PostgreSQL business invariants', { skip: !url }, async (t) => {
  const target = new URL(url);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && /^\/inventory_audit[a-z_]*$/.test(target.pathname), 'use an isolated audit database');
  process.env.DATABASE_URL = url;
  const prismaModule = require.resolve('../src/lib/prisma');
  if (process.env.INVENTORY_AUDIT_PRISMA_CLIENT) {
    const { PrismaClient } = require(process.env.INVENTORY_AUDIT_PRISMA_CLIENT);
    require.cache[prismaModule] = { id: prismaModule, filename: prismaModule, loaded: true, exports: { prisma: new PrismaClient() } };
  }
  const { prisma } = require('../src/lib/prisma');
  const docs = require('../src/services/procurement-document.service');
  const { releaseBorrowReservation, consumeBorrowReservation, returnBorrowedLoan } = require('../src/controllers/borrow-integration.controller');
  try {
    const tag = randomUUID().slice(0, 8);
    const actor = { party: 'SUPPLIER', role: 'SUPPLIER', userId: randomUUID() };
    const wh = await prisma.warehouses.create({ data: { code: `AUD-${tag}`, name: 'Audit warehouse' } });
    const book = await prisma.books.create({ data: { title: `Audit ${tag}` } });
    const variant = await prisma.book_variants.create({ data: { book_id: book.id, sku: `AUD-${tag}` } });
    const suppliers = await Promise.all([1, 2].map((n) => prisma.suppliers.create({ data: { code: `AUD-${tag}-${n}`, name: `Audit supplier ${tag}-${n}` } })));
    const orders = [];
    for (const supplier of suppliers) orders.push(await prisma.purchase_orders.create({ data: { po_number: `AUD-${randomUUID().slice(0, 8)}`, supplier_id: supplier.id, warehouse_id: wh.id, ordered_by_user_id: actor.userId, purchase_order_items: { create: { variant_id: variant.id, ordered_qty: 10 } } }, include: { purchase_order_items: true } }));
    const body = (po, extra = {}) => ({ document_type: 'VAT_INVOICE', external_number: `Ab-${tag}`, invoice_series: 'AUD', issue_date: '2026-11-17', lines: [{ purchase_order_item_id: po.purchase_order_items[0].id, quantity: 1, unit_price: 10 }], ...extra });
    await t.test('SB-17: deployed partial unique index exists and both concurrent service calls hit it', async () => {
      const indexes = await prisma.$queryRaw`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_procurement_documents_live_invoice_number'`;
      assert.equal(indexes.length, 1);
      assert.match(indexes[0].indexdef, /lower\(\(external_number\)::text\)/i);
      let reads = 0; let release;
      const gate = new Promise((r) => { release = r; });
      const concurrentDb = { procurement_documents: { findMany: async (args) => { const rows = await prisma.procurement_documents.findMany(args); if (++reads === 2) release(); await gate; return rows; } }, $transaction: prisma.$transaction.bind(prisma) };
      const results = await Promise.allSettled([body(orders[0]), body(orders[0], { external_number: `aB-${tag}` })].map((b) => docs.createDocument(concurrentDb, { actor, po: orders[0], body: b })));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.find((r) => r.status === 'rejected').reason.statusCode, 409);
    });
    await t.test('SB-17: supplier, series and CANCELLED semantics preserve legitimate invoices', async () => {
      await docs.createDocument(prisma, { actor, po: orders[1], body: body(orders[1]) });
      await docs.createDocument(prisma, { actor, po: orders[0], body: body(orders[0], { invoice_series: 'OTHER' }) });
      const old = await prisma.procurement_documents.findFirst({ where: { supplier_id: suppliers[0].id, invoice_series: 'AUD' } });
      await prisma.procurement_documents.update({ where: { id: old.id }, data: { status: 'CANCELLED' } });
      await docs.createDocument(prisma, { actor, po: orders[0], body: body(orders[0]) });
      assert.equal(await prisma.procurement_documents.count({ where: { supplier_id: suppliers[0].id, invoice_series: 'AUD', status: { not: 'CANCELLED' } } }), 1);
    });

    async function request(fn, body) {
      const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
      await fn({ body, user: { id: actor.userId } }, res); return res;
    }
    let receiptRequest, receiptLines;
    await t.test('SB-16: incomplete count is refused and an explicit zero creates a shortage outcome', async () => {
      await prisma.purchase_orders.update({ where: { id: orders[0].id }, data: { status: 'SUPPLIER_CONFIRMED' } });
      const second = await prisma.book_variants.create({ data: { book_id: book.id, sku: `AUD-${randomUUID().slice(0, 8)}` } });
      const secondItem = await prisma.purchase_order_items.create({ data: { purchase_order_id: orders[0].id, variant_id: second.id, ordered_qty: 10 } });
      const delivery = await prisma.supplier_delivery_invoices.create({ data: { purchase_order_id: orders[0].id, supplier_id: suppliers[0].id, invoice_number: `AUD-${tag}`, supplier_delivery_invoice_items: { create: [{ purchase_order_item_id: orders[0].purchase_order_items[0].id, variant_id: variant.id, invoiced_qty: 10 }, { purchase_order_item_id: secondItem.id, variant_id: second.id, invoiced_qty: 10 }] } }, include: { supplier_delivery_invoice_items: true } });
      require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({ canWrite: async (user, warehouseId) => user.id === actor.userId && warehouseId === wh.id });
      const { createGoodsReceiptFromInvoice } = require('../src/controllers/supplier-delivery.controller');
      receiptRequest = async (items, userId = actor.userId) => {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
        await createGoodsReceiptFromInvoice({ params: { id: delivery.id }, body: { warehouse_id: wh.id, items }, user: { id: userId }, get: () => `audit-receipt-${tag}` }, res); return res;
      };
      const lines = delivery.supplier_delivery_invoice_items.map((item) => ({ invoice_item_id: item.id, delivered_qty: item.variant_id === variant.id ? 10 : 0 }));
      receiptLines = lines;
      assert.equal((await receiptRequest(lines.slice(0, 1))).statusCode, 400);
      const result = await receiptRequest(lines);
      assert.equal(result.statusCode, 201, JSON.stringify(result.body));
      const receipt = await prisma.goods_receipts.findUnique({ where: { id: result.body.data.id } });
      const { settleSupplierReceiptQuantities, recordSupplierReceiptOutcome } = require('../src/services/procurement-receipt.service');
      const outcomes = await prisma.$transaction(async (tx) => {
        const outcomes = await settleSupplierReceiptQuantities(tx, receipt);
        await recordSupplierReceiptOutcome(tx, receipt, outcomes, actor.userId);
        return outcomes;
      });
      assert.equal(outcomes.length, 2);
      assert.equal(outcomes.find((o) => o.variant_id === second.id).missing, 10);
      assert.equal(await prisma.supplier_shortage_report_items.count({ where: { variant_id: second.id, discrepancy_type: 'SHORTAGE', shortage_qty: 10 } }), 1);
    });
    await t.test('SB-24: replay checks the actual persisted document warehouse and actor', async () => {
      const replay = await receiptRequest([{ invoice_item_id: randomUUID(), delivered_qty: 1 }], randomUUID());
      assert.equal(replay.statusCode, 403);
      assert.equal(replay.body.data, undefined);
      assert.equal((await receiptRequest(receiptLines)).statusCode, 200);
      assert.equal((await receiptRequest([{ invoice_item_id: randomUUID(), delivered_qty: 1 }])).statusCode, 409);
    });
    await t.test('SB-08: simultaneous GRNs with distinct keys for one delivery create one draft', async () => {
      const po = await prisma.purchase_orders.create({ data: { po_number: `AUD-${randomUUID().slice(0, 8)}`, supplier_id: suppliers[0].id, warehouse_id: wh.id, ordered_by_user_id: actor.userId, status: 'SUPPLIER_CONFIRMED', purchase_order_items: { create: { variant_id: variant.id, ordered_qty: 10 } } }, include: { purchase_order_items: true } });
      const dn = await prisma.supplier_delivery_invoices.create({ data: { purchase_order_id: po.id, supplier_id: suppliers[0].id, invoice_number: `AUD-${randomUUID().slice(0, 8)}`, supplier_delivery_invoice_items: { create: { purchase_order_item_id: po.purchase_order_items[0].id, variant_id: variant.id, invoiced_qty: 5 } } }, include: { supplier_delivery_invoice_items: true } });
      const { createGoodsReceiptFromInvoice } = require('../src/controllers/supplier-delivery.controller');
      const responses = await Promise.all([1, 2].map(async () => {
        const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
        await createGoodsReceiptFromInvoice({ params: { id: dn.id }, body: { warehouse_id: wh.id, items: [{ invoice_item_id: dn.supplier_delivery_invoice_items[0].id, delivered_qty: 5 }] }, user: { id: actor.userId }, get: () => `audit-grn-${randomUUID()}` }, res); return res;
      }));
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409], JSON.stringify(responses));
      assert.equal(await prisma.goods_receipts.count({ where: { supplier_delivery_invoice_id: dn.id, status: { not: 'CANCELLED' } } }), 1);
    });
    await t.test('SB-09: concurrent delivery declarations share the remaining ordered quantity', async () => {
      const po = await prisma.purchase_orders.create({ data: { po_number: `AUD-${randomUUID().slice(0, 8)}`, supplier_id: suppliers[0].id, warehouse_id: wh.id, ordered_by_user_id: actor.userId, status: 'SUPPLIER_CONFIRMED', purchase_order_items: { create: { variant_id: variant.id, ordered_qty: 100 } } }, include: { purchase_order_items: true } });
      const { createSupplierDelivery } = require('../src/controllers/supplier-delivery.controller');
      const responses = await Promise.all([1, 2].map(async () => {
        const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
        await createSupplierDelivery({ body: { purchase_order_id: po.id, invoice_number: `AUD-${randomUUID().slice(0, 8)}`, items: [{ purchase_order_item_id: po.purchase_order_items[0].id, invoiced_qty: 80, unit_cost: 1 }] }, user: { id: actor.userId } }, res); return res;
      }));
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 400], JSON.stringify(responses));
      assert.equal((await prisma.supplier_delivery_invoice_items.aggregate({ where: { purchase_order_item_id: po.purchase_order_items[0].id }, _sum: { invoiced_qty: true } }))._sum.invoiced_qty, 80);
    });
    await t.test('SB-23: simultaneous inventory release/consume cannot spend another reservation stock', async () => {
      const loc = await prisma.locations.create({ data: { warehouse_id: wh.id, location_code: `AUD-${randomUUID().slice(0, 8)}` } });
      const v = await prisma.book_variants.create({ data: { book_id: book.id, sku: `AUD-${randomUUID().slice(0, 8)}` } });
      await prisma.stock_balances.create({ data: { warehouse_id: wh.id, variant_id: v.id, location_id: loc.id, on_hand_qty: 2, reserved_qty: 2 } });
      const reservations = [];
      for (let i = 0; i < 2; i++) reservations.push(await prisma.stock_reservations.create({ data: { reservation_code: `AUD-${randomUUID().slice(0, 8)}`, source_service: 'BORROW', source_reference_id: randomUUID(), warehouse_id: wh.id, variant_id: v.id, location_id: loc.id, quantity: 1, expires_at: new Date(Date.now() + 3600000) } }));
      const b = { reservation_id: reservations[0].source_reference_id, loan_id: randomUUID(), loan_number: `AUD-${tag}`, warehouse_id: wh.id };
      const results = await Promise.all([request(releaseBorrowReservation, { ...b, idempotency_key: `audit-release-${randomUUID()}` }), request(consumeBorrowReservation, { ...b, idempotency_key: `audit-consume-${randomUUID()}` })]);
      assert.equal(results.filter((r) => [200, 201].includes(r.statusCode)).length, 1, JSON.stringify(results));
      assert.equal(results.filter((r) => r.statusCode === 409).length, 1, JSON.stringify(results));
      const balance = await prisma.stock_balances.findUnique({ where: { variant_id_location_id: { variant_id: v.id, location_id: loc.id } } });
      assert.equal(balance.reserved_qty, 1);
      assert.equal((await prisma.stock_reservations.findUnique({ where: { id: reservations[1].id } })).status, 'ACTIVE');
      assert.equal(await prisma.stock_movements.count({ where: { variant_id: v.id } }), 1);
    });
    for (const [op, fn] of [['release', releaseBorrowReservation], ['consume', consumeBorrowReservation], ['return', returnBorrowedLoan]]) {
      await t.test(`SB-22 ${op}: real concurrent requests change stock once and conflicting replay is 409`, async () => {
        const loc = await prisma.locations.create({ data: { warehouse_id: wh.id, location_code: `AUD-${randomUUID().slice(0, 8)}` } });
        const v = await prisma.book_variants.create({ data: { book_id: book.id, sku: `AUD-${randomUUID().slice(0, 8)}` } });
        const reservationId = randomUUID();
        await prisma.stock_balances.create({ data: { warehouse_id: wh.id, variant_id: v.id, location_id: loc.id, on_hand_qty: 1, reserved_qty: op === 'return' ? 0 : 1, borrowed_qty: op === 'return' ? 1 : 0 } });
        await prisma.stock_reservations.create({ data: { reservation_code: `AUD-${randomUUID().slice(0, 8)}`, source_service: 'BORROW', source_reference_id: reservationId, warehouse_id: wh.id, variant_id: v.id, location_id: loc.id, quantity: 1, status: 'ACTIVE', expires_at: new Date(Date.now() + 3600000) } });
        const b = { reservation_id: reservationId, loan_id: randomUUID(), loan_number: `AUD-${tag}`, warehouse_id: wh.id, variant_id: v.id, quantity: 1, idempotency_key: `audit-${op}-${randomUUID()}` };
        const results = await Promise.all([request(fn, b), request(fn, b)]);
        assert.ok(results.every((r) => [200, 201].includes(r.statusCode)), JSON.stringify(results));
        assert.equal(await prisma.stock_movements.count({ where: { idempotency_key: b.idempotency_key } }), 1);
        const balance = await prisma.stock_balances.findUnique({ where: { variant_id_location_id: { variant_id: v.id, location_id: loc.id } } });
        assert.equal(balance.reserved_qty, 0);
        assert.equal(balance.available_qty, op === 'consume' ? 0 : 1);
        assert.equal(balance.borrowed_qty, op === 'consume' ? 1 : 0);
        const conflict = await request(fn, { ...b, ...(op === 'release' ? { reservation_id: randomUUID() } : { loan_id: randomUUID() }) });
        assert.equal(conflict.statusCode, 409);
      });
    }
    await t.test('SB-04: different keys cannot return the same loan item twice or consume another item stock', async () => {
      const loc = await prisma.locations.create({ data: { warehouse_id: wh.id, location_code: `AUD-${randomUUID().slice(0, 8)}` } });
      const v = await prisma.book_variants.create({ data: { book_id: book.id, sku: `AUD-${randomUUID().slice(0, 8)}` } });
      await prisma.stock_balances.create({ data: { warehouse_id: wh.id, variant_id: v.id, location_id: loc.id, on_hand_qty: 2, borrowed_qty: 2 } });
      const b = { loan_id: randomUUID(), loan_item_id: randomUUID(), warehouse_id: wh.id, variant_id: v.id, quantity: 1 };
      const responses = await Promise.all([1, 2].map(() => request(returnBorrowedLoan, { ...b, idempotency_key: `audit-item-return-${randomUUID()}` })));
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409], JSON.stringify(responses));
      const balance = await prisma.stock_balances.findUnique({ where: { variant_id_location_id: { variant_id: v.id, location_id: loc.id } } });
      assert.equal(balance.borrowed_qty, 1);
      assert.equal(balance.available_qty, 1);
      assert.equal((await request(returnBorrowedLoan, { ...b, mark_lost: true, idempotency_key: `audit-item-lost-${randomUUID()}` })).statusCode, 409);
      assert.equal((await request(returnBorrowedLoan, { ...b, loan_item_id: b.loan_item_id.toUpperCase(), idempotency_key: `audit-item-case-${randomUUID()}` })).statusCode, 409);
    });
    async function transferFixture(status) {
      const src = await prisma.warehouses.create({ data: { code: `AUD-${randomUUID().slice(0, 8)}`, name: 'Repick source' } });
      const dst = await prisma.warehouses.create({ data: { code: `AUD-${randomUUID().slice(0, 8)}`, name: 'Repick destination' } });
      const loc = await prisma.locations.create({ data: { warehouse_id: src.id, location_code: 'SHIPPING', location_type: 'SHIPPING' } });
      const v = await prisma.book_variants.create({ data: { book_id: book.id, sku: `AUD-${randomUUID().slice(0, 8)}` } });
      await prisma.stock_balances.create({ data: { warehouse_id: src.id, variant_id: v.id, location_id: loc.id, on_hand_qty: 9 } });
      const root = await prisma.transfer_orders.create({ data: { transfer_number: `AUD-${randomUUID().slice(0, 8)}`, from_warehouse_id: src.id, to_warehouse_id: dst.id, requested_by_user_id: actor.userId, status, transfer_order_items: { create: [{ variant_id: v.id, quantity: 4, shipped_qty: 2 }, { variant_id: v.id, quantity: 3, shipped_qty: 3 }] } } });
      await prisma.transfer_orders.create({ data: { transfer_number: `AUD-${randomUUID().slice(0, 8)}`, from_warehouse_id: src.id, to_warehouse_id: dst.id, requested_by_user_id: actor.userId, status: 'READY_FOR_OUTBOUND', note: `root_task_id=${root.id}`, transfer_order_items: { create: { variant_id: v.id, quantity: 2, shipped_qty: 2 } } } });
      return { root, src, dst, loc, v };
    }
    async function control(fn, params, body = {}) {
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
      await fn({ params, body, user: { id: actor.userId, roles: ['WAREHOUSE_MANAGER'] } }, res); return res;
    }
    await t.test('SB-10: outbound duplicate-variant root lines add the repick quantity once', async () => {
      const { root, loc, v } = await transferFixture('READY_FOR_OUTBOUND');
      const { confirmOutbound } = require('../src/controllers/outbound.controller');
      const response = await control(confirmOutbound, { taskType: 'transfer', taskId: root.id });
      assert.equal(response.statusCode, 200, JSON.stringify(response.body));
      const moves = await prisma.stock_movements.findMany({ where: { reference_type: 'TRANSFER_OUTBOUND', reference_id: root.id } });
      assert.equal(moves.reduce((sum, m) => sum + m.quantity, 0), 7);
      assert.equal((await prisma.stock_balances.findUnique({ where: { variant_id_location_id: { variant_id: v.id, location_id: loc.id } } })).on_hand_qty, 2);
      const receipt = await prisma.goods_receipts.findFirst({ where: { source_type: 'TRANSFER', source_reference_id: root.id }, include: { goods_receipt_items: true } });
      assert.equal(receipt.goods_receipt_items.reduce((sum, i) => sum + i.quantity, 0), 7);
    });
    await t.test('SB-11: receiving displays, counts and posts original plus repick shipped quantity', async () => {
      const { root, dst, v } = await transferFixture('IN_TRANSIT');
      await prisma.goods_receipts.create({ data: { receipt_number: `AUD-${randomUUID().slice(0, 8)}`, source_type: 'TRANSFER', source_reference_id: root.id, warehouse_id: dst.id, received_by_user_id: actor.userId, goods_receipt_items: { create: { variant_id: v.id, quantity: 7 } } } });
      const { getTransferReceivingLines, confirmTransferReceiving } = require('../src/controllers/transfer-receiving.controller');
      const lines = await control(getTransferReceivingLines, { id: root.id });
      assert.equal(lines.statusCode, 200);
      assert.equal(lines.body.data.items.reduce((sum, i) => sum + i.shipped_qty, 0), 7);
      const confirmed = await control(confirmTransferReceiving, { id: root.id }, { items: lines.body.data.items.map((i) => ({ transfer_order_item_id: i.transfer_order_item_id, delivered_qty: i.shipped_qty })) });
      assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
      assert.equal((await prisma.transfer_order_items.aggregate({ where: { transfer_order_id: root.id }, _sum: { received_qty: true } }))._sum.received_qty, 7);
      assert.equal((await prisma.stock_balances.aggregate({ where: { warehouse_id: dst.id, variant_id: v.id }, _sum: { on_hand_qty: true } }))._sum.on_hand_qty, 7);
    });
    await t.test('SB-11: legacy receive-in-full fallback includes repick without a draft GRN', async () => {
      const { root, dst, v } = await transferFixture('IN_TRANSIT');
      const { confirmTransferReceiving } = require('../src/controllers/transfer-receiving.controller');
      const confirmed = await control(confirmTransferReceiving, { id: root.id });
      assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
      assert.equal((await prisma.transfer_order_items.aggregate({ where: { transfer_order_id: root.id }, _sum: { received_qty: true } }))._sum.received_qty, 7);
      assert.equal((await prisma.stock_balances.aggregate({ where: { warehouse_id: dst.id, variant_id: v.id }, _sum: { on_hand_qty: true } }))._sum.on_hand_qty, 7);
    });
  } finally { await prisma.$disconnect(); }
});
