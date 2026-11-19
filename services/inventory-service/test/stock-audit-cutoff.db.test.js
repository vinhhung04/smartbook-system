const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.INVENTORY_AUDIT_TEST_DATABASE_URL;

test('SB07: count cutoff, freeze and overlap invariants on PostgreSQL', { skip: !url }, async t => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && /^\/inventory_audit[a-z_]*$/.test(target.pathname));
  process.env.DATABASE_URL = url;
  const { PrismaClient } = process.env.INVENTORY_AUDIT_PRISMA_CLIENT ? require(process.env.INVENTORY_AUDIT_PRISMA_CLIENT) : require('@prisma/client');
  const prisma = new PrismaClient();
  const modulePath = require.resolve('../src/lib/prisma');
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: { prisma } };
  const { observeStockAuditFreeze, stockAuditFreezeResponses } = require('../src/middlewares/stock-audit-freeze.middleware');
  prisma.$use(async (params, next) => { try { return await next(params); } catch (error) { observeStockAuditFreeze(error); throw error; } });
  const controller = require('../src/controllers/stock-audit.controller');
  const actor = { id: randomUUID(), is_superuser: true };
  async function invoke(fn, params = {}, body = {}) {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
    await fn({ params, body, user: actor }, res); return res;
  }
  async function fixture(borrowed = 0) {
    const tag = randomUUID().slice(0, 8);
    const wh = await prisma.warehouses.create({ data: { code: `CNT-${tag}`, name: `Count ${tag}` } });
    const loc = await prisma.locations.create({ data: { warehouse_id: wh.id, location_code: `CNT-${tag}`, location_type: 'BIN' } });
    const book = await prisma.books.create({ data: { title: `Count ${tag}` } });
    const variant = await prisma.book_variants.create({ data: { book_id: book.id, sku: `CNT-${tag}` } });
    const balance = await prisma.stock_balances.create({ data: { warehouse_id: wh.id, location_id: loc.id, variant_id: variant.id, on_hand_qty: 10, available_qty: 10 - borrowed, borrowed_qty: borrowed } });
    return { wh, loc, book, variant, balance };
  }
  async function create(f, start = true) {
    const response = await invoke(controller.createStockAudit, {}, { warehouse_id: f.wh.id, location_ids: [f.loc.id] });
    assert.equal(response.statusCode, 201, JSON.stringify(response.body));
    if (start) assert.equal((await invoke(controller.recountStockAudit, { id: response.body.data.id })).statusCode, 200);
    const audit = await prisma.stock_audits.findUnique({ where: { id: response.body.data.id }, include: { stock_audit_lines: true } });
    return audit;
  }
  let server;
  try {
    await t.test('draft reserves scope without freezing; starting refreshes the physical baseline', async () => {
      const f = await fixture(); const audit = await create(f, false);
      await prisma.stock_balances.update({ where: { id: f.balance.id }, data: { on_hand_qty: 12, available_qty: 12 } });
      const line = audit.stock_audit_lines[0];
      assert.equal((await invoke(controller.submitLineCount, { id: audit.id, lineId: line.id }, { counted_qty: 12 })).statusCode, 409);
      assert.equal((await invoke(controller.recountStockAudit, { id: audit.id })).statusCode, 200);
      assert.equal((await prisma.stock_audit_lines.findUnique({ where: { id: line.id } })).expected_qty, 12);
      await assert.rejects(prisma.stock_balances.update({ where: { id: f.balance.id }, data: { on_hand_qty: 13 } }), /STOCK_AUDIT_LOCATION_FROZEN/);
      await invoke(controller.cancelStockAudit, { id: audit.id });
    });
    await t.test('two open audits at one location cannot coexist; every balance writer is frozen with HTTP409', async () => {
      const f = await fixture();
      const responses = await Promise.all([1, 2].map(() => invoke(controller.createStockAudit, {}, { warehouse_id: f.wh.id, location_ids: [f.loc.id] })));
      assert.deepEqual(responses.map(r => r.statusCode).sort(), [201, 409]);
      const id = responses.find(r => r.statusCode === 201).body.data.id;
      assert.equal((await invoke(controller.recountStockAudit, { id })).statusCode, 200);
      const express = require('express');
      const app = express(); app.use(stockAuditFreezeResponses);
      app.post('/mutate', async (_req, res) => {
        try { await prisma.stock_balances.update({ where: { id: f.balance.id }, data: { reserved_qty: 1, available_qty: 9 } }); res.json({ ok: true }); }
        catch { res.status(500).json({ message: 'legacy generic catch' }); }
      });
      server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
      const response = await fetch(`http://127.0.0.1:${server.address().port}/mutate`, { method: 'POST' });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'STOCK_AUDIT_LOCATION_FROZEN');
      await assert.rejects(prisma.stock_balances.delete({ where: { id: f.balance.id } }), /STOCK_AUDIT_LOCATION_FROZEN/);
      const second = await prisma.book_variants.create({ data: { book_id: f.book.id, sku: `CNT-${randomUUID()}` } });
      await assert.rejects(prisma.stock_balances.create({ data: { warehouse_id: f.wh.id, location_id: f.loc.id, variant_id: second.id, on_hand_qty: 1 } }), /STOCK_AUDIT_LOCATION_FROZEN/);
      assert.equal((await prisma.stock_balances.findUnique({ where: { id: f.balance.id } })).on_hand_qty, 10);
      assert.equal((await invoke(controller.cancelStockAudit, { id })).statusCode, 200);
      await prisma.stock_balances.update({ where: { id: f.balance.id }, data: { on_hand_qty: 9, available_qty: 9 } });
      await create(f);
      await new Promise(resolve => server.close(resolve)); server = null;
    });
    await t.test('count10→8 then outbound2 approves to6 exactly once and releases overlap reservation', async () => {
      const f = await fixture(); const audit = await create(f); const line = audit.stock_audit_lines[0];
      assert.equal((await invoke(controller.submitLineCount, { id: audit.id, lineId: line.id }, { counted_qty: 8 })).statusCode, 200);
      assert.equal((await invoke(controller.confirmLocationCount, { id: audit.id, locationId: f.loc.id })).statusCode, 200);
      await prisma.stock_balances.update({ where: { id: f.balance.id }, data: { on_hand_qty: { decrement: 2 }, available_qty: { decrement: 2 } } });
      assert.equal((await invoke(controller.submitStockAudit, { id: audit.id })).statusCode, 200);
      const approvals = await Promise.all([1, 2].map(() => invoke(controller.approveStockAudit, { id: audit.id })));
      assert.ok(approvals.every(r => r.statusCode === 200), JSON.stringify(approvals));
      assert.equal((await prisma.stock_balances.findUnique({ where: { id: f.balance.id } })).on_hand_qty, 6);
      assert.equal(await prisma.stock_movements.count({ where: { reference_type: 'stock_audit', reference_id: line.id } }), 1);
      assert.equal(await prisma.stock_audit_location_sessions.count({ where: { stock_audit_id: audit.id, released_at: null } }), 0);
      await create(f);
    });
    await t.test('off-site borrowed copies are excluded from shelf count and remain in on-hand ledger', async () => {
      const f = await fixture(3); const audit = await create(f); const line = audit.stock_audit_lines[0];
      assert.equal(line.expected_qty, 7);
      assert.equal(line.baseline_borrowed_qty, 3);
      await invoke(controller.submitLineCount, { id: audit.id, lineId: line.id }, { counted_qty: 7 });
      assert.equal((await invoke(controller.submitStockAudit, { id: audit.id })).statusCode, 200);
      assert.equal((await invoke(controller.approveStockAudit, { id: audit.id })).statusCode, 200);
      const balance = await prisma.stock_balances.findUnique({ where: { id: f.balance.id } });
      assert.deepEqual([balance.on_hand_qty, balance.available_qty, balance.borrowed_qty], [10, 7, 3]);
    });
    await t.test('legacy submitted count is rejected unchanged, explicit recount establishes a real cutoff', async () => {
      const f = await fixture();
      const audit = await prisma.stock_audits.create({ data: { audit_number: `CNT-${randomUUID()}`, warehouse_id: f.wh.id, created_by_user_id: actor.id, status: 'SUBMITTED', stock_audit_lines: { create: { variant_id: f.variant.id, location_id: f.loc.id, expected_qty: 10, counted_qty: 8, variance_qty: -2 } } }, include: { stock_audit_lines: true } });
      assert.equal((await invoke(controller.approveStockAudit, { id: audit.id })).statusCode, 409);
      assert.equal((await prisma.stock_audits.findUnique({ where: { id: audit.id } })).status, 'SUBMITTED');
      assert.equal((await invoke(controller.recountStockAudit, { id: audit.id })).statusCode, 200);
      const line = await prisma.stock_audit_lines.findUnique({ where: { id: audit.stock_audit_lines[0].id } });
      assert.equal(line.counted_qty, null);
      await invoke(controller.submitLineCount, { id: audit.id, lineId: line.id }, { counted_qty: 8 });
      await invoke(controller.submitStockAudit, { id: audit.id });
      assert.equal((await invoke(controller.approveStockAudit, { id: audit.id })).statusCode, 200);
      assert.equal((await prisma.stock_balances.findUnique({ where: { id: f.balance.id } })).on_hand_qty, 8);
    });
    await t.test('a location stays frozen until every variant is counted and cannot be edited after confirmation', async () => {
      const f = await fixture();
      const v2 = await prisma.book_variants.create({ data: { book_id: f.book.id, sku: `CNT-${randomUUID()}` } });
      await prisma.stock_balances.create({ data: { warehouse_id: f.wh.id, location_id: f.loc.id, variant_id: v2.id, on_hand_qty: 5, available_qty: 5 } });
      const audit = await create(f); const [a, b] = audit.stock_audit_lines;
      await invoke(controller.submitLineCount, { id: audit.id, lineId: a.id }, { counted_qty: a.expected_qty });
      assert.equal((await invoke(controller.confirmLocationCount, { id: audit.id, locationId: f.loc.id })).statusCode, 409);
      await assert.rejects(prisma.stock_balances.update({ where: { id: f.balance.id }, data: { on_hand_qty: 11 } }), /STOCK_AUDIT_LOCATION_FROZEN/);
      await invoke(controller.submitLineCount, { id: audit.id, lineId: b.id }, { counted_qty: b.expected_qty });
      assert.equal((await invoke(controller.confirmLocationCount, { id: audit.id, locationId: f.loc.id })).statusCode, 200);
      assert.equal((await invoke(controller.submitLineCount, { id: audit.id, lineId: a.id }, { counted_qty: 0 })).statusCode, 409);
      await prisma.stock_balances.update({ where: { id: f.balance.id }, data: { on_hand_qty: 11, available_qty: 11 } });
      await invoke(controller.cancelStockAudit, { id: audit.id });
    });
  } finally { if (server) await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
});
