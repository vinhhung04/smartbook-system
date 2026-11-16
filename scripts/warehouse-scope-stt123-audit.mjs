// Audit/reproduction only (per the STT1/STT2/STT3 prompt) - does NOT assert pass/fail against
// an assumed-correct behaviour; it just reports exactly what the current code does, so the
// result can be classified CONFIRMED / NOT REPRODUCED / ALREADY FIXED against real evidence.
//
// Accounts used (from services/auth-service/prisma/seed.js, password 123456 for all):
//   hung       - full access to WH-HCM-01 / WH-HN-01 / BR-HCM-01 (fixture setup only)
//   curator01  - WAREHOUSE_MANAGER role, but only READ at WH-HCM-01, no scope at all at WH-HN-01
//   staff01    - WAREHOUSE_STAFF-level, OPERATOR (write) only at WH-HCM-01, no scope at WH-HN-01
//
// Usage: node scripts/warehouse-scope-stt123-audit.mjs
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const password = '123456';

async function request(method, path, token, body) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (body != null) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
async function ok(method, path, token, body) {
  const r = await request(method, path, token, body);
  if (r.status >= 400) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function login(identifier) {
  const r = await request('POST', '/auth/login', null, { identifier, password });
  if (r.status !== 200 || !r.data?.token) throw new Error(`login ${identifier} failed (${r.status}): ${JSON.stringify(r.data)}`);
  return { token: r.data.token, user: r.data.user };
}

function sql(query) {
  const out = execFileSync('docker', [
    'compose', 'exec', '-T', 'db',
    'psql', '-U', process.env.DB_USER || 'user', '-d', 'inventory_db', '-t', '-A', '-F,', '-c', query,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map((line) => line.split(','));
}

async function main() {
  const hung = await login('hung');
  const curator = await login('curator01');
  const staff = await login('staff01');

  const warehouses = await ok('GET', '/api/warehouses', hung.token);
  const whHcm = warehouses.find((w) => w.code === 'WH-HCM-01');
  const whHn = warehouses.find((w) => w.code === 'WH-HN-01');
  if (!whHcm || !whHn) throw new Error('WH-HCM-01 / WH-HN-01 not found');
  console.log(`WH-HCM-01=${whHcm.id}  WH-HN-01=${whHn.id}`);

  // ---- Fixture: a transfer order FROM HCM TO HN, IN_TRANSIT, via direct SQL
  // (bypasses the picking/ship pipeline, which is not what's under audit here). ----
  const books = await ok('GET', '/api/books', hung.token);
  const book = books.find((b) => b?.variant_id);
  const orderId = crypto.randomUUID();
  const lineId = crypto.randomUUID();
  sql(`INSERT INTO transfer_orders (id, transfer_number, from_warehouse_id, to_warehouse_id, status, requested_by_user_id)
       VALUES ('${orderId}', 'TRF-SCOPE-AUDIT-${Date.now()}', '${whHcm.id}', '${whHn.id}', 'IN_TRANSIT', '${crypto.randomUUID()}')`);
  sql(`INSERT INTO transfer_order_items (id, transfer_order_id, variant_id, quantity, shipped_qty, unit_cost)
       VALUES ('${lineId}', '${orderId}', '${book.variant_id}', 5, 5, 50000)`);

  console.log(`\nFixture transfer order ${orderId} (to WH-HN-01, IN_TRANSIT) created.\n`);

  // ---- STT1: GET /transfer-receiving/:id/lines as curator01 (no scope at all at WH-HN-01) ----
  const sttLines = await request('GET', `/api/transfer-receiving/${orderId}/lines`, curator.token);
  console.log(`STT1 — curator01 (no scope at WH-HN-01) GET .../lines -> status=${sttLines.status}`);
  console.log(`  body: ${JSON.stringify(sttLines.data).slice(0, 300)}`);
  console.log(`  => ${sttLines.status === 403 ? 'BLOCKED (protected)' : 'NOT BLOCKED (data returned despite no scope) — CONFIRMED if 200'}\n`);

  // ---- STT3: POST /transfer-receiving/:id/confirm as curator01 (WAREHOUSE_MANAGER role,
  // so canManageAssignment=true bypasses the assignment check, but zero WRITE scope anywhere
  // including WH-HN-01) ----
  const sttConfirm = await request('POST', `/api/transfer-receiving/${orderId}/confirm`, curator.token, {});
  console.log(`STT3 — curator01 (manager role, no WRITE scope at WH-HN-01) POST .../confirm -> status=${sttConfirm.status}`);
  console.log(`  body: ${JSON.stringify(sttConfirm.data).slice(0, 300)}`);
  const [[orderStatusAfter]] = sql(`SELECT status FROM transfer_orders WHERE id = '${orderId}'`);
  console.log(`  order status in DB after the call: ${orderStatusAfter}`);
  console.log(`  => ${sttConfirm.status === 403 ? 'BLOCKED (protected)' : (orderStatusAfter === 'RECEIVED' ? 'NOT BLOCKED — stock was actually posted — CONFIRMED' : 'NOT BLOCKED by warehouse scope, but failed for another reason')}\n`);

  // ---- STT2: POST /receiving-putaway/transfer as staff01 (WRITE only at WH-HCM-01) naming
  // warehouse_id = WH-HN-01 in the body. Uses plausible-but-nonexistent location/variant ids:
  // the diagnostic is whether the response carries WAREHOUSE_ACCESS_DENIED (scope check ran
  // first, as enforceRequestedWarehouseScope on req.body should do) or some other error (scope
  // check did not intercept it, business logic ran against a wrong warehouse instead). ----
  const bogusLocationId = crypto.randomUUID();
  const sttTransfer = await request('POST', '/api/receiving-putaway/transfer', staff.token, {
    warehouse_id: whHn.id,
    source_receiving_location_id: bogusLocationId,
    variant_id: book.variant_id,
    allocations: [{ target_location_id: crypto.randomUUID(), quantity: 1, reason: 'scope audit' }],
  });
  console.log(`STT2 — staff01 (write scope only at WH-HCM-01) POST .../receiving-putaway/transfer with warehouse_id=WH-HN-01 -> status=${sttTransfer.status}`);
  console.log(`  body: ${JSON.stringify(sttTransfer.data).slice(0, 300)}`);
  console.log(`  => ${sttTransfer.data?.code === 'WAREHOUSE_ACCESS_DENIED' ? 'BLOCKED by warehouse scope (protected)' : 'NOT blocked by warehouse scope (check the actual reason above)'}\n`);
}

main().catch((error) => {
  console.error('Script error:', error);
  process.exitCode = 1;
});
