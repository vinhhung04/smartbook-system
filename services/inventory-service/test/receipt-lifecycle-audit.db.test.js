const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.INVENTORY_AUDIT_TEST_DATABASE_URL;
test('SB07/13/14/15: receipt lifecycle and stock-count PostgreSQL audit', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && /^\/inventory_audit[a-z_]*$/.test(target.pathname));
  process.env.DATABASE_URL = url;
  const { PrismaClient } = process.env.INVENTORY_AUDIT_PRISMA_CLIENT ? require(process.env.INVENTORY_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  const prisma = new PrismaClient();
  const prismaPath = require.resolve('../src/lib/prisma');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma } };
  require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({ canWrite: async () => true });
  const { executeReturnStock } = require('../src/services/supplier-return.service');
  const { updateGoodsReceipt } = require('../src/controllers/goods-receipt.controller');
  const { closeRemainingLine } = require('../src/controllers/purchase-order-line-closure.controller');
  const { approveStockAudit } = require('../src/controllers/stock-audit.controller');
  const actor = { id: randomUUID(), is_superuser: true };
  async function invoke(fn, params, body = {}) {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await fn({ params, body, user: actor, headers: {} }, res);
    return res;
  }
  async function fixture() {
    const code = randomUUID().slice(0, 8);
    const wh = await prisma.warehouses.create({ data: { code: `RC-${code}`, name: 'Receipt audit' } });
    const book = await prisma.books.create({ data: { title: 'Receipt audit' } });
    const variant = await prisma.book_variants.create({ data: { book_id: book.id, sku: `RC-${code}` } });
    const locations = [];
    for (const kind of ['receiving', 'shelf']) locations.push(await prisma.locations.create({ data: { warehouse_id: wh.id, location_code: `RC-${code}-${kind}` } }));
    const receipt = await prisma.goods_receipts.create({ data: { warehouse_id: wh.id, receipt_number: `RC-${code}`, status: 'POSTED' } });
    const item = await prisma.goods_receipt_items.create({ data: { goods_receipt_id: receipt.id, variant_id: variant.id, quantity: 10 } });
    for (let i = 0; i < 2; i++) await prisma.stock_balances.create({ data: { warehouse_id: wh.id, variant_id: variant.id, location_id: locations[i].id, on_hand_qty: i ? 10 : 0, available_qty: i ? 10 : 0 } });
    const common = { warehouse_id: wh.id, variant_id: variant.id, quantity: 10, reference_id: receipt.id, source_service: 'inventory-service' };
    await prisma.stock_movements.create({ data: { ...common, movement_number: `RC-${code}-IN`, movement_type: 'INBOUND', to_location_id: locations[0].id, reference_type: 'GOODS_RECEIPT', metadata: { movement_bucket: 'RECEIVING_HOLD' } } });
    await prisma.stock_movements.create({ data: { ...common, movement_number: `RC-${code}-PUT`, movement_type: 'TRANSFER', from_location_id: locations[0].id, to_location_id: locations[1].id, reference_type: 'RECEIVING_SHELF_PUTAWAY', metadata: { movement_bucket: 'PUTAWAY' } } });
    return { wh, variant, locations, receipt, item };
  }
  try {
    await t.test('SB13: returns after putaway use traced shelf quantities and cannot reuse prior returned allocations', async () => {
      const f = await fixture();
      const line = { id: randomUUID(), goods_receipt_item_id: f.item.id, variant_id: f.variant.id, return_qty: 6, unit_cost: 0, goods_receipt_items: f.item };
      const ret = { id: randomUUID(), warehouse_id: f.wh.id };
      await prisma.$transaction(tx => executeReturnStock(tx, ret, [line], actor.id));
      let shelf = await prisma.stock_balances.findFirst({ where: { variant_id: f.variant.id, location_id: f.locations[1].id } });
      assert.equal(shelf.available_qty, 4);
      // Replenishment from another receipt must not extend this receipt's allocation.
      await prisma.stock_balances.update({ where: { id: shelf.id }, data: { on_hand_qty: { increment: 10 }, available_qty: { increment: 10 } } });
      await assert.rejects(prisma.$transaction(tx => executeReturnStock(tx, { ...ret, id: randomUUID() }, [{ ...line, return_qty: 5 }], actor.id)), /Không đủ/);
      shelf = await prisma.stock_balances.findUnique({ where: { id: shelf.id } });
      assert.equal(shelf.available_qty, 14, 'partial writes roll back when the receipt allocation is insufficient');
    });
    await t.test('SB14: simultaneous cancellation reverts both movements only once', async () => {
      const f = await fixture();
      const results = await Promise.all([invoke(updateGoodsReceipt, { id: f.receipt.id }, { status: 'CANCELLED' }), invoke(updateGoodsReceipt, { id: f.receipt.id }, { status: 'CANCELLED' })]);
      assert.deepEqual(results.map(r => r.statusCode), [200, 200], JSON.stringify(results));
      const balances = await prisma.stock_balances.findMany({ where: { variant_id: f.variant.id } });
      assert.ok(balances.every(b => b.on_hand_qty === 0 && b.available_qty === 0));
      assert.equal(await prisma.stock_movements.count({ where: { reference_id: f.receipt.id, reverted: true } }), 2);
    });
    await t.test('SB14: borrowed shelf stock blocks cancellation and rolls back receipt status', async () => {
      const f = await fixture();
      await prisma.stock_balances.updateMany({ where: { variant_id: f.variant.id, location_id: f.locations[1].id }, data: { available_qty: 9, borrowed_qty: 1 } });
      const result = await invoke(updateGoodsReceipt, { id: f.receipt.id }, { status: 'CANCELLED' });
      assert.equal(result.statusCode, 409, JSON.stringify(result.body));
      assert.equal((await prisma.goods_receipts.findUnique({ where: { id: f.receipt.id } })).status, 'POSTED');
      assert.equal(await prisma.stock_movements.count({ where: { reference_id: f.receipt.id, reverted: true } }), 0);
    });
    await t.test('SB14: concurrent cancellation reverses PO received quantity only once', async () => {
      const f = await fixture();
      const tag = randomUUID();
      const supplier = await prisma.suppliers.create({ data: { code: `RC-${tag.slice(0, 8)}`, name: `Cancellation audit ${tag}` } });
      const po = await prisma.purchase_orders.create({ data: {
        po_number: `RC-${tag}`, supplier_id: supplier.id, warehouse_id: f.wh.id,
        ordered_by_user_id: actor.id, status: 'PARTIALLY_RECEIVED',
        purchase_order_items: { create: { variant_id: f.variant.id, ordered_qty: 100, received_qty: 20 } },
      }, include: { purchase_order_items: true } });
      await prisma.goods_receipts.update({ where: { id: f.receipt.id }, data: { purchase_order_id: po.id } });
      const responses = await Promise.all([1, 2].map(() => invoke(updateGoodsReceipt, { id: f.receipt.id }, { status: 'CANCELLED' })));
      assert.deepEqual(responses.map(r => r.statusCode), [200, 200]);
      const stored = await prisma.purchase_order_items.findUnique({ where: { id: po.purchase_order_items[0].id } });
      assert.equal(stored.received_qty, 10, 'the other GRN quantity must remain received');
      assert.equal(await prisma.inventory_audit_logs.count({ where: { entity_id: po.id, action_name: 'PURCHASE_ORDER_RECEIPT_CANCELLED' } }), 1);
    });
    await t.test('SB15: pending delivery prevents closure, processed discrepancy permits it', async () => {
      const f = await fixture();
      const supplierTag = randomUUID();
      const supplier = await prisma.suppliers.create({ data: { code: `RC-${supplierTag.slice(0, 8)}`, name: `Receipt audit ${supplierTag}` } });
      const po = await prisma.purchase_orders.create({ data: { po_number: `RC-${randomUUID().slice(0, 8)}`, supplier_id: supplier.id, warehouse_id: f.wh.id, ordered_by_user_id: actor.id, status: 'PARTIALLY_RECEIVED' } });
      const line = await prisma.purchase_order_items.create({ data: { purchase_order_id: po.id, variant_id: f.variant.id, ordered_qty: 100, received_qty: 50 } });
      const dn = await prisma.supplier_delivery_invoices.create({ data: { supplier_id: supplier.id, purchase_order_id: po.id, invoice_number: `RC-${randomUUID().slice(0, 8)}`, supplier_delivery_invoice_items: { create: { purchase_order_item_id: line.id, variant_id: f.variant.id, invoiced_qty: 50 } } } });
      assert.equal((await invoke(closeRemainingLine, { id: po.id, itemId: line.id }, { reason: 'No further delivery' })).statusCode, 409);
      await prisma.supplier_delivery_invoices.update({ where: { id: dn.id }, data: { status: 'SHORTAGE_REPORTED' } });
      assert.equal((await invoke(closeRemainingLine, { id: po.id, itemId: line.id }, { reason: 'No further delivery' })).statusCode, 200);
    });
    await t.test('SB07 policy: legacy approval without count-time cutoff requires recount', async () => {
      const f = await fixture();
      await prisma.stock_balances.updateMany({ where: { variant_id: f.variant.id, location_id: f.locations[1].id }, data: { on_hand_qty: 8, available_qty: 8 } });
      const audit = await prisma.stock_audits.create({ data: { audit_number: `RC-${randomUUID().slice(0, 8)}`, warehouse_id: f.wh.id, created_by_user_id: actor.id, status: 'SUBMITTED', stock_audit_lines: { create: { variant_id: f.variant.id, location_id: f.locations[1].id, expected_qty: 10, counted_qty: 8, variance_qty: -2 } } } });
      const result = await invoke(approveStockAudit, { id: audit.id });
      assert.equal(result.statusCode, 409);
      assert.equal(result.body.code, 'STOCK_AUDIT_RECOUNT_REQUIRED');
      const balance = await prisma.stock_balances.findFirst({ where: { variant_id: f.variant.id, location_id: f.locations[1].id } });
      assert.equal(balance.on_hand_qty, 8, 'legacy stock remains unchanged until a fresh authoritative count');
    });
  } finally { await prisma.$disconnect(); }
});
