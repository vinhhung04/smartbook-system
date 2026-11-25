// Outbound queue + repick regressions that only show up on real PostgreSQL:
// - `NOT (external_reference LIKE 'REPICK:%')` is NULL for root orders, so the queue hid every one.
// - a repick order that declared a shortage stayed PICKING and its handed-off line could be picked again
//   (the same copies were moved twice: "7 / 5 cuốn").
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.INVENTORY_AUDIT_TEST_DATABASE_URL;

test('outbound queue and repick shortage on PostgreSQL', { skip: !url }, async (t) => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && /^\/inventory_audit[a-z_]*$/.test(target.pathname));
  process.env.DATABASE_URL = url;
  const { PrismaClient } = process.env.INVENTORY_AUDIT_PRISMA_CLIENT ? require(process.env.INVENTORY_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  const prisma = new PrismaClient();
  const prismaPath = require.resolve('../src/lib/prisma');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma } };
  require('../src/utils/warehouse-scope.utils').setWarehouseScopeResolver({
    resolve: async () => ({ all: true, read: null, write: null }),
    canRead: async () => true,
    canWrite: async () => true,
  });
  const { listOutboundQueue } = require('../src/controllers/outbound.controller');
  const { confirmPickingLine, declareOutboundShortage } = require('../src/controllers/picking.controller');
  const { withLineShortPickedQty, upsertMarkerLine, REPICK_META_MARKER } = require('../src/services/picking-note.service');

  const actor = { id: randomUUID(), is_superuser: true, roles: ['ADMIN'] };
  const call = async (fn, req) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
    await fn({ user: actor, query: {}, params: {}, body: {}, headers: {}, get: () => undefined, ...req }, res);
    return res;
  };
  const tag = randomUUID().slice(0, 8);
  const warehouse = await prisma.warehouses.create({ data: { code: `OQ-${tag}`, name: 'Outbound queue regression' } });
  const book = await prisma.books.create({ data: { title: 'Outbound queue regression' } });
  const variant = await prisma.book_variants.create({ data: { book_id: book.id, sku: `OQ-${tag}` } });
  const order = (number, data, items) => prisma.outbound_orders.create({
    data: { outbound_number: `${number}-${tag}`, warehouse_id: warehouse.id, outbound_type: 'MANUAL', requested_by_user_id: actor.id, ...data,
      outbound_order_items: { create: items.map((i) => ({ variant_id: variant.id, ...i })) } },
    include: { outbound_order_items: true },
  });
  const packed = (o) => prisma.packing_tasks.create({ data: { task_number: `PK-${randomUUID().slice(0, 12)}`, root_order_id: o.id, warehouse_id: warehouse.id, status: 'COMPLETED' } });
  const repickNote = (root, parent) => upsertMarkerLine('', REPICK_META_MARKER, {
    root_task_type: 'outbound', root_task_id: root.id, parent_task_type: 'outbound', parent_task_id: parent.id, repick_sequence: 1, repick_reason: 'SHORT_PICK',
  });

  try {
    await t.test('a packed root order with NULL external_reference is listed; its REPICK child and unpacked orders are not', async () => {
      const root = await order('OQ-ROOT', { status: 'READY_TO_SHIP' }, [{ quantity: 5, processed_qty: 3 }]);
      await packed(root);
      const child = await order('OQ-CHILD', { status: 'READY_TO_SHIP', external_reference: `REPICK:${root.outbound_number}`, note: repickNote(root, root) }, [{ quantity: 2, processed_qty: 2 }]);
      await packed(child);
      const unpacked = await order('OQ-UNPACKED', { status: 'READY_TO_SHIP' }, [{ quantity: 1, processed_qty: 1 }]);

      const res = await call(listOutboundQueue, { query: { warehouse_id: warehouse.id } });
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      const ids = res.body.data.map((row) => row.task_id);
      assert.ok(ids.includes(root.id), 'root order with NULL external_reference must be listed');
      assert.ok(!ids.includes(child.id), 'REPICK child is shown through its root');
      assert.ok(!ids.includes(unpacked.id), 'unpacked order stays in the Packing queue');
      assert.equal(res.body.data.find((row) => row.task_id === root.id).ready_quantity, 5); // 3 root + 2 repick
    });

    await t.test('declaring a shortage on a repick order closes it and its handed-off line cannot be picked again', async () => {
      const root = await order('OQ-R2', { status: 'REPICKING', processed_by_user_id: actor.id }, [{ quantity: 5, processed_qty: 0 }]);
      const repick = await order('OQ-RP', { status: 'PICKING', processed_by_user_id: actor.id, external_reference: `REPICK:${root.outbound_number}`, note: repickNote(root, root) }, [{ quantity: 5, processed_qty: 3 }]);

      const declared = await call(declareOutboundShortage, { params: { taskId: repick.id } });
      assert.equal(declared.statusCode, 201, JSON.stringify(declared.body));
      const after = await prisma.outbound_orders.findUnique({ where: { id: repick.id }, include: { outbound_order_items: true } });
      assert.equal(after.status, 'READY_TO_SHIP');
      const next = await prisma.outbound_orders.findMany({ where: { external_reference: `REPICK:${repick.outbound_number}` }, include: { outbound_order_items: true } });
      assert.equal(next.length, 1);
      assert.equal(next[0].outbound_order_items[0].quantity, 2);

      // Legacy row stuck in PICKING with the shortage marker: the line guard still refuses it.
      const line = after.outbound_order_items[0];
      await prisma.outbound_orders.update({ where: { id: repick.id }, data: { status: 'PICKING' } });
      assert.equal(line.note, withLineShortPickedQty(line.note, 2));
      const confirm = await call(confirmPickingLine, {
        params: { taskType: 'outbound', taskId: repick.id, lineId: line.id },
        body: { quantity: 2, scanned_location_input: 'ANY', scanned_variant_id: variant.id },
      });
      assert.equal(confirm.statusCode, 409, JSON.stringify(confirm.body));
      assert.equal(confirm.body.code, 'LINE_SHORTAGE_HANDED_TO_REPICK');
      const unchanged = await prisma.outbound_order_items.findUnique({ where: { id: line.id } });
      assert.equal(unchanged.processed_qty, 3);
    });
  } finally {
    await prisma.$disconnect();
  }
});
