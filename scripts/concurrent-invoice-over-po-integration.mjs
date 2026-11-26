// P0.2 check: total invoiced_qty (delivery-note quantity) across a PO's active delivery notes
// must never exceed ordered_qty, even when no GRN has been posted yet (so received_qty is still
// 0 for every check). The old check compared invoicedQty against (ordered_qty - received_qty),
// which let two 80-unit notes both pass on a 100-unit line since neither had been received.
// This script proves both the sequential case and the "two notes submitted at the same instant"
// race (P0.9).
//
// Usage: node scripts/concurrent-invoice-over-po-integration.mjs
import { acceptAtPrice, approvedInvoice, supplierIdOf } from './lib/invoice-first-po.mjs';

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

async function setupPo(M, supplier, warehouse, book, orderedQty, unitCost, note) {
  const created = await ok('POST', '/api/purchase-orders', M, {
    supplier_id: supplier.id,
    warehouse_id: warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note,
    items: [{ variant_id: book.variant_id, ordered_qty: orderedQty, unit_cost: unitCost }],
  });
  const poId = created.data.id;
  await ok('POST', `/api/purchase-orders/${poId}/submit`, M);
  await ok('POST', `/api/purchase-orders/${poId}/send-to-supplier`, M);
  const po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  return { poId, item: po.items[0] };
}

async function main() {
  const manager = await login(managerName);
  const supplierA = await login(supplierAName);
  const M = manager.token;

  const supplier = { id: await supplierIdOf(supplierA.token) };
  const warehouses = await ok('GET', '/api/warehouses', M);
  const warehouse = warehouses.find((row) => row.is_active !== false);
  const books = (await ok('GET', '/api/books', M)).filter((row) => row.variant_id);
  const book = books[books.length - 1];
  const unitCost = 50000;
  const orderedQty = 100;

  // ── Part 1: sequential — Invoice A (80) then Invoice B (80) on a 100-unit PO, no GRN posted ──
  const po1 = await setupPo(M, supplier, warehouse, book, orderedQty, unitCost, 'E2E invoice-over-PO sequential');
  await acceptAtPrice(M, supplierA.token, po1.poId, unitCost);
  const po1Invoice = await approvedInvoice(M, supplierA.token, po1.poId);

  const invA = await ok('POST', `/api/supplier-account/orders/${po1.poId}/invoices`, supplierA.token, {
    delivery_number: `DN-A-${Date.now()}`,
    invoice_document_id: po1Invoice.id,
    items: [{ purchase_order_item_id: po1.item.id, invoiced_qty: 80 }],
  });
  check('Invoice A (80 of 100) accepted', Boolean(invA.data?.id));

  const invB = await request('POST', `/api/supplier-account/orders/${po1.poId}/invoices`, supplierA.token, {
    delivery_number: `DN-B-${Date.now()}`,
    invoice_document_id: po1Invoice.id,
    items: [{ purchase_order_item_id: po1.item.id, invoiced_qty: 80 }],
  });
  check(
    'Invoice B (another 80, combined 160 > 100) is rejected, not silently accepted',
    invB.response.status === 409 && /vượt số lượng/i.test(invB.data?.message || ''),
    `status=${invB.response.status} message=${invB.data?.message}`,
  );

  const invB20 = await ok('POST', `/api/supplier-account/orders/${po1.poId}/invoices`, supplierA.token, {
    delivery_number: `DN-B20-${Date.now()}`,
    invoice_document_id: po1Invoice.id,
    items: [{ purchase_order_item_id: po1.item.id, invoiced_qty: 20 }],
  });
  check('A second note for exactly the remaining 20 (80+20=100) is accepted', Boolean(invB20.data?.id));

  // ── Part 2: concurrency — two fresh 60-unit notes on a fresh 100-unit PO, fired at once ──
  const po2 = await setupPo(M, supplier, warehouse, book, orderedQty, unitCost, 'E2E invoice-over-PO concurrency');
  await acceptAtPrice(M, supplierA.token, po2.poId, unitCost);
  const po2Invoice = await approvedInvoice(M, supplierA.token, po2.poId);

  const [resA, resB] = await Promise.all([
    request('POST', `/api/supplier-account/orders/${po2.poId}/invoices`, supplierA.token, {
      delivery_number: `DN-RACE-A-${Date.now()}`,
      invoice_document_id: po2Invoice.id,
    items: [{ purchase_order_item_id: po2.item.id, invoiced_qty: 60 }],
    }),
    request('POST', `/api/supplier-account/orders/${po2.poId}/invoices`, supplierA.token, {
      delivery_number: `DN-RACE-B-${Date.now()}`,
      invoice_document_id: po2Invoice.id,
    items: [{ purchase_order_item_id: po2.item.id, invoiced_qty: 60 }],
    }),
  ]);
  const succeeded = [resA, resB].filter((r) => r.response.ok);
  check(
    'concurrent invoices: exactly one 60-unit note is accepted on a 100-unit line',
    succeeded.length === 1,
    `A=${resA.response.status} B=${resB.response.status}`,
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
