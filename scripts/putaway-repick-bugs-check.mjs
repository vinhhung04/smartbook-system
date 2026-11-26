// Re-test the four putaway / repick bugs on whatever inventory-service is running, before or
// after the fix. It never stops at the first problem: each case records what really happened
// and the script prints expected vs actual, then exits 1 if any case failed.
//
//   1 (P0) putting 4 of 10 received copies away must leave RECEIVING 6, shelf 4, total 10
//   2 (P0) a receipt with 7 of 10 put away must refuse another 8
//   3 (P1) a partial pick (7/10) stays on its task; declaring the shortage opens a repick of 3
//   4 (P1) a second shortage in the chain (repick 1 picked 1/3) opens a NEW repick of 2
//
// Cases 1-2 use the legacy endpoint POST /api/putaway/receipts/:id/confirm while it exists;
// once it answers 404 (removed by the fix) they use POST /api/receiving-putaway/transfer.
// Every run creates its own tagged rows (books "Putaway <tag>" / "Repick <tag>", receipts
// GR-CHK-<tag>, orders OUT-CHK-<tag>) in the local inventory_db. Run on a local/QA stack only.
//
// Usage: node scripts/putaway-repick-bugs-check.mjs   (GATEWAY_URL, DB_USER, DEMO_PASSWORD optional)
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const gateway = (process.env.GATEWAY_URL || 'http://localhost:3000').replace(/\/$/, '');
const dbUser = process.env.DB_USER || /^DB_USER=(.*)$/m.exec(readFileSync(resolve(root, '.env'), 'utf8'))?.[1]?.trim();
const password = process.env.DEMO_PASSWORD || '123456';

const sql = (query) => execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', dbUser, '-d', 'inventory_db', '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { cwd: root, encoding: 'utf8' }).trim();
let token = '';
async function call(method, path, body) {
  const res = await fetch(`${gateway}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// A POSTED receipt of 10 copies, all still in RECEIVING (as goods-receipt posting leaves them),
// and an empty zone > shelf > compartment to put them on.
function postedReceipt() {
  const tag = randomUUID().slice(0, 8);
  const [warehouseId, receivingId, variantId, receiptId, itemId] = sql(`WITH w AS (SELECT id FROM warehouses WHERE code='WH-HCM-01'),
    r AS (SELECT l.id FROM locations l, w WHERE l.warehouse_id=w.id AND l.location_type='RECEIVING' AND l.is_active ORDER BY l.location_code LIMIT 1),
    b AS (INSERT INTO books(title) VALUES ('Putaway ${tag}') RETURNING id),
    v AS (INSERT INTO book_variants(book_id,sku) SELECT id,'PUT-${tag}' FROM b RETURNING id),
    g AS (INSERT INTO goods_receipts(receipt_number,warehouse_id,status) SELECT 'GR-CHK-${tag}',id,'POSTED' FROM w RETURNING id,warehouse_id),
    gi AS (INSERT INTO goods_receipt_items(goods_receipt_id,variant_id,quantity,unit_cost) SELECT g.id,v.id,10,0 FROM g,v RETURNING id),
    s AS (INSERT INTO stock_balances(warehouse_id,location_id,variant_id,on_hand_qty,available_qty) SELECT g.warehouse_id,r.id,v.id,10,0 FROM g,r,v)
    SELECT g.warehouse_id,r.id,v.id,g.id,gi.id FROM g,r,v,gi`).split('|');
  const [compartmentId, shelfId, zoneId] = sql(`WITH z AS (INSERT INTO locations(warehouse_id,location_code,location_type) VALUES ('${warehouseId}','Z-${tag}','ZONE') RETURNING id),
    s AS (INSERT INTO locations(warehouse_id,parent_location_id,location_code,location_type) SELECT '${warehouseId}',id,'S-${tag}','SHELF' FROM z RETURNING id),
    c AS (INSERT INTO locations(warehouse_id,parent_location_id,location_code,location_type) SELECT '${warehouseId}',id,'C-${tag}','SHELF_COMPARTMENT' FROM s RETURNING id)
    SELECT c.id,s.id,z.id FROM c,s,z`).split('|');
  const onHand = (where = '') => Number(sql(`SELECT COALESCE(SUM(on_hand_qty),0) FROM stock_balances WHERE variant_id='${variantId}' ${where}`));
  return {
    receiving: () => onHand(`AND location_id='${receivingId}'`),
    shelf: () => onHand(`AND location_id='${compartmentId}'`),
    total: () => onHand(),
    // Put `qty` away through the legacy endpoint if it still exists, else through the live one.
    async putaway(qty) {
      const legacy = await call('POST', `/api/putaway/receipts/${receiptId}/confirm`, {
        allocations: [{ item_id: itemId, zone_id: zoneId, shelf_id: shelfId, compartment_id: compartmentId, putaway_quantity: qty }],
      });
      if (legacy.status !== 404) return { path: 'legacy confirm', status: legacy.status };
      const live = await call('POST', '/api/receiving-putaway/transfer', {
        warehouse_id: warehouseId, source_receiving_location_id: receivingId, variant_id: variantId, goods_receipt_id: receiptId,
        allocations: [{ target_location_id: compartmentId, quantity: qty, reason: 'putaway-repick-bugs-check' }],
      });
      return { path: 'legacy 404 -> receiving-putaway/transfer', status: live.status, message: live.body?.message };
    },
  };
}

// An APPROVED outbound order of 10 copies on its own bin, with a PICK task as seed/backfill create.
function outboundOrder() {
  const tag = randomUUID().slice(0, 8);
  const [rootId, lineId, variantId, binCode] = sql(`WITH w AS (SELECT id FROM warehouses WHERE code='WH-HCM-01'),
    l AS (INSERT INTO locations(warehouse_id,location_code,location_type) SELECT id,'PCK-${tag}','BIN' FROM w RETURNING id,warehouse_id,location_code),
    b AS (INSERT INTO books(title) VALUES ('Repick ${tag}') RETURNING id),
    v AS (INSERT INTO book_variants(book_id,sku) SELECT id,'RPK-${tag}' FROM b RETURNING id),
    s AS (INSERT INTO stock_balances(warehouse_id,location_id,variant_id,on_hand_qty,available_qty) SELECT l.warehouse_id,l.id,v.id,10,10 FROM l,v),
    o AS (INSERT INTO outbound_orders(outbound_number,warehouse_id,outbound_type,status,requested_by_user_id) SELECT 'OUT-CHK-${tag}',l.warehouse_id,'MANUAL','APPROVED',gen_random_uuid() FROM l RETURNING id,warehouse_id),
    i AS (INSERT INTO outbound_order_items(outbound_order_id,variant_id,source_location_id,quantity) SELECT o.id,v.id,l.id,10 FROM o,v,l RETURNING id),
    t AS (INSERT INTO picking_tasks(task_number,root_order_id,picking_type,warehouse_id,status) SELECT 'PK-CHK-${tag}',o.id,'PICK',o.warehouse_id,'PENDING' FROM o RETURNING id),
    ti AS (INSERT INTO picking_task_items(picking_task_id,outbound_order_item_id,variant_id,source_location_id,requested_qty,short_qty) SELECT t.id,i.id,v.id,l.id,10,10 FROM t,i,v,l)
    SELECT o.id,i.id,v.id,l.location_code FROM o,i,v,l`).split('|');
  return {
    rootId,
    lineId,
    confirm: (orderId, line, quantity) => call('POST', `/api/picking/tasks/outbound/${orderId}/lines/${line}/confirm`, { quantity, scanned_location_input: binCode, scanned_variant_id: variantId }),
    declare: (orderId) => call('POST', `/api/picking/tasks/outbound/${orderId}/declare-shortage`),
    line: (orderId) => (sql(`SELECT id||'|'||quantity FROM outbound_order_items WHERE outbound_order_id='${orderId}' LIMIT 1`) || '|').split('|'),
    repicks: () => Number(sql(`SELECT count(*) FROM outbound_orders WHERE note LIKE '%root_task_id=${rootId}%'`)),
    status: () => sql(`SELECT status FROM outbound_orders WHERE id='${rootId}'`),
  };
}

const rows = [];
function record(stt, name, input, expected, actual, pass) {
  rows.push({ stt, name, input, expected, actual, pass });
}

async function main() {
  if (!dbUser) throw new Error('DB_USER not set (env or .env)');
  const login = await fetch(`${gateway}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hung', password }) });
  const auth = await login.json().catch(() => ({}));
  if (!login.ok || !auth.token) throw new Error(`login hung failed (${login.status}): ${JSON.stringify(auth)}`);
  token = auth.token;

  // Precondition, not one of the four bugs: the squashed init migration leaves picking_task_sequences
  // empty, and before the fix an empty table makes every declare-shortage on an order with a PICK task
  // answer 500. Seed the REPICK row in line with existing RPK-NNNN numbers so case 4 can be reached.
  const seeded = sql(`WITH ins AS (INSERT INTO picking_task_sequences(sequence_type,last_number)
    SELECT 'REPICK', COALESCE(MAX(substring(task_number FROM '^RPK-([0-9]+)$')::int),0) FROM picking_tasks
    ON CONFLICT (sequence_type) DO NOTHING RETURNING last_number) SELECT last_number FROM ins`);
  console.log(seeded ? `precondition: picking_task_sequences had no REPICK row -> seeded at ${seeded}` : 'precondition: picking_task_sequences REPICK row present');

  // 1. Putaway 4 of 10.
  {
    const r = postedReceipt();
    const res = await r.putaway(4);
    const [rec, shelf, total] = [r.receiving(), r.shelf(), r.total()];
    record(1, 'Putaway cộng trùng tồn kho', 'Nhập 10 vào Receiving, Putaway 4 lên kệ', 'Receiving 6, kệ 4, tổng 10',
      `${res.path} -> ${res.status}; Receiving ${rec}, kệ ${shelf}, tổng ${total}`, rec === 6 && shelf === 4 && total === 10);
  }

  // 2. Putaway 7, then 8 more on the same receipt.
  {
    const r = postedReceipt();
    const first = await r.putaway(7);
    const second = await r.putaway(8);
    const [shelf, total] = [r.shelf(), r.total()];
    record(2, 'Putaway vượt số lượng thực nhận', 'Phiếu 10, đã Putaway 7, Putaway thêm 8', 'Từ chối lần 8 (còn 3), kệ 7, tổng 10',
      `${second.path}: lần 7 -> ${first.status}, lần 8 -> ${second.status}; kệ ${shelf}, tổng ${total}`,
      first.status < 300 && second.status >= 400 && shelf === 7 && total === 10);
  }

  // 3 + 4. One repick chain.
  const o = outboundOrder();
  const picked = await o.confirm(o.rootId, o.lineId, 7);
  const autoRepicks = o.repicks();
  const first = await o.declare(o.rootId);
  const firstId = first.body?.data?.task_id;
  const [firstLine, firstQty] = firstId ? o.line(firstId) : ['', ''];
  const deadBlock = readFileSync(resolve(root, 'services/inventory-service/src/controllers/picking.controller.js'), 'utf8').includes('if (allDone && !isRepickOrder)');
  record(3, 'Tự động tạo Repick', 'Đơn 10, Picking được 7, thiếu 3',
    'Chưa tự tạo Repick lúc mới lấy 7 (thiết kế: chờ khai báo thiếu); khai báo thiếu -> Repick 3',
    `xác nhận 7 -> ${picked.status}; Repick tự tạo: ${autoRepicks}; khai báo thiếu -> ${first.status}, Repick ${firstQty || '-'} cuốn; mã nguồn: khối tự tạo Repick không thể chạy ${deadBlock ? 'còn' : 'đã gỡ'}`,
    picked.status === 201 && autoRepicks === 0 && first.status === 201 && Number(firstQty) === 3);

  let actual4 = 'không tới được (ca 3 thất bại)';
  let pass4 = false;
  if (firstId && firstLine) {
    const pickedOne = await o.confirm(firstId, firstLine, 1);
    const second = await o.declare(firstId);
    const secondId = second.body?.data?.task_id;
    const [secondLine, secondQty] = secondId ? o.line(secondId) : ['', ''];
    const fresh = second.status === 201 && second.body?.data?.reused_existing === false && secondId && secondId !== firstId && Number(secondQty) === 2;
    let finish = '';
    if (fresh) {
      const last = await o.confirm(secondId, secondLine, 2);
      finish = `; lấy nốt 2 -> ${last.status}, đơn gốc ${o.status()}`;
    }
    actual4 = `Repick 1 lấy 1 -> ${pickedOne.status}; khai báo thiếu lần 2 -> ${second.status}, reused_existing=${second.body?.data?.reused_existing}, `
      + `${secondId && secondId !== firstId ? `Repick mới ${secondQty} cuốn` : 'không có Repick mới'}; tổng Repick ${o.repicks()}${finish}`;
    pass4 = Boolean(fresh) && o.status() === 'READY_TO_SHIP';
  }
  record(4, 'Repick lần tiếp theo', 'Pick 7/10, Repick 1 lấy 1/3, khai báo còn thiếu 2', 'Tạo Repick mới cho 2 cuốn; lấy đủ -> đơn READY_TO_SHIP', actual4, pass4);

  console.log('');
  for (const row of rows) {
    console.log(`${row.pass ? 'PASS' : 'FAIL'} ${row.stt}. ${row.name}`);
    console.log(`     Input:     ${row.input}`);
    console.log(`     Kỳ vọng:   ${row.expected}`);
    console.log(`     Thực tế:   ${row.actual}`);
  }
  const passed = rows.filter((row) => row.pass).length;
  console.log(`\n${passed}/${rows.length} ca đạt`);
  process.exitCode = passed === rows.length ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
