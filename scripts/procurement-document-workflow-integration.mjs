// End-to-end check of the supplier <-> warehouse procurement document workflow against a running
// stack (docker compose up). Every step goes through the API gateway with real accounts:
//   manager/admin (PURCHASE_TEST_USERNAME, default "hung"), warehouse staff ("staff01"),
//   supplier A ("supplier-sv") and an unrelated supplier B ("supplier-ibd"). Password: 123456.
// Usage: node scripts/procurement-document-workflow-integration.mjs
import crypto from 'node:crypto';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const mailpitUrl = process.env.MAILPIT_URL || 'http://localhost:8025';
const password = process.env.PURCHASE_TEST_PASSWORD || '123456';
const managerName = process.env.PURCHASE_TEST_USERNAME || 'hung';
const staffName = process.env.STAFF_TEST_USERNAME || 'staff01';
const supplierAName = process.env.SUPPLIER_TEST_USERNAME || 'supplier-sv';
const supplierBName = process.env.OTHER_SUPPLIER_TEST_USERNAME || 'supplier-ibd';

const PDF = Buffer.from(`%PDF-1.7\n% SmartBook E2E invoice ${Date.now()}\n%%EOF\n`);
const SCAN = Buffer.from(`%PDF-1.7\n% signed delivery minutes scan ${Date.now()}\n%%EOF\n`);
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function request(method, path, token, body, { idempotencyKey, form } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let payload;
  if (form) payload = form;
  else if (body != null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json().catch(() => ({})) : Buffer.from(await response.arrayBuffer());
  return { response, data };
}

async function ok(method, path, token, body, options) {
  const result = await request(method, path, token, body, options);
  if (!result.response.ok) throw new Error(`${method} ${path} -> ${result.response.status} ${JSON.stringify(result.data)}`);
  return result.data;
}

async function login(identifier) {
  const { response, data } = await request('POST', '/auth/login', null, { identifier, password });
  if (!response.ok || !data?.token) throw new Error(`login ${identifier} failed (${response.status}): ${JSON.stringify(data)}`);
  return { token: data.token, user: data.user };
}

function formOf(fields, file, name = 'document.pdf') {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  });
  if (file) form.append('file', new Blob([file], { type: 'application/pdf' }), name);
  return form;
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${condition || !detail ? '' : ` -- ${detail}`}`);
  if (!condition) throw new Error(`${name}: ${detail}`);
}

async function main() {
  const manager = await login(managerName);
  const staff = await login(staffName);
  const supplierA = await login(supplierAName);
  const supplierB = await login(supplierBName);
  const M = manager.token;

  // ── Fixtures: supplier A's record, a warehouse with a receiving location, two books ──
  const suppliers = await ok('GET', '/api/suppliers', M);
  const supplier = suppliers.find((row) => String(row.email || '').toLowerCase() === String(supplierA.user.email || '').toLowerCase());
  check('fixture: supplier A record linked to supplier account', supplier?.id, supplierA.user.email);
  const warehouses = await ok('GET', '/api/warehouses', M);
  let warehouse = null;
  let receivingLocation = null;
  // The staff account must be able to work in this warehouse (its warehouse scope).
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
  const [bookA, bookB] = books.slice(-2);
  check('fixture: two catalogue variants', bookA && bookB);
  const priceA = 50000;
  const priceB = 80000;

  // ── Phase 1: PO created, submitted, approved, sent ───────────────────────────
  const created = await ok('POST', '/api/purchase-orders', M, {
    supplier_id: supplier.id,
    warehouse_id: warehouse.id,
    expected_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    note: 'E2E procurement document workflow',
    items: [
      { variant_id: bookA.variant_id, ordered_qty: 100, unit_cost: priceA },
      { variant_id: bookB.variant_id, ordered_qty: 10, unit_cost: priceB },
    ],
  });
  const poId = created.data.id;
  await ok('POST', `/api/purchase-orders/${poId}/submit`, M);
  await ok('POST', `/api/purchase-orders/${poId}/approve`, M, { note: 'e2e' });
  await ok('POST', `/api/purchase-orders/${poId}/send-to-supplier`, M);
  let po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  check('PO sent: waiting for the supplier (PENDING_SUPPLIER)', po.status === 'SENT_TO_SUPPLIER' && po.supplier_response_status === 'PENDING_SUPPLIER', `${po.status}/${po.supplier_response_status}`);
  const itemA = po.items.find((row) => row.variant_id === bookA.variant_id);
  const itemB = po.items.find((row) => row.variant_id === bookB.variant_id);

  // ── Phase 2: supplier sees only its PO and answers ───────────────────────────
  const accountOrders = await ok('GET', '/api/supplier-account/orders', supplierA.token);
  check('supplier A sees the PO in its portal', accountOrders.data.orders.some((row) => row.purchase_order.id === poId));
  const otherOrders = await ok('GET', '/api/supplier-account/orders', supplierB.token);
  check('supplier B does not see supplier A\'s PO', !otherOrders.data.orders.some((row) => row.purchase_order.id === poId));
  const bDocs = await request('GET', `/api/supplier-account/orders/${poId}/documents`, supplierB.token);
  check('supplier B gets 404 on supplier A\'s PO documents', bDocs.response.status === 404, String(bDocs.response.status));

  const partial = await ok('POST', `/api/supplier-account/orders/${poId}/respond`, supplierA.token, {
    decision: 'PARTIALLY_ACCEPTED',
    reason: 'Chỉ còn 8 cuốn sách B',
    lines: [{ purchase_order_item_id: itemB.id, confirmed_qty: 8 }],
  });
  check('partial acceptance waits for SmartBook review', partial.data.review_status === 'PENDING_REVIEW');
  po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  check('PO lines are not silently overwritten', po.items.find((row) => row.id === itemB.id).ordered_qty === 10 && po.supplier_response_status === 'PARTIALLY_ACCEPTED');
  const blockedDelivery = await request('POST', `/api/supplier-account/orders/${poId}/invoices`, supplierA.token, {
    delivery_number: `DN-BLOCK-${Date.now()}`,
    items: [{ purchase_order_item_id: itemA.id, invoiced_qty: 1, unit_cost: priceA }],
  });
  check('supplier cannot ship while the change is pending review', blockedDelivery.response.status === 409, String(blockedDelivery.response.status));
  await ok('POST', `/api/purchase-orders/${poId}/supplier-responses/${partial.data.id}/review`, M, { decision: 'APPROVE', note: 'Đồng ý 8 cuốn' });
  po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  check('approved change applied with history; PO confirmed', po.status === 'SUPPLIER_CONFIRMED' && po.items.find((row) => row.id === itemB.id).ordered_qty === 8
    && po.supplier_responses.some((row) => row.review_status === 'APPROVED' && row.lines.some((line) => line.ordered_qty === 10 && line.confirmed_qty === 8)));

  // ── Phase 3: supplier issues the invoice (one record, PDF stored) ─────────────
  const invoiceNumber = `E2E${Date.now()}`.slice(-10);
  const invoiceFields = {
    document_type: 'VAT_INVOICE',
    external_number: invoiceNumber,
    invoice_series: '1C26TSB',
    issue_date: new Date().toISOString().slice(0, 10),
    tax_rate: 5,
    lines: [
      { purchase_order_item_id: itemA.id, quantity: 100, unit_price: priceA },
      { purchase_order_item_id: itemB.id, quantity: 8, unit_price: priceB },
    ],
    metadata: { lookup_code: 'TRACUU-E2E', seller_tax_code: '0101234567', buyer_tax_code: '0309999999' },
    issue: 'true',
  };
  const invoice = (await ok('POST', `/api/supplier-account/orders/${poId}/documents`, supplierA.token, null, { form: formOf(invoiceFields, PDF, 'hoa-don.pdf') })).data;
  check('supplier issues VAT invoice with PDF (ISSUED, SHA-256 stored)', invoice.status === 'ISSUED' && invoice.files[0]?.sha256 === sha256(PDF));
  check('invoice totals computed (5,000,000 + 640,000 + 5% VAT)', invoice.total_amount === 5922000, String(invoice.total_amount));
  const duplicate = await request('POST', `/api/supplier-account/orders/${poId}/documents`, supplierA.token, null, { form: formOf(invoiceFields, PDF) });
  check('duplicate invoice number rejected (409)', duplicate.response.status === 409, String(duplicate.response.status));
  const managerInvoice = await ok('GET', `/api/procurement-documents/${invoice.id}`, M);
  check('warehouse side sees the SAME invoice record (same id + file hash)', managerInvoice.data.id === invoice.id && managerInvoice.data.files[0].sha256 === invoice.files[0].sha256);
  check('opening it marks the SmartBook share DELIVERED (not ACKNOWLEDGED)', managerInvoice.data.sharing.status === 'DELIVERED', managerInvoice.data.sharing.status);
  const smartbookCannotIssue = await request('POST', `/api/procurement-documents/purchase-orders/${poId}`, M, null, { form: formOf({ ...invoiceFields, external_number: `${invoiceNumber}X` }, PDF) });
  check('SmartBook cannot issue an invoice on behalf of the supplier (403)', smartbookCannotIssue.response.status === 403, String(smartbookCannotIssue.response.status));
  const smartbookCannotEdit = await request('POST', `/api/procurement-documents/${invoice.id}/files`, M, null, { form: formOf({}, PDF) });
  check('SmartBook cannot replace the supplier invoice file (403)', smartbookCannotEdit.response.status === 403, String(smartbookCannotEdit.response.status));
  const supplierCannotReplace = await request('POST', `/api/supplier-account/documents/${invoice.id}/files`, supplierA.token, null, { form: formOf({}, PDF) });
  check('issued invoice file cannot be replaced even by its issuer (409)', supplierCannotReplace.response.status === 409, String(supplierCannotReplace.response.status));

  // ── Phase 3b: delivery notes (batch 1: 100 of A) ─────────────────────────────
  const dn1Number = `DN1-${Date.now()}`;
  const dn1 = (await ok('POST', `/api/supplier-account/orders/${poId}/invoices`, supplierA.token, {
    delivery_number: dn1Number,
    carrier_name: 'Viettel Post',
    deliverer_name: 'Nguyễn Văn Giao',
    expected_delivery_date: new Date().toISOString().slice(0, 10),
    items: [{ purchase_order_item_id: itemA.id, invoiced_qty: 100, unit_cost: priceA }],
  })).data;
  const docsAfterDn = await ok('GET', `/api/procurement-documents/purchase-orders/${poId}`, M);
  check('delivery note registered in the shared document center', docsAfterDn.data.documents.some((doc) => doc.document_type === 'DELIVERY_NOTE' && doc.supplier_delivery_invoice_id === dn1.id && doc.external_number === dn1Number));

  // ── Phase 5: GRN from delivery 1 — 98 arrive, 3 damaged ───────────────────────
  const deliveryDetail = (await ok('GET', `/api/supplier-deliveries/${dn1.id}`, M)).data;
  const grBody = {
    warehouse_id: warehouse.id,
    items: deliveryDetail.items.map((row) => ({ invoice_item_id: row.id, delivered_qty: 98, damaged_qty: 3, location_id: receivingLocation.id })),
  };
  const key = crypto.randomUUID();
  const gr1 = (await ok('POST', `/api/supplier-deliveries/${dn1.id}/create-goods-receipt`, M, grBody, { idempotencyKey: key })).data;
  const retry = await request('POST', `/api/supplier-deliveries/${dn1.id}/create-goods-receipt`, M, grBody, { idempotencyKey: key });
  check('retry with the same Idempotency-Key returns the same GRN', retry.response.status === 200 && retry.data.data.id === gr1.id, String(retry.response.status));
  const dupGr = await request('POST', `/api/supplier-deliveries/${dn1.id}/create-goods-receipt`, M, grBody, { idempotencyKey: crypto.randomUUID() });
  check('a second GRN for the same delivery note is refused (409)', dupGr.response.status === 409, String(dupGr.response.status));

  await ok('PATCH', `/api/goods-receipts/${gr1.id}/assign`, M, { received_by_user_id: staff.user.id });
  const grDetail = await ok('GET', `/api/goods-receipts/${gr1.id}`, staff.token);
  check('assigned staff opens the GRN', grDetail.id === gr1.id);
  await ok('PATCH', `/api/goods-receipts/${gr1.id}`, staff.token, { items: grDetail.items.map((row) => ({ id: row.id, actual_quantity: 98, damaged_qty: 3, rejected_qty: 0 })) });
  const staffPosting = await request('PATCH', `/api/goods-receipts/${gr1.id}`, staff.token, { status: 'POSTED' });
  check('staff cannot post stock (manager approval kept)', staffPosting.response.status === 403, String(staffPosting.response.status));

  const staffDocs = await ok('GET', `/api/procurement-documents/purchase-orders/${poId}`, staff.token);
  check('assigned staff sees the same invoice', staffDocs.data.documents.some((doc) => doc.id === invoice.id));
  const staffInvoice = await request('POST', `/api/procurement-documents/purchase-orders/${poId}`, staff.token, null, { form: formOf({ ...invoiceFields, external_number: `${invoiceNumber}Y` }, PDF) });
  check('staff cannot create an invoice (403)', staffInvoice.response.status === 403, String(staffInvoice.response.status));
  const staffEdit = await request('POST', `/api/procurement-documents/${invoice.id}/cancel`, staff.token, { reason: 'x' });
  check('staff cannot cancel the supplier invoice (403)', staffEdit.response.status === 403, String(staffEdit.response.status));

  // Signed minutes: created pending, scan uploaded by staff.
  const minutes = (await ok('POST', `/api/procurement-documents/purchase-orders/${poId}`, staff.token, null, {
    form: formOf({
      document_type: 'DELIVERY_ACCEPTANCE_MINUTES',
      goods_receipt_id: gr1.id,
      external_number: `BBGN-${Date.now()}`,
      metadata: { signed_date: new Date().toISOString().slice(0, 10), supplier_representative: 'Nguyễn Văn Giao', library_representative: 'Trần Thị Kho', confirmed_qty: 95, discrepancy_summary: 'Thiếu 2, hỏng 3' },
    }),
  })).data;
  check('minutes without a scan are PENDING_SIGNED_DOCUMENT', minutes.status === 'PENDING_SIGNED_DOCUMENT', minutes.status);
  const pendingShare = await request('POST', `/api/procurement-documents/${minutes.id}/share`, M, { channel: 'PORTAL' });
  check('pending minutes cannot be shared (409)', pendingShare.response.status === 409, String(pendingShare.response.status));
  const scanned = (await ok('POST', `/api/procurement-documents/${minutes.id}/files`, staff.token, null, { form: formOf({}, SCAN, 'bien-ban-giao-nhan.pdf') })).data;
  check('scan uploaded -> SCAN_UPLOADED (never auto "signed")', scanned.status === 'SCAN_UPLOADED' && scanned.metadata.signature_verified === false);
  check('scan stored with SHA-256 and uploader party', scanned.files[0].sha256 === sha256(SCAN) && scanned.files[0].uploaded_by_party === 'SMARTBOOK');

  // Manager posts: only 95 accepted reaches stock; discrepancy recorded.
  await ok('PATCH', `/api/goods-receipts/${gr1.id}`, M, { status: 'POSTED' });
  const postedAgain = await ok('PATCH', `/api/goods-receipts/${gr1.id}`, M, { status: 'POSTED' });
  check('posting again is idempotent', postedAgain.data.status === 'POSTED');
  po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  check('PO received 95 (not 98, not 100) after posting', po.items.find((row) => row.id === itemA.id).received_qty === 95, String(po.items.find((row) => row.id === itemA.id).received_qty));
  const posted = await ok('GET', `/api/goods-receipts/${gr1.id}`, M);
  check('GRN line shows accepted 95 / delivered 98 / damaged 3', posted.items[0].quantity === 95 && posted.items[0].delivered_qty === 98 && posted.items[0].damaged_qty === 3);
  const tamper = await ok('PATCH', `/api/goods-receipts/${gr1.id}`, M, { items: posted.items.map((row) => ({ id: row.id, quantity: 100 })) });
  const afterTamper = await ok('GET', `/api/goods-receipts/${gr1.id}`, M);
  check('POSTED GRN lines cannot be edited directly', tamper && afterTamper.items[0].quantity === 95);
  const reports = (await ok('GET', `/api/purchase-orders/${poId}/shortage-reports`, M)).data;
  const report = reports.find((row) => row.goods_receipt_id === gr1.id);
  const types = Object.fromEntries((report?.items || []).map((row) => [row.discrepancy_type, row.shortage_qty]));
  check('discrepancy report: 2 missing + 3 damaged (MIXED)', report?.discrepancy_type === 'MIXED' && types.SHORTAGE === 2 && types.DAMAGED === 3, JSON.stringify(types));
  const invoiceAfter = await ok('GET', `/api/procurement-documents/${invoice.id}`, M);
  check('original invoice untouched (still 100 x A)', invoiceAfter.data.lines.find((line) => line.purchase_order_item_id === itemA.id).quantity === 100 && invoiceAfter.data.status === 'ISSUED');

  let rec = (await ok('GET', `/api/purchase-orders/${poId}/document-reconciliation`, M)).data;
  check('reconciliation = DISCREPANCY while the report is open', rec.status === 'DISCREPANCY', rec.status);
  const earlyClose = await request('POST', `/api/purchase-orders/${poId}/document-reconciliation/complete`, M, {});
  check('cannot complete reconciliation with an open discrepancy (409)', earlyClose.response.status === 409, String(earlyClose.response.status));

  // ── Phase 6: share the scan, supplier downloads and acknowledges ──────────────
  await ok('POST', `/api/procurement-documents/${minutes.id}/share`, M, { channel: 'PORTAL' });
  const emailShare = (await ok('POST', `/api/procurement-documents/${minutes.id}/share`, M, { channel: 'EMAIL' })).data;
  const emailRow = emailShare.shares.find((row) => row.channel === 'EMAIL');
  check('e-mail share recorded with its real SMTP outcome', emailRow && ['SENT', 'FAILED'].includes(emailRow.status) && (emailRow.status === 'FAILED' ? Boolean(emailRow.error_message) : true), JSON.stringify(emailRow));
  if (emailRow.status === 'SENT') {
    check('SENT e-mail stores the SMTP message id', Boolean(emailRow.message_id));
    const mail = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(minutes.document_number)}`).then((r) => r.json()).catch(() => null);
    check('mailpit received the notification e-mail', Number(mail?.messages_count || mail?.total || 0) >= 1, JSON.stringify(mail)?.slice(0, 120));
  }
  check('supplier share is SENT until the supplier opens it', emailShare.sharing.status === 'SENT', emailShare.sharing.status);
  const supplierDocs = await ok('GET', `/api/supplier-account/orders/${poId}/documents`, supplierA.token);
  const minutesForSupplier = supplierDocs.data.documents.find((doc) => doc.id === minutes.id);
  check('supplier sees the shared signed minutes', Boolean(minutesForSupplier));
  check('supplier view hides internal notes / recipient e-mails', minutesForSupplier.internal_note === undefined && minutesForSupplier.shares.every((row) => row.recipient_email === null));
  const download = await request('GET', `/api/supplier-account/documents/${minutes.id}/files/${minutesForSupplier.files[0].id}/download`, supplierA.token);
  check('supplier downloads the exact scan bytes', download.response.ok && sha256(download.data) === sha256(SCAN));
  const otherDownload = await request('GET', `/api/supplier-account/documents/${minutes.id}/files/${minutesForSupplier.files[0].id}/download`, supplierB.token);
  check('supplier B cannot download it by guessing ids (404)', otherDownload.response.status === 404, String(otherDownload.response.status));
  const afterDownload = await ok('GET', `/api/procurement-documents/${minutes.id}`, M);
  check('download marks DELIVERED, not ACKNOWLEDGED', afterDownload.data.sharing.status === 'DELIVERED', afterDownload.data.sharing.status);
  await ok('POST', `/api/supplier-account/documents/${minutes.id}/acknowledge`, supplierA.token);
  const afterAck = await ok('GET', `/api/procurement-documents/${minutes.id}`, M);
  check('supplier acknowledgement -> ACKNOWLEDGED', afterAck.data.sharing.status === 'ACKNOWLEDGED' && Boolean(afterAck.data.sharing.acknowledged_at));
  await ok('POST', `/api/procurement-documents/${invoice.id}/acknowledge`, M);
  const managerDownload = await request('GET', `/api/procurement-documents/${invoice.id}/files/${invoice.files[0].id}/download`, M);
  const supplierInvoiceDownload = await request('GET', `/api/supplier-account/documents/${invoice.id}/files/${invoice.files[0].id}/download`, supplierA.token);
  check('both roles download identical invoice bytes', sha256(managerDownload.data) === sha256(PDF) && sha256(supplierInvoiceDownload.data) === sha256(PDF));

  // ── Phase 7: supplier proposes redelivery; second batch fixes shortage + damage, third batch B ──
  await ok('POST', `/api/supplier-account/orders/${poId}/shortage-reports/${report.id}/propose`, supplierA.token, { action: 'REDELIVER', note: 'Giao bù 5 cuốn trong tuần' });
  const proposed = (await ok('GET', `/api/purchase-orders/${poId}/shortage-reports`, M)).data.find((row) => row.id === report.id);
  check('supplier proposal recorded on the discrepancy', proposed.supplier_proposed_action === 'REDELIVER' && proposed.status === 'ACKNOWLEDGED');
  const dn2 = (await ok('POST', `/api/supplier-account/orders/${poId}/shortage-reports/${report.id}/redelivery-invoice`, supplierA.token, {
    delivery_number: `DN2-${Date.now()}`,
    items: [{ purchase_order_item_id: itemA.id, invoiced_qty: 5, unit_cost: priceA }],
  })).data;
  const dn3 = (await ok('POST', `/api/supplier-account/orders/${poId}/invoices`, supplierA.token, {
    delivery_number: `DN3-${Date.now()}`,
    items: [{ purchase_order_item_id: itemB.id, invoiced_qty: 8, unit_cost: priceB }],
  })).data;
  for (const dn of [dn2, dn3]) {
    const detail = (await ok('GET', `/api/supplier-deliveries/${dn.id}`, M)).data;
    const gr = (await ok('POST', `/api/supplier-deliveries/${dn.id}/create-goods-receipt`, M, {
      warehouse_id: warehouse.id,
      items: detail.items.map((row) => ({ invoice_item_id: row.id, delivered_qty: row.invoiced_qty, location_id: receivingLocation.id })),
    }, { idempotencyKey: crypto.randomUUID() })).data;
    await ok('PATCH', `/api/goods-receipts/${gr.id}`, M, { status: 'POSTED' });
  }
  po = await ok('GET', `/api/purchase-orders/${poId}`, M);
  check('multi-delivery PO fully received (100 + 8) and closed', po.status === 'RECEIVED' && po.total_received_qty === 108, `${po.status} ${po.total_received_qty}`);
  const resolved = (await ok('GET', `/api/purchase-orders/${poId}/shortage-reports`, M)).data.find((row) => row.id === report.id);
  check('discrepancy auto-resolved by the redelivery', resolved.status === 'RESOLVED' && resolved.resolution_action === 'REDELIVERED', resolved.status);
  rec = (await ok('GET', `/api/purchase-orders/${poId}/document-reconciliation`, M)).data;
  check('reconciliation MATCHED across 1 invoice and 3 deliveries', rec.status === 'MATCHED' && rec.deliveries.length === 3, `${rec.status} ${JSON.stringify(rec.lines.map((l) => l.flags))}`);
  const closed = await ok('POST', `/api/purchase-orders/${poId}/document-reconciliation/complete`, M, { note: 'Đối soát xong' });
  check('reconciliation completed and stored', closed.data.result_status === 'MATCHED' && closed.data.exception_approved === false);

  // ── SmartBook-issued receipt confirmation shared to the supplier ─────────────
  const grc = (await ok('POST', `/api/procurement-documents/goods-receipts/${gr1.id}/confirmation`, M, { note: 'Kết quả kiểm nhận đợt 1' })).data;
  check('goods receipt confirmation issued (not an invoice)', grc.document_type === 'GOODS_RECEIPT_CONFIRMATION' && grc.status === 'ISSUED' && grc.metadata.lines[0].accepted_qty === 95);
  const grcAgain = await request('POST', `/api/procurement-documents/goods-receipts/${gr1.id}/confirmation`, M, {});
  check('one confirmation per receipt (409 on repeat)', grcAgain.response.status === 409, String(grcAgain.response.status));
  const hiddenBeforeShare = (await ok('GET', `/api/supplier-account/orders/${poId}/documents`, supplierA.token)).data.documents.some((doc) => doc.id === grc.id);
  check('unshared SmartBook document is not visible to the supplier', hiddenBeforeShare === false);

  const activity = (await ok('GET', `/api/procurement-documents/purchase-orders/${poId}/activity`, M)).data;
  const actions = new Set(activity.map((row) => row.action_name));
  check('audit trail covers response, issue, download, share, acknowledge, discrepancy, reconciliation',
    ['SUPPLIER_ORDER_RESPONDED', 'SUPPLIER_RESPONSE_APPROVED', 'PROCUREMENT_DOCUMENT_ISSUED', 'PROCUREMENT_DOCUMENT_DOWNLOADED', 'PROCUREMENT_DOCUMENT_SHARED', 'PROCUREMENT_DOCUMENT_ACKNOWLEDGED', 'SUPPLIER_DISCREPANCY_REPORTED', 'PROCUREMENT_RECONCILIATION_COMPLETED'].every((action) => actions.has(action)),
    [...actions].join(','));

  console.log(`\nPO ${po.po_number} (${poId})`);
  console.log(`PASS=${results.filter((row) => row.pass).length} TOTAL=${results.length}`);
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  console.log(`PASS=${results.filter((row) => row.pass).length} (stopped at first failure)`);
  process.exit(1);
});
