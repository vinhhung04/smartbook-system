// P0.5 concurrency check: two warehouse-side POSTs of two DIFFERENT goods receipts for the
// SAME purchase order (same book), fired at the same time, must not together push the PO's
// received_qty past ordered_qty. This is the "two staff post two GRNs on the same PO at the
// same time" scenario — a TOCTOU race in applyPurchaseOrderReceipt() that a sequential test
// (post A, then post B) can never catch, because sequential calls never actually contend for
// the same purchase_order_items row.
//
// Usage: node scripts/concurrent-goods-receipt-posting-integration.mjs
import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const password = process.env.PURCHASE_TEST_PASSWORD || '123456';
const managerName = process.env.PURCHASE_TEST_USERNAME || 'hung';
const supplierAName = process.env.SUPPLIER_TEST_USERNAME || 'supplier-sv';

async function request(method, path, token, body) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function ok(method, path, token, body) {
  const result = await request(method, path, token, body);
  if (!result.response.ok) throw new Error(`${method} ${path} -> ${result.response.status} ${JSON.stringify(result.data)}`);
  return result.data;
}

async function login(identifier) {
  const { response, data } = await request('POST', '/auth/login', null, { identifier, password });
  if (!response.ok || !data?.token) throw new Error(`login ${identifier} failed (${response.status}): ${JSON.stringify(data)}`);
  return { token: data.token, user: data.user };
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${condition || !detail ? '' : ` -- ${detail}`}`);
}

async function main() {
  const manager = await login(managerName);
  const supplierA = await login(supplierAName);
  const M = manager.token;

  const suppliers = await ok('GET', '/api/suppliers', M);
  const supplier = suppliers.find((row) => String(row.email || '').toLowerCase() === String(supplierA.user.email || '').toLowerCase());
  check('fixture: supplier A record linked to supplier account', supplier?.id, supplierA.user.email);

  const warehouses = await ok('GET', '/api/warehouses', M);
  let warehouse = null;
  let receivingLocation = null;
  const preferredCode = process.env.E2E_WAREHOUSE_CODE || 'WH-HCM-01';
  const ordered = warehouses.filter((row) => row.is_active !== false).sort((a, b) => Number(b.code === preferredCode) - Number(a.code === preferredCode));
  for (const candidate of ordered) {
    const raw = await ok('GET', `/api/warehouses/${candidate.id}/locations`, M);
    const locations = raw.locations || raw.data || raw;
    receivingLocation = (Array.isArray(locations) ? locations : []).find((row) => row.location_type === 'RECEIVING');
    if (receivingLocation) { warehouse = candidate; break; }
  }
  check('fixture: warehouse with receiving location', warehouse?.id);

  const books = (await ok('GET', '/api/books', M)).filter((row) => row.variant_id);
  const book = books[books.length - 1];
  check('fixture: one catalogue variant', Boolean(book));
  const unitCost = 50000;
  const orderedQty = 100;
  const batchQty = 60; // 60 + 60 = 120 > 100: the two GRNs must not BOTH post in full.

  // PO: 100 copies of one book, approved and sent.
  const created = await ok('POST', '/api/purchase-orders', M, {
    supplier_id: supplier.id,
    warehouse_id: warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note: 'E2E concurrent GRN posting race check',
    items: [{ variant_id: book.variant_id, ordered_qty: orderedQty, unit_cost: unitCost }],
  });
  const poId = created.data.id;
  await ok('POST', `/api/purchase-orders/${poId}/submit`, M);
  await ok('POST', `/api/purchase-orders/${poId}/approve`, M, { note: 'e2e' });
  await ok('POST', `/api/purchase-orders/${poId}/send-to-supplier`, M);
  let po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  const item = po.items.find((row) => row.variant_id === book.variant_id);
  check('PO sent to supplier', po.status === 'SENT_TO_SUPPLIER', po.status);

  await ok('POST', `/api/supplier-account/orders/${poId}/respond`, supplierA.token, { decision: 'ACCEPTED' });

  // Two delivery batches of 60, both against the same PO line.
  const deliveries = [];
  for (const n of [1, 2]) {
    const dn = (await ok('POST', `/api/supplier-account/orders/${poId}/invoices`, supplierA.token, {
      delivery_number: `DN-RACE-${n}-${Date.now()}`,
      items: [{ purchase_order_item_id: item.id, invoiced_qty: batchQty, unit_cost: unitCost }],
    })).data;
    deliveries.push(dn);
  }
  check('fixture: two delivery batches of 60 created (combined 120 > ordered 100)', deliveries.length === 2);

  // One DRAFT GRN per delivery, each accepting the full 60 — created sequentially (creation
  // is not the race under test; posting is).
  const receipts = [];
  for (const dn of deliveries) {
    const detail = (await ok('GET', `/api/supplier-deliveries/${dn.id}`, M)).data;
    const gr = (await ok('POST', `/api/supplier-deliveries/${dn.id}/create-goods-receipt`, M, {
      warehouse_id: warehouse.id,
      items: detail.items.map((row) => ({ invoice_item_id: row.id, delivered_qty: batchQty, location_id: receivingLocation.id })),
    })).data;
    receipts.push(gr);
  }
  check('fixture: two DRAFT GRNs of 60 each, same PO line', receipts.length === 2 && receipts.every((r) => r.status === 'DRAFT'));

  // The actual race: POST both GRNs to POSTED in the same instant.
  const [postA, postB] = await Promise.all(
    receipts.map((gr) => request('PATCH', `/api/goods-receipts/${gr.id}`, M, { status: 'POSTED' })),
  );

  const succeeded = [postA, postB].filter((r) => r.response.ok);
  const rejected = [postA, postB].filter((r) => !r.response.ok);
  check(
    'concurrent posting: not both GRNs posted in full (one must be rejected or short-filled)',
    succeeded.length < 2,
    `A=${postA.response.status} B=${postB.response.status}`,
  );
  if (rejected.length > 0) {
    check(
      'the rejected POST failed with the expected over-received error, not a generic 500',
      rejected.every((r) => r.response.status === 400 && /vượt số lượng/i.test(r.data?.message || '')),
      JSON.stringify(rejected.map((r) => [r.response.status, r.data?.message])),
    );
  }

  po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  const finalItem = po.items.find((row) => row.id === item.id);
  check(
    'PO received_qty after the race does not exceed ordered_qty (no stock over-posting)',
    finalItem.received_qty <= orderedQty,
    `received=${finalItem.received_qty} ordered=${orderedQty}`,
  );
  check(
    'exactly one batch of 60 made it through — no partial corruption, no double count',
    finalItem.received_qty === batchQty,
    `received=${finalItem.received_qty} expected=${batchQty}`,
  );

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
