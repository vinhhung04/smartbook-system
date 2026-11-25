import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { DEMO_PASSWORD } from './helpers';

// Putaway / repick quantity rules, driven through the real API (inventory-service behind the gateway):
// - putting part of a receipt away moves stock out of RECEIVING, it never adds a second copy;
// - a receipt never puts away more than it received;
// - a partial pick stays on its task until the picker declares the shortage;
// - every declared shortage in a repick chain gets its own repick for what is still missing.
const gateway = process.env.GATEWAY_URL || 'http://localhost:13000';
const sql = (query: string) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER!, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { cwd: resolve(import.meta.dirname, '../../..'), encoding: 'utf8' }).trim();

test.skip(process.env.SMARTBOOK_TEST_ISOLATED !== '1', 'requires disposable QA database');

let token = '';
test.beforeAll(async ({ request }) => {
  const login = await request.post(`${gateway}/auth/login`, { data: { identifier: 'hung', password: DEMO_PASSWORD } });
  expect(login.ok()).toBeTruthy();
  token = (await login.json()).token;
});
const api = (request: APIRequestContext, method: 'get' | 'post', path: string, data?: unknown) =>
  request[method](`${gateway}${path}`, { headers: { Authorization: `Bearer ${token}` }, data });

// A POSTED receipt of 10 copies, all still in RECEIVING (as goods-receipt posting leaves them).
function postedReceipt() {
  const tag = randomUUID().slice(0, 8);
  const [warehouseId, receivingId, variantId, receiptId, itemId] = sql(`WITH w AS (SELECT id FROM warehouses WHERE code='WH-HCM-01'),
    r AS (SELECT l.id FROM locations l, w WHERE l.warehouse_id=w.id AND l.location_type='RECEIVING' AND l.is_active ORDER BY l.location_code LIMIT 1),
    b AS (INSERT INTO books(title) VALUES ('Putaway ${tag}') RETURNING id),
    v AS (INSERT INTO book_variants(book_id,sku) SELECT id,'PUT-${tag}' FROM b RETURNING id),
    g AS (INSERT INTO goods_receipts(receipt_number,warehouse_id,status) SELECT 'GR-E2E-${tag}',id,'POSTED' FROM w RETURNING id,warehouse_id),
    gi AS (INSERT INTO goods_receipt_items(goods_receipt_id,variant_id,quantity,unit_cost) SELECT g.id,v.id,10,0 FROM g,v RETURNING id),
    s AS (INSERT INTO stock_balances(warehouse_id,location_id,variant_id,on_hand_qty,available_qty) SELECT g.warehouse_id,r.id,v.id,10,0 FROM g,r,v)
    SELECT g.warehouse_id,r.id,v.id,g.id,gi.id FROM g,r,v,gi`).split('|');
  // An empty zone > shelf > compartment of its own.
  const [compartmentId, shelfId, zoneId] = sql(`WITH z AS (INSERT INTO locations(warehouse_id,location_code,location_type) VALUES ('${warehouseId}','Z-${tag}','ZONE') RETURNING id),
    s AS (INSERT INTO locations(warehouse_id,parent_location_id,location_code,location_type) SELECT '${warehouseId}',id,'S-${tag}','SHELF' FROM z RETURNING id),
    c AS (INSERT INTO locations(warehouse_id,parent_location_id,location_code,location_type) SELECT '${warehouseId}',id,'C-${tag}','SHELF_COMPARTMENT' FROM s RETURNING id)
    SELECT c.id,s.id,z.id FROM c,s,z`).split('|');
  const onHand = (where = '') => Number(sql(`SELECT COALESCE(SUM(on_hand_qty),0) FROM stock_balances WHERE variant_id='${variantId}' ${where}`));
  const allocation = (qty: number) => ({ allocations: [{ item_id: itemId, zone_id: zoneId, shelf_id: shelfId, compartment_id: compartmentId, putaway_quantity: qty }] });
  const transfer = (qty: number) => ({
    warehouse_id: warehouseId, source_receiving_location_id: receivingId, variant_id: variantId, goods_receipt_id: receiptId,
    allocations: [{ target_location_id: compartmentId, quantity: qty, reason: 'E2E putaway' }],
  });
  return { receiptId, receivingId, compartmentId, onHand, allocation, transfer };
}

test('putting 4 of 10 received copies away leaves 6 in receiving and 10 in total', async ({ request }) => {
  const r = postedReceipt();
  const legacy = await api(request, 'post', `/api/putaway/receipts/${r.receiptId}/confirm`, r.allocation(4));
  expect(r.onHand(), `legacy putaway answered ${legacy.status()}`).toBe(10);

  expect((await api(request, 'post', '/api/receiving-putaway/transfer', r.transfer(4))).status()).toBe(201);
  expect(r.onHand(`AND location_id='${r.receivingId}'`)).toBe(6);
  expect(r.onHand(`AND location_id='${r.compartmentId}'`)).toBe(4);
  expect(r.onHand()).toBe(10);
});

test('a receipt with 7 of 10 put away refuses another 8', async ({ request }) => {
  const r = postedReceipt();
  await api(request, 'post', `/api/putaway/receipts/${r.receiptId}/confirm`, r.allocation(7));
  const legacy = await api(request, 'post', `/api/putaway/receipts/${r.receiptId}/confirm`, r.allocation(8));
  expect(r.onHand(`AND location_id='${r.compartmentId}'`), `legacy putaway of 8 answered ${legacy.status()}`).toBeLessThanOrEqual(10);

  expect((await api(request, 'post', '/api/receiving-putaway/transfer', r.transfer(7))).status()).toBe(201);
  const over = await api(request, 'post', '/api/receiving-putaway/transfer', r.transfer(8));
  expect(over.status()).toBe(400);
  expect(r.onHand(`AND location_id='${r.compartmentId}'`)).toBe(7);
  expect(r.onHand()).toBe(10);
});

test('picking 7 of 10 waits for a declared shortage, and each later shortage gets a new repick', async ({ request }) => {
  const tag = randomUUID().slice(0, 8);
  const [rootId, lineId, variantId, binCode] = sql(`WITH w AS (SELECT id FROM warehouses WHERE code='WH-HCM-01'),
    u AS (SELECT gen_random_uuid() AS id),
    l AS (INSERT INTO locations(warehouse_id,location_code,location_type) SELECT id,'PCK-${tag}','BIN' FROM w RETURNING id,warehouse_id,location_code),
    b AS (INSERT INTO books(title) VALUES ('Repick ${tag}') RETURNING id),
    v AS (INSERT INTO book_variants(book_id,sku) SELECT id,'RPK-${tag}' FROM b RETURNING id),
    s AS (INSERT INTO stock_balances(warehouse_id,location_id,variant_id,on_hand_qty,available_qty) SELECT l.warehouse_id,l.id,v.id,10,10 FROM l,v),
    o AS (INSERT INTO outbound_orders(outbound_number,warehouse_id,outbound_type,status,requested_by_user_id) SELECT 'OUT-E2E-${tag}',l.warehouse_id,'MANUAL','APPROVED',u.id FROM l,u RETURNING id,warehouse_id),
    i AS (INSERT INTO outbound_order_items(outbound_order_id,variant_id,source_location_id,quantity) SELECT o.id,v.id,l.id,10 FROM o,v,l RETURNING id),
    t AS (INSERT INTO picking_tasks(task_number,root_order_id,picking_type,warehouse_id,status) SELECT 'PK-E2E-${tag}',o.id,'PICK',o.warehouse_id,'PENDING' FROM o RETURNING id),
    ti AS (INSERT INTO picking_task_items(picking_task_id,outbound_order_item_id,variant_id,source_location_id,requested_qty,short_qty) SELECT t.id,i.id,v.id,l.id,10,10 FROM t,i,v,l)
    SELECT o.id,i.id,v.id,l.location_code FROM o,i,v,l`).split('|');
  const confirm = (orderId: string, line: string, quantity: number) =>
    api(request, 'post', `/api/picking/tasks/outbound/${orderId}/lines/${line}/confirm`, { quantity, scanned_location_input: binCode, scanned_variant_id: variantId });
  const declare = async (orderId: string) => {
    const res = await api(request, 'post', `/api/picking/tasks/outbound/${orderId}/declare-shortage`);
    expect(res.status(), await res.text()).toBe(201);
    return (await res.json()).data;
  };
  const repickLine = (orderId: string) => sql(`SELECT id||'|'||quantity FROM outbound_order_items WHERE outbound_order_id='${orderId}'`).split('|');
  const repickCount = () => Number(sql(`SELECT count(*) FROM outbound_orders WHERE note LIKE '%root_task_id=${rootId}%'`));

  expect((await confirm(rootId, lineId, 7)).status()).toBe(201);
  expect(repickCount(), 'a partial pick stays on its own task').toBe(0);

  const first = await declare(rootId);
  expect(first.reused_existing).toBe(false);
  const [firstLine, firstQty] = repickLine(first.task_id);
  expect(Number(firstQty)).toBe(3);
  expect((await confirm(first.task_id, firstLine, 1)).status()).toBe(201);

  const second = await declare(first.task_id);
  expect(second.reused_existing, 'the second shortage must not reuse repick #1').toBe(false);
  expect(second.task_id).not.toBe(first.task_id);
  const [secondLine, secondQty] = repickLine(second.task_id);
  expect(Number(secondQty)).toBe(2);
  expect(repickCount()).toBe(2);

  expect((await confirm(second.task_id, secondLine, 2)).status()).toBe(201);
  expect(sql(`SELECT status FROM outbound_orders WHERE id='${rootId}'`)).toBe('READY_TO_SHIP');
});
