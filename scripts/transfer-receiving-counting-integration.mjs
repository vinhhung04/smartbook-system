// P1.3 check: confirming a transfer receipt must (A) reject a payload with a duplicate
// transfer_order_item_id instead of silently double-counting it, (B) reject items: []
// instead of treating it the same as "items omitted" (= receive in full), and (C) write
// transfer_order_items.received_qty so it stays in sync with what was actually posted.
//
// Fixture transfer_orders/transfer_order_items are inserted directly via SQL (status
// IN_TRANSIT) instead of driving the full request->approve->pick->pack->ship pipeline,
// since that pipeline is not what's under test here - confirmTransferReceiving is reached
// identically regardless of how the order got to IN_TRANSIT.
//
// Usage: node scripts/transfer-receiving-counting-integration.mjs
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const jwtSecret = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}
const actorId = crypto.randomUUID();
const token = signJwt({
  id: actorId,
  email: `transfer.receiving.itest.${Date.now()}@smartbook.local`,
  full_name: 'Transfer Receiving Test Admin',
  is_superuser: true,
  permissions: ['inventory.task.read', 'inventory.task.progress'],
  roles: ['ADMIN'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
}, jwtSecret);

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
async function ok(method, path, body) {
  const r = await request(method, path, body);
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

function sql(query) {
  const out = execFileSync('docker', [
    'compose', 'exec', '-T', 'db',
    'psql', '-U', process.env.DB_USER || 'user', '-d', 'inventory_db', '-t', '-A', '-F,', '-c', query,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map((line) => line.split(','));
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${condition || !detail ? '' : ` -- ${detail}`}`);
}

async function main() {
  const warehouses = await ok('GET', '/api/warehouses');
  const active = warehouses.filter((w) => w.is_active !== false);
  if (active.length < 2) throw new Error('Need at least 2 active warehouses');
  const [fromWarehouse, toWarehouse] = active;
  const books = await ok('GET', '/api/books');
  const book = books.find((b) => b?.variant_id);
  if (!book) throw new Error('No catalogue variant found');

  // One transfer order per scenario, each with distinct lines. Line A and B of the same
  // order deliberately share NO variant for scenario 1/2/3, and order 4 has two lines with
  // the SAME variant_id (to prove the per-line fix doesn't break the normal multi-line case).
  function makeOrder(n) {
    return { id: crypto.randomUUID(), number: `TRF-ITEST-${Date.now()}-${n}` };
  }
  const oDup = makeOrder(1);
  const oEmpty = makeOrder(2);
  const oOmitted = makeOrder(3);
  const oSameVariantTwice = makeOrder(4);

  const lineDup = crypto.randomUUID();
  const lineEmpty = crypto.randomUUID();
  const lineOmitted = crypto.randomUUID();
  const lineSameA = crypto.randomUUID();
  const lineSameB = crypto.randomUUID();

  for (const o of [oDup, oEmpty, oOmitted, oSameVariantTwice]) {
    sql(`INSERT INTO transfer_orders (id, transfer_number, from_warehouse_id, to_warehouse_id, status, requested_by_user_id)
         VALUES ('${o.id}', '${o.number}', '${fromWarehouse.id}', '${toWarehouse.id}', 'IN_TRANSIT', '${actorId}')`);
  }
  sql(`INSERT INTO transfer_order_items (id, transfer_order_id, variant_id, quantity, shipped_qty, unit_cost) VALUES
       ('${lineDup}', '${oDup.id}', '${book.variant_id}', 10, 10, 50000)`);
  sql(`INSERT INTO transfer_order_items (id, transfer_order_id, variant_id, quantity, shipped_qty, unit_cost) VALUES
       ('${lineEmpty}', '${oEmpty.id}', '${book.variant_id}', 10, 10, 50000)`);
  sql(`INSERT INTO transfer_order_items (id, transfer_order_id, variant_id, quantity, shipped_qty, unit_cost) VALUES
       ('${lineOmitted}', '${oOmitted.id}', '${book.variant_id}', 10, 10, 50000)`);
  sql(`INSERT INTO transfer_order_items (id, transfer_order_id, variant_id, quantity, shipped_qty, unit_cost) VALUES
       ('${lineSameA}', '${oSameVariantTwice.id}', '${book.variant_id}', 6, 6, 50000),
       ('${lineSameB}', '${oSameVariantTwice.id}', '${book.variant_id}', 4, 4, 50000)`);

  // A. Duplicate transfer_order_item_id in the payload must be rejected, not double-counted.
  const dupResp = await request('POST', `/api/transfer-receiving/${oDup.id}/confirm`, {
    items: [
      { transfer_order_item_id: lineDup, delivered_qty: 10 },
      { transfer_order_item_id: lineDup, delivered_qty: 10 },
    ],
  });
  check(
    'duplicate transfer_order_item_id is rejected (400), not accumulated into double the shipped qty',
    dupResp.status === 400 && /lặp/i.test(dupResp.data?.message || ''),
    `status=${dupResp.status} body=${JSON.stringify(dupResp.data)}`,
  );
  const [[dupOrderStatus]] = sql(`SELECT status FROM transfer_orders WHERE id = '${oDup.id}'`);
  check('rejected duplicate payload leaves the order still IN_TRANSIT (not silently posted)', dupOrderStatus === 'IN_TRANSIT', dupOrderStatus);

  // B. items: [] must be rejected, not treated as "receive in full".
  const emptyResp = await request('POST', `/api/transfer-receiving/${oEmpty.id}/confirm`, { items: [] });
  check(
    'items: [] is rejected (400), not silently treated as "received in full"',
    emptyResp.status === 400,
    `status=${emptyResp.status} body=${JSON.stringify(emptyResp.data)}`,
  );
  const [[emptyOrderStatus]] = sql(`SELECT status FROM transfer_orders WHERE id = '${oEmpty.id}'`);
  check('rejected empty-items payload leaves the order still IN_TRANSIT', emptyOrderStatus === 'IN_TRANSIT', emptyOrderStatus);

  // Baseline: omitting items entirely is unchanged behaviour - receive in full.
  const omittedResp = await ok('POST', `/api/transfer-receiving/${oOmitted.id}/confirm`, {});
  check('omitting items entirely still receives in full (unchanged default)', omittedResp.data?.status === 'RECEIVED');
  const [[omittedReceivedQty]] = sql(`SELECT received_qty FROM transfer_order_items WHERE id = '${lineOmitted}'`);
  check(
    'C: received_qty is synced to the full shipped_qty when items is omitted (was always 0 before this fix)',
    Number(omittedReceivedQty) === 10,
    `received_qty=${omittedReceivedQty}`,
  );

  // C + normal multi-line case: two lines, same variant_id, each counted with some damage.
  const sameVariantResp = await ok('POST', `/api/transfer-receiving/${oSameVariantTwice.id}/confirm`, {
    items: [
      { transfer_order_item_id: lineSameA, delivered_qty: 6, damaged_qty: 1 },
      { transfer_order_item_id: lineSameB, delivered_qty: 4 },
    ],
  });
  check('two lines sharing a variant_id, both counted, are both accepted', sameVariantResp.data?.status === 'RECEIVED');
  const [[lineAQty], [lineBQty]] = sql(
    `SELECT received_qty FROM transfer_order_items WHERE id = '${lineSameA}'`,
  ).concat(sql(`SELECT received_qty FROM transfer_order_items WHERE id = '${lineSameB}'`));
  check('C: line A (6 delivered, 1 damaged) received_qty = accepted = 5, not 6 and not the other line\'s value', Number(lineAQty) === 5, `received_qty=${lineAQty}`);
  check('C: line B (4 delivered, 0 damaged) received_qty = accepted = 4, tracked independently of line A', Number(lineBQty) === 4, `received_qty=${lineBQty}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('FAILED:', failed.map((r) => r.name).join('; '));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Script error:', error);
  process.exitCode = 1;
});
