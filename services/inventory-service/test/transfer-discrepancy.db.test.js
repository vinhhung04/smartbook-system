const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.INVENTORY_AUDIT_TEST_DATABASE_URL;
test('SB12 PostgreSQL custody, approval and replay invariants', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && /^\/inventory_audit[a-z_]*$/.test(target.pathname));
  process.env.DATABASE_URL = url;
  const { PrismaClient } = process.env.INVENTORY_AUDIT_PRISMA_CLIENT ? require(process.env.INVENTORY_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  const prisma = new PrismaClient();
  const prismaPath = require.resolve('../src/lib/prisma');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma } };
  require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({ canWrite: async () => true });
  const { confirmTransferReceiving } = require('../src/controllers/transfer-receiving.controller');
  const { updateGoodsReceipt } = require('../src/controllers/goods-receipt.controller');
  const { resolveDiscrepancy } = require('../src/controllers/transfer-discrepancy.controller');
  const { caseDetail, resolveTransferDiscrepancy } = require('../src/services/transfer-discrepancy.service');
  const actor = { id: randomUUID(), is_superuser: true, roles: ['WAREHOUSE_MANAGER'] };
  const invoke = async (fn, id, body = {}, key = randomUUID()) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
      await fn({ params: { id }, body, headers: { 'idempotency-key': key }, get: () => key, user: actor }, res);
      // Shared test DB files create fixtures concurrently. A Serializable abort
      // is the documented retry response, not a successful receipt to count.
      if (fn !== confirmTransferReceiving || res.body?.code !== 'CONCURRENCY_CONFLICT' || attempt === 3) return res;
    }
  };
  const warehouse = async () => prisma.warehouses.create({ data: { code: `TD-${randomUUID().slice(0, 8)}`, name: 'Discrepancy audit' } });
  const [source, destination] = await Promise.all([warehouse(), warehouse()]);
  const book = await prisma.books.create({ data: { title: 'Transfer custody audit' } });
  async function fixture() {
    const variant = await prisma.book_variants.create({ data: { book_id: book.id, sku: `TD-${randomUUID()}` } });
    const order = await prisma.transfer_orders.create({ data: { transfer_number: `TD-${randomUUID()}`, from_warehouse_id: source.id,
      to_warehouse_id: destination.id, requested_by_user_id: actor.id, received_by_user_id: actor.id, status: 'IN_TRANSIT',
      transfer_order_items: { create: { variant_id: variant.id, quantity: 100, shipped_qty: 100 } } }, include: { transfer_order_items: true } });
    const response = await invoke(confirmTransferReceiving, order.id, { items: [{ transfer_order_item_id: order.transfer_order_items[0].id, delivered_qty: 95, damaged_qty: 3, rejected_qty: 2 }] });
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    const detail = await caseDetail(prisma, order.id);
    return { order, variant, detail, line: detail.items[0] };
  }
  const proposal = (f, bucket, action, quantity, extra = {}) => ({ discrepancy_item_id: f.line.id, bucket, action, quantity,
    reason: 'Manager verified custody evidence', evidence_reference: `AUD-${f.order.id}`, ...extra });
  try {
    await t.test('receipt posts90 accepted,5 quarantine and5 missing once; receipt cancellation cannot orphan custody', async () => {
      const f = await fixture();
      const rows = await prisma.stock_balances.findMany({ where: { variant_id: f.variant.id } });
      assert.equal(rows.reduce((sum, row) => sum + row.on_hand_qty, 0), 95);
      assert.equal(rows.reduce((sum, row) => sum + row.available_qty, 0), 0);
      assert.equal(rows.reduce((sum, row) => sum + row.damaged_qty, 0), 5);
      assert.equal(f.line.remaining_missing_qty, 5);
      const replay = await invoke(confirmTransferReceiving, f.order.id);
      assert.equal(replay.body.data.discrepancy_id, f.detail.id);
      assert.equal(await prisma.transfer_discrepancies.count({ where: { transfer_order_id: f.order.id } }), 1);
      assert.equal((await prisma.stock_balances.aggregate({ where: { variant_id: f.variant.id }, _sum: { on_hand_qty: true } }))._sum.on_hand_qty, 95);
      const cancelled = await invoke(updateGoodsReceipt, f.detail.goods_receipt_id, { status: 'CANCELLED' });
      assert.equal(cancelled.statusCode, 409);
      assert.equal((await prisma.goods_receipts.findUnique({ where: { id: f.detail.goods_receipt_id } })).status, 'POSTED');
    });
    await t.test('concurrent found approvals cannot exceed missing quantity; same key replays, different payload conflicts', async () => {
      const f = await fixture();
      const keys = [randomUUID(), randomUUID()];
      const results = await Promise.all(keys.map(key => invoke(resolveDiscrepancy, f.order.id, proposal(f, 'MISSING', 'FOUND', 3), key)));
      assert.deepEqual(results.map(row => row.statusCode).sort(), [200, 409]);
      const winner = keys[results.findIndex(row => row.statusCode === 200)];
      const replay = await invoke(resolveDiscrepancy, f.order.id, proposal(f, 'MISSING', 'FOUND', 3), winner);
      assert.equal(replay.statusCode, 200); assert.equal(replay.body.idempotent, true);
      assert.equal((await invoke(resolveDiscrepancy, f.order.id, proposal(f, 'MISSING', 'FOUND', 2), winner)).statusCode, 409);
      const detail = await caseDetail(prisma, f.order.id);
      assert.equal(detail.items[0].remaining_missing_qty, 2);
      assert.equal((await prisma.transfer_order_items.findUnique({ where: { id: f.order.transfer_order_items[0].id } })).received_qty, 93);
      assert.equal((await prisma.stock_balances.aggregate({ where: { variant_id: f.variant.id }, _sum: { on_hand_qty: true } }))._sum.on_hand_qty, 98);
    });
    await t.test('manager resolves each custody bucket; source permission is required and returned stock stays unavailable', async () => {
      const f = await fixture();
      await assert.rejects(prisma.$transaction(tx => resolveTransferDiscrepancy(tx, { transferId: f.order.id,
        body: proposal(f, 'REJECTED', 'RETURN_TO_SOURCE', 2), key: randomUUID(), actorId: actor.id, canWriteSource: false })), error => error.statusCode === 403);
      for (const body of [proposal(f, 'MISSING', 'WRITE_OFF', 5), proposal(f, 'DAMAGED', 'WRITE_OFF', 3), proposal(f, 'REJECTED', 'RETURN_TO_SOURCE', 2)]) {
        assert.equal((await invoke(resolveDiscrepancy, f.order.id, body)).statusCode, 200);
      }
      assert.equal((await caseDetail(prisma, f.order.id)).status, 'RESOLVED');
      const returned = await prisma.stock_balances.findFirst({ where: { warehouse_id: source.id, variant_id: f.variant.id } });
      assert.equal(returned.on_hand_qty, 2); assert.equal(returned.damaged_qty, 2); assert.equal(returned.available_qty, 0);
      assert.equal(await prisma.transfer_discrepancy_resolutions.count({ where: { discrepancy_id: f.detail.id } }), 3);
    });
    await t.test('received replacement is attributed once without posting stock again', async () => {
      const f = await fixture();
      const replacement = await prisma.transfer_orders.create({ data: { transfer_number: `TD-${randomUUID()}`, from_warehouse_id: source.id,
        to_warehouse_id: destination.id, requested_by_user_id: actor.id, received_by_user_id: actor.id, status: 'IN_TRANSIT',
        transfer_order_items: { create: { variant_id: f.variant.id, quantity: 3, shipped_qty: 3 } } } });
      assert.equal((await invoke(confirmTransferReceiving, replacement.id)).statusCode, 200);
      const body = proposal(f, 'MISSING', 'REDELIVERED', 3, { redelivery_transfer_id: replacement.id });
      const before = await prisma.stock_movements.count({ where: { variant_id: f.variant.id } });
      assert.equal((await invoke(resolveDiscrepancy, f.order.id, body)).statusCode, 409, 'unrelated received stock cannot satisfy this shipment');
      await prisma.transfer_orders.update({ where: { id: replacement.id }, data: { note: `redelivery_for=${f.order.id}` } });
      assert.equal((await invoke(resolveDiscrepancy, f.order.id, body)).statusCode, 200);
      assert.equal(await prisma.stock_movements.count({ where: { variant_id: f.variant.id } }), before);
      assert.equal((await invoke(resolveDiscrepancy, f.order.id, { ...body, quantity: 2 })).statusCode, 409);
    });
  } finally { await prisma.$disconnect(); }
});
