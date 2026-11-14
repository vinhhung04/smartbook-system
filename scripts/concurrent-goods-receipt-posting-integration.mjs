// P0.5 / P0.9 concurrency check: two staff/supplier actions racing to post/claim the same
// outstanding quantity on one PO must not together push received stock past what was ordered
// (or, here, past what was legitimately still owed).
//
// Note on scope (2026-11-14): this script originally built its race by creating two *ordinary*
// delivery notes whose declared quantities summed to more than ordered_qty, then posting both
// GRNs at once. That specific setup is no longer reachable through the API: the P0.2 fix
// (assertInvoiceQtyWithinRemaining in procurement-receipt.service.js) now rejects the second
// ordinary delivery note at creation time, which transitively makes that particular over-receipt
// path impossible (accepted qty on a GRN can never exceed its delivery note's declared qty, and
// declared qty across ordinary notes is now capped at ordered_qty). The remaining, still-real
// gap is the REDELIVERY path, which is deliberately excluded from that cap (a redelivery note
// re-declares quantity an earlier note already claimed but that was never accepted, so it must
// not be double-counted against ordered_qty) — so this script now races two redelivery notes
// against the same shortage report instead, which is the live P0.5/P0.9 exposure today.
//
// Usage: node scripts/concurrent-goods-receipt-posting-integration.mjs
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const password = process.env.PURCHASE_TEST_PASSWORD || '123456';
const managerName = process.env.PURCHASE_TEST_USERNAME || 'hung';
const supplierAName = process.env.SUPPLIER_TEST_USERNAME || 'supplier-sv';

async function request(method, path, token, body) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (body != null) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
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
  const books = (await ok('GET', '/api/books', M)).filter((row) => row.variant_id);
  const book = books[books.length - 1];
  const unitCost = 50000;
  const orderedQty = 100;

  const created = await ok('POST', '/api/purchase-orders', M, {
    supplier_id: supplier.id,
    warehouse_id: warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note: 'E2E concurrent redelivery race check',
    items: [{ variant_id: book.variant_id, ordered_qty: orderedQty, unit_cost: unitCost }],
  });
  const poId = created.data.id;
  await ok('POST', `/api/purchase-orders/${poId}/submit`, M);
  await ok('POST', `/api/purchase-orders/${poId}/approve`, M, { note: 'e2e' });
  await ok('POST', `/api/purchase-orders/${poId}/send-to-supplier`, M);
  await ok('POST', `/api/supplier-account/orders/${poId}/respond`, supplierA.token, { decision: 'ACCEPTED' });
  let po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  const item = po.items[0];

  // Ordinary delivery note for the full 100, but only 60 actually arrive -> 40 missing.
  const dn = (await ok('POST', `/api/supplier-account/orders/${poId}/invoices`, supplierA.token, {
    delivery_number: `DN-BASE-${Date.now()}`,
    items: [{ purchase_order_item_id: item.id, invoiced_qty: orderedQty, unit_cost: unitCost }],
  })).data;
  const dnDetail = (await ok('GET', `/api/supplier-deliveries/${dn.id}`, M)).data;
  const gr = (await ok('POST', `/api/supplier-deliveries/${dn.id}/create-goods-receipt`, M, {
    warehouse_id: warehouse.id,
    items: dnDetail.items.map((row) => ({ invoice_item_id: row.id, delivered_qty: 60, location_id: receivingLocation.id })),
  })).data;
  await ok('PATCH', `/api/goods-receipts/${gr.id}`, M, { status: 'POSTED' });
  po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  check('base delivery: 60 of 100 accepted, 40 missing', po.items[0].received_qty === 60, String(po.items[0].received_qty));

  const reports = (await ok('GET', `/api/purchase-orders/${poId}/shortage-reports`, M)).data;
  const report = reports.find((row) => row.goods_receipt_id === gr.id);
  check('shortage report opened for the missing 40', report?.status && Number(report.items?.[0]?.shortage_qty) === 40, JSON.stringify(report?.items));

  // The actual race: two redelivery notes for the SAME shortage report, each declaring the full
  // 40-unit shortfall, submitted at the same instant.
  const [resA, resB] = await Promise.all([
    request('POST', `/api/supplier-account/orders/${poId}/shortage-reports/${report.id}/redelivery-invoice`, supplierA.token, {
      delivery_number: `DN-REDEL-A-${Date.now()}`,
      items: [{ purchase_order_item_id: item.id, invoiced_qty: 40, unit_cost: unitCost }],
    }),
    request('POST', `/api/supplier-account/orders/${poId}/shortage-reports/${report.id}/redelivery-invoice`, supplierA.token, {
      delivery_number: `DN-REDEL-B-${Date.now()}`,
      items: [{ purchase_order_item_id: item.id, invoiced_qty: 40, unit_cost: unitCost }],
    }),
  ]);
  const succeeded = [resA, resB].filter((r) => r.response.ok);
  check(
    'concurrent redelivery: not both 40-unit redelivery notes accepted against a 40-unit shortfall',
    succeeded.length < 2,
    `A=${resA.response.status} B=${resB.response.status}`,
  );

  // Post whichever redelivery note(s) succeeded and confirm the PO never exceeds ordered_qty.
  for (const res of succeeded) {
    const dnR = res.data.data;
    const dnRDetail = (await ok('GET', `/api/supplier-deliveries/${dnR.id}`, M)).data;
    const grR = (await ok('POST', `/api/supplier-deliveries/${dnR.id}/create-goods-receipt`, M, {
      warehouse_id: warehouse.id,
      items: dnRDetail.items.map((row) => ({ invoice_item_id: row.id, delivered_qty: row.invoiced_qty, location_id: receivingLocation.id })),
    })).data;
    await ok('PATCH', `/api/goods-receipts/${grR.id}`, M, { status: 'POSTED' });
  }
  po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  check(
    'PO received_qty after the race does not exceed ordered_qty',
    po.items[0].received_qty <= orderedQty,
    `received=${po.items[0].received_qty} ordered=${orderedQty}`,
  );
  check(
    'exactly 100 received (60 base + 40 from the one redelivery that won) — no over-count, no under-count',
    po.items[0].received_qty === 100,
    `received=${po.items[0].received_qty}`,
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
