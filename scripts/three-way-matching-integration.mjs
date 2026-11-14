// P1.4 Three-Way Matching: end-to-end check through the real gateway.
//
// This engine already existed as "document reconciliation" (procurement-reconciliation.service.js
// + GET/POST /api/purchase-orders/:id/document-reconciliation[/complete], shipped with the
// Procurement Document Workflow feature). P1.4's own additions are additive: per-line
// po_amount/invoiced_amount/accepted_amount, per-line invoice_ids/goods_receipt_ids traceability,
// and a three_way_match_status field spelling the exact MATCHED/PARTIALLY_MATCHED/DISCREPANCY/
// PENDING/REQUIRES_APPROVAL vocabulary over the engine's existing result buckets. This script
// proves: multiple invoices + multiple GRNs on one PO reconcile to MATCHED without double
// counting and with full per-line traceability; a discrepancy can never be completed without an
// explicitly approved exception + a written reason; and the completion is persisted with who
// approved it.
//
// Usage: node scripts/three-way-matching-integration.mjs
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

async function createDispatchedPo(M, setup, orderedQty, note) {
  const created = await ok('POST', '/api/purchase-orders', M, {
    supplier_id: setup.supplier.id,
    warehouse_id: setup.warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note,
    items: [{ variant_id: setup.book.variant_id, ordered_qty: orderedQty, unit_cost: setup.unitCost }],
  });
  const poId = created.data.id;
  await ok('POST', `/api/purchase-orders/${poId}/submit`, M);
  await ok('POST', `/api/purchase-orders/${poId}/approve`, M, { note: 'e2e' });
  await ok('POST', `/api/purchase-orders/${poId}/send-to-supplier`, M);
  const po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  return { poId, item: po.items[0] };
}

async function invoiceAndReceive(M, S, poId, item, setup, { invoiceQty, deliverQty = invoiceQty }) {
  const note = await ok('POST', `/api/supplier-account/orders/${poId}/invoices`, S, {
    delivery_number: `TWM-DN-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    items: [{ purchase_order_item_id: item.id, invoiced_qty: invoiceQty, unit_cost: setup.unitCost }],
  });
  const invoiceId = note.data.id;
  const invoiceDetail = (await ok('GET', `/api/supplier-deliveries/${invoiceId}`, M)).data;
  const draftReceipt = await ok('POST', `/api/supplier-deliveries/${invoiceId}/create-goods-receipt`, M, {
    warehouse_id: setup.warehouse.id,
    note: 'E2E three-way-matching setup',
    items: invoiceDetail.items.map((line) => ({
      invoice_item_id: line.id,
      purchase_order_item_id: line.purchase_order_item_id,
      variant_id: line.variant_id,
      delivered_qty: deliverQty,
      unit_cost: line.unit_cost,
      location_id: setup.receivingLocation.id,
    })),
  });
  await ok('PATCH', `/api/goods-receipts/${draftReceipt.data.id}`, M, { status: 'POSTED' });
  return { invoiceId, goodsReceiptId: draftReceipt.data.id };
}

// Minimal but structurally valid PDF (magic bytes + trailer) — detectFileKind only inspects bytes.
const FAKE_PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'latin1');

async function uploadFile(path, token, pdfBytes) {
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'invoice.pdf');
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

/** Create, attach a file to, and issue a real VAT_INVOICE procurement_document as the supplier —
 * the only thing that actually drives invoiced_qty/invoiced_amount in the reconciliation engine
 * (a supplier_delivery_invoice / delivery note does not by itself count as an "invoice" for
 * three-way matching; only an ISSUED VAT_INVOICE/SALES_INVOICE document does). */
async function issueFormalInvoice(S, poId, item, qty, unitCost, series) {
  const created = await ok('POST', `/api/supplier-account/orders/${poId}/documents`, S, {
    document_type: 'VAT_INVOICE',
    external_number: `${series}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    issue_date: new Date().toISOString().slice(0, 10),
    invoice_series: series,
    lines: [{ purchase_order_item_id: item.id, quantity: qty, unit_price: unitCost }],
  });
  const docId = created.data.id;
  const uploaded = await uploadFile(`/api/supplier-account/documents/${docId}/files`, S, FAKE_PDF_BYTES);
  if (!uploaded.response.ok) throw new Error(`upload file for document ${docId} -> ${uploaded.response.status} ${JSON.stringify(uploaded.data)}`);
  const issued = await ok('POST', `/api/supplier-account/documents/${docId}/issue`, S, {});
  return issued.data;
}

async function main() {
  const manager = await login(managerName);
  const supplierAccount = await login(supplierName);
  const M = manager.token;
  const S = supplierAccount.token;
  const setup = await getSetup(M, supplierAccount);

  // ── A: multiple invoices + multiple GRNs on one PO -> MATCHED, no double counting, traceable ──
  const a = await createDispatchedPo(M, setup, 100, 'E2E three-way-matching - matched multi-doc');
  await ok('POST', `/api/supplier-account/orders/${a.poId}/respond`, S, { decision: 'ACCEPTED' });
  const aPo = await ok('GET', `/api/purchase-orders/${a.poId}`, M);
  await invoiceAndReceive(M, S, a.poId, aPo.items[0], setup, { invoiceQty: 60 });
  await invoiceAndReceive(M, S, a.poId, aPo.items[0], setup, { invoiceQty: 40 });
  await issueFormalInvoice(S, a.poId, aPo.items[0], 60, setup.unitCost, 'AA/26E');
  await issueFormalInvoice(S, a.poId, aPo.items[0], 40, setup.unitCost, 'AA/26E');

  const reconA = await ok('GET', `/api/purchase-orders/${a.poId}/document-reconciliation`, M);
  check('multi-invoice/multi-GRN PO reconciles to MATCHED', reconA.data.status === 'MATCHED', `status=${reconA.data.status}`);
  check('three_way_match_status spells MATCHED at header level', reconA.data.three_way_match_status === 'MATCHED');
  const lineA = reconA.data.lines[0];
  check('line totals are not double-counted: invoiced_qty=100, accepted_qty=100', lineA.invoiced_qty === 100 && lineA.accepted_qty === 100, `invoiced=${lineA.invoiced_qty} accepted=${lineA.accepted_qty}`);
  check('line amounts reconcile: po_amount == accepted_amount == invoiced_amount (all at PO price)', lineA.po_amount === 5000000 && lineA.accepted_amount === 5000000 && lineA.invoiced_amount === 5000000, JSON.stringify({ po: lineA.po_amount, accepted: lineA.accepted_amount, invoiced: lineA.invoiced_amount }));
  check('line is traceable to both contributing invoices', new Set(lineA.invoice_ids).size === 2, `invoice_ids=${JSON.stringify(lineA.invoice_ids)}`);
  check('line is traceable to both contributing GRNs', new Set(lineA.goods_receipt_ids).size === 2, `goods_receipt_ids=${JSON.stringify(lineA.goods_receipt_ids)}`);

  const completedA = await ok('POST', `/api/purchase-orders/${a.poId}/document-reconciliation/complete`, M, {});
  check('a MATCHED reconciliation can be completed without an exception', Boolean(completedA.data?.id) && completedA.data.exception_approved === false);

  // ── B: a discrepancy can never be auto-approved; completing it requires an explicit, reasoned exception ──
  const b = await createDispatchedPo(M, setup, 100, 'E2E three-way-matching - discrepancy exception');
  await ok('POST', `/api/supplier-account/orders/${b.poId}/respond`, S, { decision: 'ACCEPTED' });
  const bPo = await ok('GET', `/api/purchase-orders/${b.poId}`, M);
  await invoiceAndReceive(M, S, b.poId, bPo.items[0], setup, { invoiceQty: 100, deliverQty: 95 }); // 5 missing -> shortage report opened
  await issueFormalInvoice(S, b.poId, bPo.items[0], 100, setup.unitCost, 'BB/26E');

  const reconB = await ok('GET', `/api/purchase-orders/${b.poId}/document-reconciliation`, M);
  check('a short delivery reconciles to DISCREPANCY', reconB.data.status === 'DISCREPANCY', `status=${reconB.data.status}`);
  check('three_way_match_status spells DISCREPANCY', reconB.data.three_way_match_status === 'DISCREPANCY');

  const completeNoException = await request('POST', `/api/purchase-orders/${b.poId}/document-reconciliation/complete`, M, {});
  check('cannot complete a discrepancy without an exception', completeNoException.response.status === 409, `status=${completeNoException.response.status}`);

  const exceptionNoNote = await request('POST', `/api/purchase-orders/${b.poId}/document-reconciliation/complete`, M, { exception_approved: true });
  check('an exception without a written reason is rejected', exceptionNoNote.response.status === 400, `status=${exceptionNoNote.response.status}`);

  const exceptionApproved = await ok('POST', `/api/purchase-orders/${b.poId}/document-reconciliation/complete`, M, {
    exception_approved: true,
    note: 'Chấp nhận hao hụt 5 cuốn, đã ghi nhận tổn thất',
  });
  check('an exception with a reason is accepted and recorded as an exception', exceptionApproved.data.exception_approved === true);
  check('the completion records who approved it', Boolean(exceptionApproved.data.completed_by_user_id));

  const reconBAfter = await ok('GET', `/api/purchase-orders/${b.poId}/document-reconciliation`, M);
  const historyEntry = reconBAfter.data.history.find((h) => h.id === exceptionApproved.data.id);
  check('the reconciliation history shows the approved exception and its note', Boolean(historyEntry) && historyEntry.exception_approved === true && historyEntry.note.includes('hao hụt'));

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
