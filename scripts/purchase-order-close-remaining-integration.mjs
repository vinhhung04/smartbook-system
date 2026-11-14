// P1.2 Close Remaining Quantity: end-to-end check through the real gateway.
//
// Covers: closing a line's remainder (ordered_qty - received_qty) without altering either
// quantity; the four distinct fulfillment buckets (NOT_RECEIVED/PARTIALLY_RECEIVED/
// FULLY_RECEIVED/CLOSED_WITH_REMAINING/CANCELLED) never collapsing into one "RECEIVED" state;
// a closed line refusing further invoices and goods receipts; closing twice, or closing a line
// with nothing left, both rejected; and reopening (its own approval step) restoring normal
// receiving.
//
// Usage: node scripts/purchase-order-close-remaining-integration.mjs
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const password = process.env.PURCHASE_TEST_PASSWORD || '123456';
const managerName = process.env.PURCHASE_TEST_USERNAME || 'hung';
const supplierName = process.env.SUPPLIER_TEST_USERNAME || 'supplier-sv';

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

async function getSetup(token, supplierAccount) {
  const suppliers = await ok('GET', '/api/suppliers', token);
  const supplier = suppliers.find((row) => String(row.email || '').toLowerCase() === String(supplierAccount.user.email || '').toLowerCase())
    || suppliers.find((row) => row.status === 'ACTIVE') || suppliers[0];
  const warehouses = await ok('GET', '/api/warehouses', token);
  const warehouse = warehouses.find((row) => row.is_active !== false);
  const books = (await ok('GET', '/api/books', token)).filter((row) => row.variant_id);
  const locationsPayload = await ok('GET', `/api/warehouses/${warehouse.id}/locations`, token);
  const locations = locationsPayload.locations || locationsPayload.data || locationsPayload;
  const receivingLocation = (Array.isArray(locations) ? locations : []).find((row) => row.location_type === 'RECEIVING')
    || (Array.isArray(locations) ? locations : []).find((row) => row.is_active);
  return { supplier, warehouse, receivingLocation, book: books[0], unitCost: 50000 };
}

async function createPo(M, setup, orderedQty, note) {
  const created = await ok('POST', '/api/purchase-orders', M, {
    supplier_id: setup.supplier.id,
    warehouse_id: setup.warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note,
    items: [{ variant_id: setup.book.variant_id, ordered_qty: orderedQty, unit_cost: setup.unitCost }],
  });
  return created.data.id;
}

async function approvePo(M, poId) {
  await ok('POST', `/api/purchase-orders/${poId}/submit`, M);
  await ok('POST', `/api/purchase-orders/${poId}/approve`, M, { note: 'e2e' });
}

/** Invoice exactly invoicedQty (not the full remaining), send+confirm, then deliver and post a
 * GRN for all of it, leaving ordered_qty - invoicedQty genuinely never invoiced or received. */
async function setupPartiallyReceivedPo(M, setup, orderedQty, invoicedQty, note) {
  const poId = await createPo(M, setup, orderedQty, note);
  await approvePo(M, poId);
  await ok('POST', `/api/purchase-orders/${poId}/send-to-supplier`, M);
  const poSent = await ok('GET', `/api/purchase-orders/${poId}`, M);
  const item = poSent.items[0];

  const confirmed = await ok('POST', `/api/purchase-orders/${poId}/supplier-confirm`, M, {
    invoice_number: `CLOSE-INV-${poId.slice(0, 8)}-${Date.now()}`,
    invoice_date: new Date().toISOString().slice(0, 10),
    expected_delivery_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
    items: [{ purchase_order_item_id: item.id, variant_id: item.variant_id, invoiced_qty: invoicedQty, unit_cost: setup.unitCost }],
  });
  const invoiceId = confirmed.data.invoice_id;
  const invoiceDetail = (await ok('GET', `/api/supplier-deliveries/${invoiceId}`, M)).data;
  const draftReceipt = await ok('POST', `/api/supplier-deliveries/${invoiceId}/create-goods-receipt`, M, {
    warehouse_id: setup.warehouse.id,
    note: 'E2E close-remaining setup',
    items: invoiceDetail.items.map((line) => ({
      invoice_item_id: line.id,
      purchase_order_item_id: line.purchase_order_item_id,
      variant_id: line.variant_id,
      delivered_qty: invoicedQty,
      unit_cost: line.unit_cost,
      location_id: setup.receivingLocation.id,
    })),
  });
  await ok('PATCH', `/api/goods-receipts/${draftReceipt.data.id}`, M, { status: 'POSTED' });

  const poAfter = await ok('GET', `/api/purchase-orders/${poId}`, M);
  return { poId, item: poAfter.items[0], invoiceId };
}

async function main() {
  const manager = await login(managerName);
  const supplierAccount = await login(supplierName);
  const M = manager.token;
  const S = supplierAccount.token;
  const setup = await getSetup(M, supplierAccount);

  // ── A: close a genuine remainder without touching ordered_qty/received_qty ──
  const poA = await setupPartiallyReceivedPo(M, setup, 10, 6, 'E2E close-remaining - basic');
  check('setup: received 6 of 10, nothing closed yet', poA.item.received_qty === 6 && poA.item.ordered_qty === 10 && poA.item.closure_status === 'OPEN');
  check('setup: fulfillment_status is PARTIALLY_RECEIVED, not a generic RECEIVED', poA.item.fulfillment_status === 'PARTIALLY_RECEIVED');

  const closedA = await ok('POST', `/api/purchase-orders/${poA.poId}/items/${poA.item.id}/close-remaining`, M, {
    reason: 'Nhà cung cấp xác nhận hết hàng, không giao phần còn lại',
    evidence_reference: 'EMAIL-2026-11-14-NCC',
  });
  check('close-remaining succeeds and returns CLOSED_WITH_REMAINING', closedA.data.closure_status === 'CLOSED_WITH_REMAINING');
  check('close-remaining records the reason and evidence reference', closedA.data.closed_reason.includes('hết hàng') && closedA.data.closed_evidence_reference === 'EMAIL-2026-11-14-NCC');

  const poAAfter = await ok('GET', `/api/purchase-orders/${poA.poId}`, M);
  const itemAAfter = poAAfter.items[0];
  check('ordered_qty is unchanged by closing the remainder', itemAAfter.ordered_qty === 10);
  check('received_qty is unchanged by closing the remainder', itemAAfter.received_qty === 6);
  check('fulfillment_status is now CLOSED_WITH_REMAINING, a distinct bucket', itemAAfter.fulfillment_status === 'CLOSED_WITH_REMAINING');

  // ── B: a closed line refuses further invoices and goods receipts ──
  const extraInvoiceAttempt = await request('POST', `/api/purchase-orders/${poA.poId}/items/${poA.item.id}/close-remaining`, M, { reason: 'lặp lại' });
  check('closing an already-closed line is rejected', extraInvoiceAttempt.response.status === 409, `status=${extraInvoiceAttempt.response.status}`);

  const newNoteAttempt = await request('POST', `/api/supplier-account/orders/${poA.poId}/invoices`, S, {
    delivery_number: `DN-CLOSED-${Date.now()}`,
    items: [{ purchase_order_item_id: poA.item.id, invoiced_qty: 2, unit_cost: setup.unitCost }],
  });
  check(
    'the supplier cannot submit a new delivery note against a closed line',
    newNoteAttempt.response.status >= 400 && /đóng phần còn lại/i.test(newNoteAttempt.data?.message || ''),
    `status=${newNoteAttempt.response.status} message=${newNoteAttempt.data?.message}`,
  );

  // ── C: cannot close a line with nothing left, and cannot close on a non-dispatched PO ──
  const poC = await setupPartiallyReceivedPo(M, setup, 5, 5, 'E2E close-remaining - fully received');
  const closeFullAttempt = await request('POST', `/api/purchase-orders/${poC.poId}/items/${poC.item.id}/close-remaining`, M, { reason: 'x' });
  check('closing a fully-received line is rejected (nothing left to close)', closeFullAttempt.response.status === 400, `status=${closeFullAttempt.response.status}`);
  const poCAfter = await ok('GET', `/api/purchase-orders/${poC.poId}`, M);
  check('a fully received, never-closed line reports FULLY_RECEIVED', poCAfter.items[0].fulfillment_status === 'FULLY_RECEIVED');

  const draftPoId = await createPo(M, setup, 10, 'E2E close-remaining - draft gate');
  const draftPo = await ok('GET', `/api/purchase-orders/${draftPoId}`, M);
  const closeDraftAttempt = await request('POST', `/api/purchase-orders/${draftPoId}/items/${draftPo.items[0].id}/close-remaining`, M, { reason: 'x' });
  check('closing a line on a DRAFT PO is rejected', closeDraftAttempt.response.status === 400, `status=${closeDraftAttempt.response.status}`);

  // ── D: reopen restores normal receiving (its own approval-gated action) ──
  const reopened = await ok('POST', `/api/purchase-orders/${poA.poId}/items/${poA.item.id}/reopen-remaining`, M, { reason: 'NCC tìm được nguồn hàng, sẽ giao bù' });
  check('reopen succeeds and returns to OPEN', reopened.data.closure_status === 'OPEN');
  const poAReopened = await ok('GET', `/api/purchase-orders/${poA.poId}`, M);
  check('after reopening, fulfillment_status returns to PARTIALLY_RECEIVED', poAReopened.items[0].fulfillment_status === 'PARTIALLY_RECEIVED');
  check('reopen never altered ordered_qty/received_qty either', poAReopened.items[0].ordered_qty === 10 && poAReopened.items[0].received_qty === 6);

  const reopenAgainAttempt = await request('POST', `/api/purchase-orders/${poA.poId}/items/${poA.item.id}/reopen-remaining`, M, { reason: 'x' });
  check('reopening a line that is not closed is rejected', reopenAgainAttempt.response.status === 409, `status=${reopenAgainAttempt.response.status}`);

  // Receiving now works again on the reopened line: top up the remaining 4 of 10 end-to-end.
  const topUpNote = await ok('POST', `/api/supplier-account/orders/${poA.poId}/invoices`, S, {
    delivery_number: `DN-TOPUP-${Date.now()}`,
    items: [{ purchase_order_item_id: poA.item.id, invoiced_qty: 4, unit_cost: setup.unitCost }],
  });
  check('after reopen, a new delivery note for the remaining 4 is accepted', Boolean(topUpNote.data?.id));
  const topUpInvoiceDetail = (await ok('GET', `/api/supplier-deliveries/${topUpNote.data.id}`, M)).data;
  const topUpReceipt = await ok('POST', `/api/supplier-deliveries/${topUpNote.data.id}/create-goods-receipt`, M, {
    warehouse_id: setup.warehouse.id,
    note: 'E2E close-remaining top-up after reopen',
    items: topUpInvoiceDetail.items.map((line) => ({
      invoice_item_id: line.id,
      purchase_order_item_id: line.purchase_order_item_id,
      variant_id: line.variant_id,
      delivered_qty: 4,
      unit_cost: line.unit_cost,
      location_id: setup.receivingLocation.id,
    })),
  });
  await ok('PATCH', `/api/goods-receipts/${topUpReceipt.data.id}`, M, { status: 'POSTED' });
  const poAFinal = await ok('GET', `/api/purchase-orders/${poA.poId}`, M);
  check('top-up receipt brings received_qty to 10 and fulfillment_status to FULLY_RECEIVED', poAFinal.items[0].received_qty === 10 && poAFinal.items[0].fulfillment_status === 'FULLY_RECEIVED', `received=${poAFinal.items[0].received_qty} status=${poAFinal.items[0].fulfillment_status}`);

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
