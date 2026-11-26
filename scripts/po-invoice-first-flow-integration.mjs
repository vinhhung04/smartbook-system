// Live E2E of the invoice-first purchasing flow (2026-11-25):
// PO of typed books (one not in the catalog, no price) -> supplier proposes qty + price ->
// SmartBook rejects, supplier re-proposes, SmartBook approves -> supplier invoice at the approved
// price (draft, edit, send) -> SmartBook rejects / approves invoices -> delivery notes against the
// approved invoice in two shipments -> link the new book at receiving -> post receipts.
// Run against the local stack: node scripts/po-invoice-first-flow-integration.mjs
import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const adminUser = process.env.PURCHASE_TEST_USERNAME || 'hung';
const supplierUser = process.env.SUPPLIER_TEST_USERNAME || 'supplier-sv';
const password = process.env.PURCHASE_TEST_PASSWORD || '123456';

async function request(method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function ok(method, path, token, body) {
  const result = await request(method, path, token, body);
  if (result.status >= 300) throw new Error(`${method} ${path} failed (${result.status}): ${JSON.stringify(result.data)}`);
  return result.data;
}

async function refused(method, path, token, body, expectedStatus, label) {
  const result = await request(method, path, token, body);
  if (result.status !== expectedStatus) throw new Error(`${label}: expected ${expectedStatus}, got ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

let passed = 0;
function pass(name) {
  passed += 1;
  console.log(`PASS ${name}`);
}

async function login(identifier) {
  const { status, data } = await request('POST', '/auth/login', null, { identifier, password });
  expect(status === 200 && data.token, `login ${identifier} failed (${status})`);
  return data.token;
}

async function setup(token, supplierToken) {
  const account = await ok('GET', '/api/supplier-account/orders', supplierToken);
  const supplierId = account.data.supplier.id;
  const warehouses = await ok('GET', '/api/warehouses', token);
  let warehouse = null;
  let location = null;
  for (const candidate of warehouses.filter((w) => w.is_active !== false)) {
    const res = await ok('GET', `/api/warehouses/${candidate.id}/locations`, token);
    const rows = res.locations || res.data || res;
    location = (Array.isArray(rows) ? rows : []).find((l) => l.location_type === 'RECEIVING') || (Array.isArray(rows) ? rows : []).find((l) => l.is_active);
    if (location) { warehouse = candidate; break; }
  }
  expect(warehouse && location, 'need a warehouse with a receiving location');
  const books = (await ok('GET', '/api/books', token)).filter((b) => b.variant_id);
  expect(books.length >= 2, 'need two catalog variants');
  return { supplierId, warehouse, location, catalogBook: books[0], linkTarget: books[1] };
}

const fulfillment = async (token, poId) => (await ok('GET', `/api/purchase-orders/${poId}/invoice-fulfillment`, token)).data;
const accountOrder = async (supplierToken, poId) =>
  (await ok('GET', '/api/supplier-account/orders', supplierToken)).data.orders.find((o) => o.purchase_order.id === poId);

async function receiveDelivery(token, ctx, deliveryId) {
  const delivery = (await ok('GET', `/api/supplier-deliveries/${deliveryId}`, token)).data;
  const created = await ok('POST', `/api/supplier-deliveries/${deliveryId}/create-goods-receipt`, token, {
    warehouse_id: ctx.warehouse.id,
    note: 'invoice-first integration',
    items: delivery.items.map((item) => ({
      invoice_item_id: item.id,
      purchase_order_item_id: item.purchase_order_item_id,
      variant_id: item.variant_id,
      delivered_qty: item.invoiced_qty,
      unit_cost: item.unit_cost,
      location_id: ctx.location.id,
    })),
  });
  return created.data.id;
}

async function run() {
  const token = await login(adminUser);
  const supplierToken = await login(supplierUser);
  const ctx = await setup(token, supplierToken);
  const tag = crypto.randomBytes(3).toString('hex').toUpperCase();
  const year = new Date().getFullYear();

  // ── C: purchase order of typed books, no price ─────────────────────────────
  const base = { supplier_id: ctx.supplierId, warehouse_id: ctx.warehouse.id, note: `invoice-first ${tag}` };
  await refused('POST', '/api/purchase-orders', token, { ...base, items: [{ title: 'X', book_code: 'X1', author: 'A', publish_year: year, ordered_qty: 0 }] }, 400, 'qty 0');
  await refused('POST', '/api/purchase-orders', token, { ...base, items: [{ title: 'X', book_code: 'X1', publish_year: year, ordered_qty: 1 }] }, 400, 'missing author');
  pass('C: PO rejects quantity 0 and a missing author');

  const created = await ok('POST', '/api/purchase-orders', token, {
    ...base,
    items: [
      { variant_id: ctx.catalogBook.variant_id, title: ctx.catalogBook.title, book_code: `CAT-${tag}`, author: 'Tác giả có sẵn', publish_year: year, ordered_qty: 10 },
      { title: `Sách mới ${tag}`, book_code: `NCC-${tag}`, author: 'Tác giả mới', publish_year: year - 1, ordered_qty: 8 },
    ],
  });
  const poId = created.data.id;
  let po = await ok('GET', `/api/purchase-orders/${poId}`, token);
  const [lineA, lineB] = [po.items.find((i) => i.variant_id), po.items.find((i) => !i.variant_id)];
  expect(po.procurement_flow === 'INVOICE_FIRST', 'new PO must be INVOICE_FIRST');
  expect(lineA && lineB && !lineB.linked_to_catalog, 'one catalog line and one typed line');
  expect(lineB.title === `Sách mới ${tag}` && lineB.item_code === `NCC-${tag}`, 'typed snapshot stored as entered');
  expect(po.items.every((i) => i.unit_cost === 0), 'no price at PO creation');
  pass('C10-13: PO with a catalog book and a book not in the catalog, no unit price');

  await ok('POST', `/api/purchase-orders/${poId}/submit`, token);
  const sent = await ok('POST', `/api/purchase-orders/${poId}/send-to-supplier`, token);
  const portalToken = sent.data.portal_token;

  const portal = (await ok('GET', `/api/supplier-portal/orders/${portalToken}`, null)).data;
  expect(portal.account_required_message, 'emailed link must point new-flow POs to the account portal');
  await refused('POST', `/api/supplier-portal/orders/${portalToken}/confirm`, null, {}, 409, 'one-click confirm on token portal');
  await refused('POST', `/api/supplier-portal/orders/${portalToken}/invoices`, null, { delivery_number: `T-${tag}`, items: [{ purchase_order_item_id: lineA.id, invoiced_qty: 1, unit_cost: 1 }] }, 403, 'token portal delivery');
  await refused('POST', `/api/supplier-account/orders/${poId}/confirm`, supplierToken, {}, 409, 'one-click confirm on account');
  pass('C: emailed link is read-only for new-flow POs; one-click confirm refused');

  // ── C14: supplier proposal ─────────────────────────────────────────────────
  await refused('POST', `/api/supplier-account/orders/${poId}/respond`, supplierToken, {
    decision: 'ACCEPTED', lines: [{ purchase_order_item_id: lineA.id, confirmed_qty: 10 }, { purchase_order_item_id: lineB.id, confirmed_qty: 8 }],
  }, 400, 'proposal without price');
  const proposal = {
    decision: 'PARTIALLY_ACCEPTED',
    reason: 'Chỉ còn 6 cuốn sách mới',
    lines: [
      { purchase_order_item_id: lineA.id, confirmed_qty: 10, confirmed_unit_cost: 50000 },
      { purchase_order_item_id: lineB.id, confirmed_qty: 6, confirmed_unit_cost: 30000 },
    ],
  };
  const first = await ok('POST', `/api/supplier-account/orders/${poId}/respond`, supplierToken, proposal);
  expect(first.data.review_status === 'PENDING_REVIEW', 'proposal waits for SmartBook');
  await refused('POST', `/api/supplier-account/orders/${poId}/documents`, supplierToken, {
    document_type: 'SALES_INVOICE', external_number: `HD-${tag}-0`, issue_date: new Date().toISOString().slice(0, 10),
    lines: JSON.stringify([{ purchase_order_item_id: lineA.id, quantity: 1 }]),
  }, 409, 'invoice before proposal approval');
  await ok('POST', `/api/purchase-orders/${poId}/supplier-responses/${first.data.id}/review`, token, { decision: 'REJECT', note: 'Giá sách mới cao' });
  const second = await ok('POST', `/api/supplier-account/orders/${poId}/respond`, supplierToken, proposal);
  await ok('POST', `/api/purchase-orders/${poId}/supplier-responses/${second.data.id}/review`, token, { decision: 'APPROVE' });
  po = await ok('GET', `/api/purchase-orders/${poId}`, token);
  const approvedB = po.items.find((i) => i.id === lineB.id);
  expect(po.status === 'SUPPLIER_CONFIRMED', `PO confirmed after approval (got ${po.status})`);
  expect(approvedB.requested_qty === 8 && approvedB.ordered_qty === 6 && approvedB.not_accepted_qty === 2, 'requested 8 / accepted 6 / not accepted 2');
  expect(approvedB.unit_cost === 30000, 'approved price applied');
  pass('C14: partial acceptance with price, SmartBook rejects then approves the re-proposal; 8 requested / 6 accepted / 2 not accepted');

  // ── D: invoice ──────────────────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const draft = await ok('POST', `/api/supplier-account/orders/${poId}/documents`, supplierToken, {
    document_type: 'SALES_INVOICE', external_number: `HD-${tag}-1`, issue_date: today, tax_rate: '0',
    lines: JSON.stringify([{ purchase_order_item_id: lineA.id, quantity: 10, unit_price: 1 }, { purchase_order_item_id: lineB.id, quantity: 6, unit_price: 1 }]),
  });
  expect(draft.data.status === 'DRAFT', 'invoice saved as draft');
  expect(draft.data.total_amount === 680000, `amount from approved prices: 10x50000 + 6x30000 (got ${draft.data.total_amount})`);
  await refused('POST', `/api/supplier-account/orders/${poId}/documents`, supplierToken, {
    document_type: 'SALES_INVOICE', external_number: `HD-${tag}-X`, issue_date: today, lines: JSON.stringify([{ purchase_order_item_id: lineA.id, quantity: 1 }]),
  }, 409, 'invoice over the accepted quantity');
  await ok('PATCH', `/api/supplier-account/documents/${draft.data.id}`, supplierToken, {
    external_number: `HD-${tag}-1B`, lines: [{ purchase_order_item_id: lineA.id, quantity: 10 }, { purchase_order_item_id: lineB.id, quantity: 6 }],
  });
  await ok('POST', `/api/supplier-account/documents/${draft.data.id}/issue`, supplierToken);
  pass('D15-16: draft at approved price (680.000), quantity cap enforced, draft edited, sent without a file');

  const invoiceOneOrder = await accountOrder(supplierToken, poId);
  expect(invoiceOneOrder.invoice_fulfillment?.length === 1, 'supplier sees the sent invoice');
  await refused('POST', `/api/supplier-account/orders/${poId}/invoices`, supplierToken, {
    delivery_number: `PG-${tag}-0`, invoice_document_id: draft.data.id, items: [{ purchase_order_item_id: lineA.id, invoiced_qty: 1 }],
  }, 409, 'delivery against an unapproved invoice');
  await refused('PATCH', `/api/supplier-account/documents/${draft.data.id}`, supplierToken, { external_number: 'Z' }, 409, 'edit a sent invoice');
  await ok('POST', `/api/procurement-documents/${draft.data.id}/approval`, token, { decision: 'REJECT', note: 'Sai ngày lập' });
  const invoice = await ok('POST', `/api/supplier-account/orders/${poId}/documents`, supplierToken, {
    document_type: 'SALES_INVOICE', external_number: `HD-${tag}-2`, issue_date: today, issue: true,
    lines: JSON.stringify([{ purchase_order_item_id: lineA.id, quantity: 10 }, { purchase_order_item_id: lineB.id, quantity: 6 }]),
  });
  expect(invoice.data.approval_status === 'PENDING_APPROVAL', 'sent invoice waits for approval');
  await ok('POST', `/api/procurement-documents/${invoice.data.id}/approval`, token, { decision: 'APPROVE' });
  await refused('POST', `/api/procurement-documents/${invoice.data.id}/approval`, token, { decision: 'APPROVE' }, 409, 'approve twice');
  pass('D17-19: unapproved invoice blocks delivery, sent invoice is locked, rejected invoice frees quantity, approved once');

  // ── E: deliveries in several shipments ─────────────────────────────────────
  const ship = (number, a, b) => request('POST', `/api/supplier-account/orders/${poId}/invoices`, supplierToken, {
    delivery_number: number, invoice_document_id: invoice.data.id, carrier_name: 'GHN', tracking_number: `VD-${number}`,
    expected_delivery_date: today,
    items: [
      ...(a ? [{ purchase_order_item_id: lineA.id, invoiced_qty: a }] : []),
      ...(b ? [{ purchase_order_item_id: lineB.id, invoiced_qty: b }] : []),
    ],
  });
  const d1 = await ship(`PG-${tag}-1`, 4, 2);
  expect(d1.status === 201, `first delivery created (${d1.status} ${JSON.stringify(d1.data)})`);
  const over = await ship(`PG-${tag}-X`, 7, 0);
  expect(over.status === 409, `over-shipping refused (${over.status})`);
  let progress = (await fulfillment(token, poId)).find((f) => f.invoice_id === invoice.data.id);
  expect(progress.status === 'IN_TRANSIT' && progress.received_qty === 0 && progress.in_transit_qty === 6, 'shipped but not received is in transit');
  pass('E23-24: shipping beyond the invoice refused; 6 shipped books stay "in transit", not delivered');

  const blocked = await request('POST', `/api/supplier-deliveries/${d1.data.data.id}/create-goods-receipt`, token, {
    warehouse_id: ctx.warehouse.id, items: [{ purchase_order_item_id: lineA.id, delivered_qty: 4, location_id: ctx.location.id }],
  });
  expect(blocked.status === 409 && blocked.data.code === 'PO_LINE_NOT_LINKED', `receiving needs the new book linked first (${blocked.status})`);
  await ok('POST', `/api/supplier-deliveries/${d1.data.data.id}/link-item`, token, { purchase_order_item_id: lineB.id, variant_id: ctx.linkTarget.variant_id });
  po = await ok('GET', `/api/purchase-orders/${poId}`, token);
  expect(po.items.find((i) => i.id === lineB.id).title === `Sách mới ${tag}`, 'ordered snapshot kept after linking');
  pass('E: new book linked to the catalog at receiving; the PO keeps the title as ordered');

  const stockBefore = (await ok('GET', '/api/books', token)).find((b) => b.variant_id === ctx.catalogBook.variant_id)?.quantity;
  const grn1 = await receiveDelivery(token, ctx, d1.data.data.id);
  await ok('PATCH', `/api/goods-receipts/${grn1}`, token, { status: 'POSTED' });
  const repost = await request('PATCH', `/api/goods-receipts/${grn1}`, token, { status: 'POSTED' });
  po = await ok('GET', `/api/purchase-orders/${poId}`, token);
  expect(po.items.find((i) => i.id === lineA.id).received_qty === 4, `posting twice must not double count (repost ${repost.status})`);
  progress = (await fulfillment(token, poId)).find((f) => f.invoice_id === invoice.data.id);
  const byLine = Object.fromEntries(progress.lines.map((l) => [l.purchase_order_item_id, l]));
  expect(progress.status === 'PARTIALLY_RECEIVED', 'partially received');
  expect(byLine[lineA.id].received_qty === 4 && byLine[lineA.id].missing_qty === 6, 'A 4/10, 6 missing');
  expect(byLine[lineB.id].received_qty === 2 && byLine[lineB.id].missing_qty === 4, 'B 2/6, 4 missing');
  pass('E21/25/27: first shipment received 4/10 and 2/6; reposting does not add stock twice');

  // two notes for the same remaining quantity at the same instant: the invoice row lock lets one through
  const race = await Promise.all([ship(`PG-${tag}-2`, 6, 4), ship(`PG-${tag}-2B`, 6, 4)]);
  const d2 = race.find((r) => r.status === 201);
  expect(d2 && race.filter((r) => r.status === 201).length === 1 && race.some((r) => r.status === 409), `exactly one concurrent delivery wins (${race.map((r) => r.status)})`);
  pass('E: concurrent delivery notes for the same remaining quantity - exactly one accepted');
  const grn2 = await receiveDelivery(token, ctx, d2.data.data.id);
  await ok('PATCH', `/api/goods-receipts/${grn2}`, token, { status: 'POSTED' });
  progress = (await fulfillment(token, poId)).find((f) => f.invoice_id === invoice.data.id);
  expect(progress.status === 'RECEIVED' && progress.missing_qty === 0, 'invoice fully received');
  const supplierView = (await accountOrder(supplierToken, poId)).invoice_fulfillment.find((f) => f.invoice_id === invoice.data.id);
  expect(supplierView.status === 'RECEIVED', 'supplier sees the same completed status');
  po = await ok('GET', `/api/purchase-orders/${poId}`, token);
  expect(po.status === 'RECEIVED', `PO received (got ${po.status})`);
  const stockAfter = (await ok('GET', '/api/books', token)).find((b) => b.variant_id === ctx.catalogBook.variant_id)?.quantity;
  if (typeof stockBefore === 'number' && typeof stockAfter === 'number') {
    expect(stockAfter - stockBefore === 10, `stock of book A grew by exactly 10 (got ${stockAfter - stockBefore})`);
  }
  const late = await ship(`PG-${tag}-3`, 1, 0);
  // a fully received PO refuses any further delivery note (status gate 400, or the invoice cap 409)
  expect([400, 409].includes(late.status), `nothing left to ship (${late.status} ${JSON.stringify(late.data)})`);
  console.log(`  late shipment refused: ${late.status} ${late.data.message}`);
  pass('E22/26: two books, two shipments -> 10/10 and 6/6, completed for SmartBook and supplier; no further shipping');

  console.log(`\n${passed} checks passed. PO ${po.po_number}`);
}

run().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
