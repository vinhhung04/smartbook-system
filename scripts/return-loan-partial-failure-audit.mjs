// STT5 reconciliation regression: when returning several books in one request and the
// SECOND item's remote inventory call fails, does the FIRST item's already-returned state
// get reconciled (queued) or silently lost (stock moved in inventory-service, but
// loan_items.status locally still BORROWED, with no reconciliation record)?
//
// The second item's remote call is forced to fail by corrupting its loan_items.variant_id
// to a nonexistent UUID via direct SQL after the loan is created - inventory-service's
// /api/borrow-integration/loans/return must reject an unknown variant.
//
// Usage: node scripts/return-loan-partial-failure-audit.mjs
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { shelfPicks, returnToShelf } from './lib/borrow-shelves.mjs';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const jwtSecret = process.env.JWT_SECRET || 'smartbook_shared_jwt_secret';

function b64url(input) { return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${signingInput}.${signature}`;
}
const token = signJwt({
  id: crypto.randomUUID(),
  email: `return.partial.itest.${Date.now()}@smartbook.local`,
  full_name: 'Return Partial Failure Audit',
  is_superuser: true,
  permissions: ['borrow.read', 'borrow.write'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 4 * 60 * 60,
}, jwtSecret);

async function request(method, path, body, extraHeaders = {}) {
  const r = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extraHeaders },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
async function ok(method, path, body, extraHeaders) {
  const r = await request(method, path, body, extraHeaders);
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

function sqlBorrow(query) {
  const out = execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER || 'user', '-d', 'borrow_db', '-t', '-A', '-F,', '-c', query], { cwd: process.cwd(), encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map((l) => l.split(','));
}

async function main() {
  const customer = await ok('POST', '/borrow/customers', { full_name: `Return Partial Test ${Date.now()}` });
  const customerId = customer.data.id;
  for (let i = 0; i < 4; i += 1) {
    await ok('POST', `/borrow/customers/${customerId}/account/topups`, { amount: 200000, method: 'CASH', note: 'fixture' }, { 'Idempotency-Key': crypto.randomUUID() });
  }

  // /api/books' `quantity` field reports on_hand, not truly-available stock, which after
  // many hours of other tests in this same environment can be far lower than on_hand for
  // the usual high-stock picks - query stock_balances directly instead.
  function sqlInventory(query) {
    const out = execFileSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', process.env.DB_USER || 'user', '-d', 'inventory_db', '-t', '-A', '-F,', '-c', query], { cwd: process.cwd(), encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean).map((l) => l.split(','));
  }
  const stockRows = sqlInventory("SELECT variant_id, warehouse_id, available_qty FROM stock_balances WHERE available_qty >= 20 ORDER BY available_qty DESC LIMIT 1");
  if (stockRows.length === 0) throw new Error('Need a variant/warehouse with >= 20 truly available');
  const [variantId, warehouseId] = stockRows[0];

  // "One loan, 3 books, item 2 fails": borrow 3 units of one variant in a single call (one
  // loan_transactions row, 3 loan_items), then corrupt the SECOND loan_item's variant_id so
  // its own remote return call fails while item 1's succeeds first.
  const bulk = { variant_id: variantId, default_warehouse_id: warehouseId };
  const get = (path) => ok('GET', path);
  const bulkLoan = await ok('POST', '/borrow/loans/direct', {
    customer_id: customerId, variant_id: bulk.variant_id, warehouse_id: bulk.default_warehouse_id, quantity: 3,
    picks: await shelfPicks(get, { variantId: bulk.variant_id, warehouseId: bulk.default_warehouse_id, quantity: 3 }),
  }, { 'Idempotency-Key': crypto.randomUUID() });
  // Same body on the retry below (same key must carry the same request).
  const returnBody = await returnToShelf(get, bulkLoan.data.id);
  const loanDetail = await ok('GET', `/borrow/loans/${bulkLoan.data.id}`);
  const items = [...(loanDetail.data.loan_items || loanDetail.loan_items)].sort((a, b) => a.id.localeCompare(b.id));
  console.log(`3-book loan ${bulkLoan.data.id}, items: ${items.map((i) => i.id).join(', ')}`);

  const targetItem = items[1]; // "the second item"
  const bogusVariantId = crypto.randomUUID();
  sqlBorrow(`UPDATE loan_items SET variant_id = '${bogusVariantId}' WHERE id = '${targetItem.id}'`);
  console.log(`Corrupted item 2 (${targetItem.id}) to a nonexistent variant_id so its remote return call must fail.`);

  try {
    const returnKey = crypto.randomUUID();
    const returnResp = await request('POST', `/borrow/loans/${bulkLoan.data.id}/return`, returnBody, { 'Idempotency-Key': returnKey });
    console.log(`\nreturn all 3 -> status=${returnResp.status}`);
    console.log(`  body: ${JSON.stringify(returnResp.data).slice(0, 300)}`);

    const itemStatuses = sqlBorrow(`SELECT id, status FROM loan_items WHERE loan_id = '${bulkLoan.data.id}' ORDER BY id`);
    console.log('\nloan_items status after the failed call:');
    for (const [id, status] of itemStatuses) console.log(`  ${id} -> ${status}`);
    const item1Status = itemStatuses.find(([id]) => id === items[0].id)?.[1];
    console.log(`\nItem 1 (should have returned successfully in inventory-service before item 2 failed): local status = ${item1Status}`);

    const outboxRows = sqlBorrow(`SELECT event_type, payload FROM integration_outbox WHERE aggregate_id = '${bulkLoan.data.id}' AND event_type = 'LOAN_RETURN_UNRESOLVED'`);
    assert.ok(returnResp.status >= 400, 'the injected second-item failure must fail the return');
    assert.equal(outboxRows.length, 1, 'the first successful remote return must be queued exactly once');
    const queued = sqlBorrow(`SELECT payload->'loan_item_ids' ? '${items[0].id}' AS includes_first FROM integration_outbox WHERE aggregate_id = '${bulkLoan.data.id}' AND event_type = 'LOAN_RETURN_UNRESOLVED'`);
    assert.equal(queued[0]?.[0], 't', 'reconciliation must name the item whose remote stock already moved');
    console.log(`\nintegration_outbox rows for LOAN_RETURN_UNRESOLVED on this loan: ${outboxRows.length}`);
    if (outboxRows.length > 0) console.log(`  ${JSON.stringify(outboxRows)}`);

    sqlBorrow(`UPDATE loan_items SET variant_id = '${variantId}' WHERE id = '${targetItem.id}'`);
    const recovered = await request('POST', `/borrow/loans/${bulkLoan.data.id}/return`, returnBody, { 'Idempotency-Key': returnKey });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.data));
    const final = sqlBorrow(`SELECT status FROM loan_items WHERE loan_id = '${bulkLoan.data.id}'`);
    assert.ok(final.every(([status]) => status === 'RETURNED'));
    const resolved = sqlBorrow(`SELECT status FROM integration_outbox WHERE aggregate_id = '${bulkLoan.data.id}' AND event_type = 'LOAN_RETURN_UNRESOLVED'`);
    assert.ok(resolved.every(([status]) => status === 'PUBLISHED'));
    console.log('PASS partial remote success is queued; same-key retry recovers all copies and closes reconciliation.');
  } finally {
    sqlBorrow(`UPDATE loan_items SET variant_id = '${variantId}' WHERE id = '${targetItem.id}'`);
  }

}

main().catch((error) => {
  console.error('Script error:', error);
  process.exitCode = 1;
});
