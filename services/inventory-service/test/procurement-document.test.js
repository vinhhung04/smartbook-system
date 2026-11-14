// Shared procurement documents: registry rules, file versions, sharing statuses and RBAC.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');

process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:1';
process.env.PROCUREMENT_DOCUMENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-procurement-docs-'));
process.env.SMTP_HOST = '';

const { createFakeDb, installFakePrisma, createFakeRes } = require('./helpers/procurement-fake-db');

const PO_A = '11111111-1111-4111-8111-111111111111';
const PO_B = '22222222-2222-4222-8222-222222222222';
const SUP_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUP_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const WH = '33333333-3333-4333-8333-333333333333';
const STAFF = '44444444-4444-4444-8444-444444444444';
const OTHER_STAFF = '55555555-5555-4555-8555-555555555555';
const MANAGER = '66666666-6666-4666-8666-666666666666';
const GR = '77777777-7777-4777-8777-777777777777';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const XML = Buffer.from('<?xml version="1.0" encoding="UTF-8"?><HDon><DLHDon><TTChung><SHDon>0000123</SHDon></TTChung></DLHDon></HDon>');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00 this is not a document');

function seed() {
  return {
    suppliers: [
      { id: SUP_A, name: 'NCC A', email: 'a@supplier.test', status: 'ACTIVE' },
      { id: SUP_B, name: 'NCC B', email: 'b@supplier.test', status: 'ACTIVE' },
    ],
    purchase_orders: [
      { id: PO_A, po_number: 'PO-A', supplier_id: SUP_A, warehouse_id: WH, status: 'SUPPLIER_CONFIRMED' },
      { id: PO_B, po_number: 'PO-B', supplier_id: SUP_B, warehouse_id: WH, status: 'SUPPLIER_CONFIRMED' },
    ],
    purchase_order_items: [
      { id: 'poi-a1', purchase_order_id: PO_A, variant_id: 'v1', ordered_qty: 100, received_qty: 0, unit_cost: 50000 },
      { id: 'poi-b1', purchase_order_id: PO_B, variant_id: 'v9', ordered_qty: 10, received_qty: 0, unit_cost: 10000 },
    ],
    supplier_order_dispatches: [
      { id: 'disp-a', purchase_order_id: PO_A, supplier_id: SUP_A, payload: { portal_token: 'tok-a' } },
      { id: 'disp-b', purchase_order_id: PO_B, supplier_id: SUP_B, payload: { portal_token: 'tok-b' } },
    ],
    goods_receipts: [
      { id: GR, receipt_number: 'GR-1', purchase_order_id: PO_A, warehouse_id: WH, status: 'POSTED', received_by_user_id: STAFF, supplier_delivery_invoice_id: null, source_type: 'SUPPLIER_INVOICE' },
    ],
    goods_receipt_items: [],
    book_variants: [{ id: 'v1', isbn13: '9786040000001', books: { title: 'Sách A' } }],
  };
}

const db = createFakeDb(seed());
installFakePrisma(db.client);

const scopeUtils = require('../src/utils/warehouse-scope.utils');
scopeUtils.setWarehouseScopeResolver({
  resolve: async (user) => (user?.id === MANAGER ? { all: false, read: new Set([WH]), write: new Set([WH]) } : { all: false, read: new Set(), write: new Set() }),
  canRead: async (user, id) => user?.id === MANAGER && id === WH,
  canWrite: async (user, id) => user?.id === MANAGER && id === WH,
});

const docs = require('../src/services/procurement-document.service');
const controller = require('../src/controllers/procurement-document.controller');

const supplierUser = (sup) => ({ id: sup === SUP_A ? 'user-sup-a' : 'user-sup-b', roles: ['SUPPLIER'], permissions: ['supplier.portal.read', 'supplier.portal.write'], email: sup === SUP_A ? 'a@supplier.test' : 'b@supplier.test' });
const managerUser = { id: MANAGER, roles: ['WAREHOUSE_MANAGER'], permissions: ['inventory.purchase.read', 'inventory.purchase.write', 'inventory.purchase.approve'] };
const staffUser = { id: STAFF, roles: ['WAREHOUSE_STAFF'], permissions: ['inventory.task.read', 'inventory.task.progress'] };
const otherStaffUser = { id: OTHER_STAFF, roles: ['WAREHOUSE_STAFF'], permissions: ['inventory.task.read', 'inventory.task.progress'] };

const supplierActor = { party: 'SUPPLIER', userId: 'user-sup-a', supplierId: SUP_A, role: 'SUPPLIER' };
const managerActor = { party: 'SMARTBOOK', userId: MANAGER, role: 'MANAGER', user: managerUser };
const staffActor = { party: 'SMARTBOOK', userId: STAFF, role: 'STAFF', user: staffUser };

const poA = () => ({ ...db.table('purchase_orders').find((p) => p.id === PO_A), purchase_order_items: db.table('purchase_order_items').filter((i) => i.purchase_order_id === PO_A) });
const file = (buffer, name = 'hoa-don.pdf') => ({ buffer, originalname: name, mimetype: 'application/pdf' });
let invoiceSeq = 0;
const invoiceBody = (extra = {}) => ({
  document_type: 'VAT_INVOICE',
  external_number: `00001${++invoiceSeq}`,
  invoice_series: '1C26TAA',
  issue_date: '2026-11-10',
  tax_rate: 5,
  lines: JSON.stringify([{ purchase_order_item_id: 'poi-a1', quantity: 100, unit_price: 50000 }]),
  metadata: JSON.stringify({ lookup_code: 'ABC123', seller_tax_code: '0101234567', buyer_tax_code: '0309999999' }),
  ...extra,
});
const getDoc = (id) => db.table('procurement_documents').find((d) => d.id === id);
const sharesOf = (id) => db.table('procurement_document_shares').filter((s) => s.document_id === id);
const filesOf = (id) => db.table('procurement_document_files').filter((f) => f.document_id === id);

async function call(handler, { user, params = {}, body = {}, reqFile = null }) {
  const res = createFakeRes();
  await handler({ user, params, body, file: reqFile, headers: {}, get: () => undefined }, res);
  return res;
}

// ── Pure rules ─────────────────────────────────────────────────────────────

test('who may create what: SmartBook never issues an invoice for the supplier, staff only uploads receiving scans', () => {
  assert.doesNotThrow(() => docs.assertCanCreate(supplierActor, 'VAT_INVOICE'));
  assert.doesNotThrow(() => docs.assertCanCreate(supplierActor, 'PROFORMA_INVOICE'));
  assert.throws(() => docs.assertCanCreate(supplierActor, 'DELIVERY_ACCEPTANCE_MINUTES'), (e) => e.statusCode === 403);
  assert.throws(() => docs.assertCanCreate(managerActor, 'VAT_INVOICE'), (e) => e.statusCode === 403);
  assert.throws(() => docs.assertCanCreate(managerActor, 'DELIVERY_NOTE'), (e) => e.statusCode === 403);
  assert.throws(() => docs.assertCanCreate(staffActor, 'SALES_INVOICE'), (e) => e.statusCode === 403);
  assert.throws(() => docs.assertCanCreate(staffActor, 'PAYMENT_EVIDENCE'), (e) => e.statusCode === 403);
  assert.doesNotThrow(() => docs.assertCanCreate(staffActor, 'DELIVERY_ACCEPTANCE_MINUTES'));
});

test('invoice amounts are computed from lines and inconsistent totals are rejected', () => {
  const lines = [{ quantity: 100, unit_price: 50000 }];
  assert.deepEqual(docs.computeInvoiceAmounts({ lines, tax_rate: 5 }), { subtotal_amount: 5000000, tax_rate: 5, tax_amount: 250000, total_amount: 5250000 });
  assert.throws(() => docs.computeInvoiceAmounts({ lines, tax_rate: 5, total_amount: 5000000 }), /Tổng tiền/);
  assert.throws(() => docs.computeInvoiceAmounts({ lines, subtotal_amount: 4000000 }), /Tiền hàng/);
});

test('sharing summary keeps SENT, DELIVERED, ACKNOWLEDGED and FAILED distinct', () => {
  assert.equal(docs.summarizeSharing([], 'SMARTBOOK').status, 'NOT_SHARED');
  assert.equal(docs.summarizeSharing([{ recipient_party: 'SUPPLIER', status: 'FAILED', channel: 'EMAIL' }], 'SMARTBOOK').status, 'FAILED');
  assert.equal(docs.summarizeSharing([{ recipient_party: 'SUPPLIER', status: 'SENT', channel: 'PORTAL' }], 'SMARTBOOK').status, 'SENT');
  assert.equal(docs.summarizeSharing([
    { recipient_party: 'SUPPLIER', status: 'FAILED', channel: 'EMAIL' },
    { recipient_party: 'SUPPLIER', status: 'DELIVERED', channel: 'PORTAL' },
  ], 'SMARTBOOK').status, 'DELIVERED');
});

test('file checks use the bytes, not the declared MIME type', () => {
  const storage = require('../src/services/procurement-document-storage.service');
  assert.equal(storage.detectFileKind(PDF).mime, 'application/pdf');
  assert.equal(storage.detectFileKind(XML).mime, 'application/xml');
  assert.equal(storage.detectFileKind(PNG).mime, 'image/png');
  assert.equal(storage.detectFileKind(EXE), null);
  assert.equal(storage.detectFileKind(Buffer.from('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>')), null);
  assert.throws(() => storage.inspectUpload({ buffer: EXE, originalname: 'invoice.pdf', mimetype: 'application/pdf' }), (e) => e.statusCode === 415);
  assert.throws(() => storage.resolveStoragePath('../../etc/passwd'), (e) => e.statusCode === 400);
  assert.equal(storage.sanitizeOriginalName('../../evil"name.pdf'), 'evil_name.pdf');
});

// ── Supplier invoice lifecycle ──────────────────────────────────────────────

test('supplier issues a VAT invoice with a PDF: stored with SHA-256, shared to SmartBook as SENT (not acknowledged)', async () => {
  const id = await docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: invoiceBody({ issue: 'true' }), file: file(PDF) });
  const doc = getDoc(id);
  assert.equal(doc.status, 'ISSUED');
  assert.equal(doc.issuer_party, 'SUPPLIER');
  assert.equal(Number(doc.total_amount), 5250000);
  assert.equal(doc.metadata.tax_authority_verified, false, 'an upload is never treated as a verified VAT invoice');
  const [stored] = filesOf(id);
  assert.equal(stored.sha256, crypto.createHash('sha256').update(PDF).digest('hex'));
  assert.equal(stored.version_no, 1);
  assert.ok(fs.existsSync(path.join(process.env.PROCUREMENT_DOCUMENT_DIR, stored.storage_ref)));
  assert.deepEqual(sharesOf(id).map((s) => [s.recipient_party, s.status]), [['SMARTBOOK', 'SENT']]);
});

test('XML e-invoice upload is accepted; an executable renamed .pdf is refused', async () => {
  const id = await docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: invoiceBody({ issue: 'true' }), file: file(XML, 'hoa-don.xml') });
  assert.equal(filesOf(id)[0].mime_type, 'application/xml');
  await assert.rejects(docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: invoiceBody(), file: file(EXE) }), (e) => e.statusCode === 415);
});

test('duplicate invoice number (same supplier + series) is rejected with 409', async () => {
  const body = invoiceBody({ issue: 'true' });
  await docs.createDocument(db.client, { actor: supplierActor, po: poA(), body, file: file(PDF) });
  await assert.rejects(docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: { ...body }, file: file(PDF) }), (e) => e.statusCode === 409);
});

test('several invoices for one PO are allowed (different numbers)', async () => {
  const before = db.table('procurement_documents').filter((d) => d.purchase_order_id === PO_A && d.document_type === 'VAT_INVOICE').length;
  await docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: invoiceBody({ issue: 'true', lines: JSON.stringify([{ purchase_order_item_id: 'poi-a1', quantity: 60, unit_price: 50000 }]) }), file: file(PDF) });
  await docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: invoiceBody({ issue: 'true', lines: JSON.stringify([{ purchase_order_item_id: 'poi-a1', quantity: 40, unit_price: 50000 }]) }), file: file(PDF) });
  const after = db.table('procurement_documents').filter((d) => d.purchase_order_id === PO_A && d.document_type === 'VAT_INVOICE').length;
  assert.equal(after - before, 2);
});

test('an invoice cannot be issued without its file', async () => {
  await assert.rejects(docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: invoiceBody({ issue: 'true' }) }), /đính kèm file/);
  const draftId = await docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: invoiceBody() });
  await assert.rejects(docs.issueDocument(db.client, { actor: supplierActor, doc: getDoc(draftId) }), /đính kèm file/);
});

test('an issued invoice file can never be replaced; SmartBook (staff or manager) cannot touch it at all', async () => {
  const id = await docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: invoiceBody({ issue: 'true' }), file: file(PDF) });
  await assert.rejects(docs.addFileVersion(db.client, { actor: supplierActor, doc: getDoc(id), file: file(PDF) }), (e) => e.statusCode === 409);
  await assert.rejects(docs.addFileVersion(db.client, { actor: staffActor, doc: getDoc(id), file: file(PDF) }), (e) => e.statusCode === 403);
  await assert.rejects(docs.cancelDocument(db.client, { actor: managerActor, doc: getDoc(id), reason: 'x' }), (e) => e.statusCode === 403);
  assert.equal(filesOf(id).length, 1);
});

test('a wrong invoice is corrected by a replacement that supersedes it (history kept, nothing deleted)', async () => {
  const oldId = await docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: invoiceBody({ issue: 'true' }), file: file(PDF) });
  const newId = await docs.createDocument(db.client, { actor: supplierActor, po: poA(), body: invoiceBody({ issue: 'true', supersedes_document_id: oldId }), file: file(PDF) });
  assert.equal(getDoc(oldId).status, 'SUPERSEDED');
  assert.equal(getDoc(newId).status, 'ISSUED');
  assert.equal(filesOf(oldId).length, 1, 'old file kept');
  // cancelling needs a reason and is recorded
  await assert.rejects(docs.cancelDocument(db.client, { actor: supplierActor, doc: getDoc(newId), reason: '' }), /lý do/);
  await docs.cancelDocument(db.client, { actor: supplierActor, doc: getDoc(newId), reason: 'Sai mã số thuế' });
  assert.equal(getDoc(newId).status, 'CANCELLED');
  assert.ok(db.table('inventory_audit_logs').some((l) => l.entity_id === newId && l.action_name === 'PROCUREMENT_DOCUMENT_CANCELLED'));
});

// ── Signed delivery minutes ─────────────────────────────────────────────────

test('minutes without a scan are PENDING_SIGNED_DOCUMENT; uploading a scan is SCAN_UPLOADED, never "signed"', async () => {
  const id = await docs.createDocument(db.client, {
    actor: staffActor,
    po: poA(),
    body: { document_type: 'DELIVERY_ACCEPTANCE_MINUTES', goods_receipt_id: GR, metadata: JSON.stringify({ signed_date: '2026-11-12', supplier_representative: 'Ông B', library_representative: 'Bà C', confirmed_qty: 95 }) },
  });
  assert.equal(getDoc(id).status, 'PENDING_SIGNED_DOCUMENT');
  await assert.rejects(docs.shareDocument(db.client, { actor: managerActor, doc: getDoc(id), channel: 'PORTAL', sendMail: async () => ({ ok: true }) }), /scan/);

  await docs.addFileVersion(db.client, { actor: staffActor, doc: getDoc(id), file: file(PDF, 'bien-ban.pdf') });
  assert.equal(getDoc(id).status, 'SCAN_UPLOADED');
  assert.equal(getDoc(id).metadata.signature_verified, false);
  const [v1] = filesOf(id);
  assert.equal(v1.uploaded_by_user_id, STAFF);
  assert.equal(v1.sha256, crypto.createHash('sha256').update(PDF).digest('hex'));

  // A rescan is a new version; the first stays.
  await docs.addFileVersion(db.client, { actor: staffActor, doc: getDoc(id), file: file(PNG, 'bien-ban.png') });
  assert.deepEqual(filesOf(id).map((f) => f.version_no).sort(), [1, 2]);
});

test('a staff member not assigned to the receipt cannot upload minutes for it', async () => {
  const other = { party: 'SMARTBOOK', userId: OTHER_STAFF, role: 'STAFF', user: otherStaffUser };
  await assert.rejects(
    docs.createDocument(db.client, { actor: other, po: poA(), body: { document_type: 'DELIVERY_ACCEPTANCE_MINUTES', goods_receipt_id: GR } }),
    (e) => e.statusCode === 403,
  );
});

// ── Sharing statuses ────────────────────────────────────────────────────────

async function scannedMinutes() {
  const id = await docs.createDocument(db.client, { actor: managerActor, po: poA(), body: { document_type: 'DELIVERY_ACCEPTANCE_MINUTES', goods_receipt_id: GR }, file: file(PDF) });
  return id;
}

test('e-mail that fails is stored as FAILED with the error and does not expose the document to the supplier', async () => {
  const id = await scannedMinutes();
  await docs.shareDocument(db.client, { actor: managerActor, doc: getDoc(id), channel: 'EMAIL', supplierEmail: 'a@supplier.test', portalUrl: 'http://x/supplier', sendMail: async () => ({ ok: false, error: 'connect ECONNREFUSED' }) });
  const [share] = sharesOf(id);
  assert.equal(share.status, 'FAILED');
  assert.equal(share.error_message, 'connect ECONNREFUSED');
  assert.equal(share.recipient_email, 'a@supplier.test');
  const full = await db.client.procurement_documents.findUnique({ where: { id }, include: docs.documentInclude() });
  assert.equal(docs.canActorSeeDocument(supplierActor, full), false);
});

test('e-mail accepted by SMTP is SENT with its message id — not DELIVERED, not ACKNOWLEDGED', async () => {
  const id = await scannedMinutes();
  await docs.shareDocument(db.client, { actor: managerActor, doc: getDoc(id), channel: 'EMAIL', supplierEmail: 'a@supplier.test', portalUrl: 'http://x/supplier', sendMail: async () => ({ ok: true, messageId: '<abc@smartbook>' }) });
  const [share] = sharesOf(id);
  assert.equal(share.status, 'SENT');
  assert.equal(share.message_id, '<abc@smartbook>');
  assert.equal(share.acknowledged_at, null);
});

test('portal share -> SENT; supplier opens it -> DELIVERED; supplier confirms -> ACKNOWLEDGED', async () => {
  const id = await scannedMinutes();
  await assert.rejects(docs.acknowledgeDocument(db.client, { actor: supplierActor, doc: getDoc(id) }), /chưa được chia sẻ/);
  await docs.shareDocument(db.client, { actor: managerActor, doc: getDoc(id), channel: 'PORTAL', sendMail: async () => ({ ok: true }) });
  assert.equal(sharesOf(id)[0].status, 'SENT');
  assert.equal(await docs.markDelivered(db.client, { actor: managerActor, doc: getDoc(id) }), 0, 'issuer opening its own doc is not a delivery');
  await docs.markDelivered(db.client, { actor: supplierActor, doc: getDoc(id) });
  assert.equal(sharesOf(id)[0].status, 'DELIVERED');
  assert.ok(sharesOf(id)[0].delivered_at);
  await docs.acknowledgeDocument(db.client, { actor: supplierActor, doc: getDoc(id) });
  assert.equal(sharesOf(id)[0].status, 'ACKNOWLEDGED');
  assert.equal(sharesOf(id)[0].acknowledged_by_user_id, 'user-sup-a');
  await assert.rejects(docs.acknowledgeDocument(db.client, { actor: supplierActor, doc: getDoc(id) }), (e) => e.statusCode === 409);
});

test('staff cannot share documents with the supplier', async () => {
  const id = await scannedMinutes();
  await assert.rejects(docs.shareDocument(db.client, { actor: staffActor, doc: getDoc(id), channel: 'PORTAL', sendMail: async () => ({ ok: true }) }), (e) => e.statusCode === 403);
});

// ── HTTP layer: same record for both roles, isolation between suppliers ───────

test('supplier and warehouse see the SAME invoice record (one id, one file, one history)', async () => {
  const created = await call(controller.supplier.create, { user: supplierUser(SUP_A), params: { poId: PO_A }, body: invoiceBody({ issue: 'true' }), reqFile: file(PDF) });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const docId = created.body.data.id;

  const supplierList = await call(controller.supplier.list, { user: supplierUser(SUP_A), params: { poId: PO_A } });
  const managerList = await call(controller.internal.list, { user: managerUser, params: { poId: PO_A } });
  const staffList = await call(controller.internal.list, { user: staffUser, params: { poId: PO_A } });
  for (const list of [supplierList, managerList, staffList]) {
    assert.equal(list.statusCode, 200);
    const found = list.body.data.documents.find((d) => d.id === docId);
    assert.ok(found, 'document visible');
    assert.equal(found.files[0].sha256, crypto.createHash('sha256').update(PDF).digest('hex'));
  }
  assert.equal(db.table('procurement_documents').filter((d) => d.id === docId).length, 1, 'no per-role copy');
  // supplier view never carries SmartBook internal notes
  assert.equal(supplierList.body.data.documents[0].internal_note, undefined);
});

test('both roles download the exact same bytes; each download is audited and marks delivery', async () => {
  const created = await call(controller.supplier.create, { user: supplierUser(SUP_A), params: { poId: PO_A }, body: invoiceBody({ issue: 'true' }), reqFile: file(PDF) });
  const doc = created.body.data;
  async function download(handler, user) {
    const res = createFakeRes();
    const sink = new PassThrough();
    const chunks = [];
    sink.on('data', (c) => chunks.push(c));
    Object.assign(sink, { setHeader: res.setHeader, headers: res.headers, status: res.status, json: res.json, headersSent: false });
    const done = new Promise((resolve) => sink.on('end', resolve));
    await handler({ user, params: { docId: doc.id, fileId: doc.files[0].id } }, sink);
    await done;
    return { bytes: Buffer.concat(chunks), headers: sink.headers };
  }
  const bySupplier = await download(controller.supplier.download, supplierUser(SUP_A));
  const byManager = await download(controller.internal.download, managerUser);
  assert.ok(bySupplier.bytes.equals(PDF));
  assert.ok(byManager.bytes.equals(PDF));
  assert.equal(byManager.headers['x-content-type-options'], 'nosniff');
  assert.match(byManager.headers['content-disposition'], /^attachment;/);
  assert.equal(sharesOf(doc.id).find((s) => s.recipient_party === 'SMARTBOOK').status, 'DELIVERED');
  assert.equal(db.table('inventory_audit_logs').filter((l) => l.entity_id === doc.id && l.action_name === 'PROCUREMENT_DOCUMENT_DOWNLOADED').length, 2);
});

test('supplier B cannot list, open or download supplier A documents by swapping ids', async () => {
  const created = await call(controller.supplier.create, { user: supplierUser(SUP_A), params: { poId: PO_A }, body: invoiceBody({ issue: 'true' }), reqFile: file(PDF) });
  const doc = created.body.data;
  const asB = supplierUser(SUP_B);
  assert.equal((await call(controller.supplier.list, { user: asB, params: { poId: PO_A } })).statusCode, 404);
  assert.equal((await call(controller.supplier.get, { user: asB, params: { docId: doc.id } })).statusCode, 404);
  assert.equal((await call(controller.supplier.download, { user: asB, params: { docId: doc.id, fileId: doc.files[0].id } })).statusCode, 404);
  assert.equal((await call(controller.supplier.create, { user: asB, params: { poId: PO_A }, body: invoiceBody(), reqFile: file(PDF) })).statusCode, 404);
});

test('warehouse staff only see POs they have a receipt assigned for, and cannot create invoices', async () => {
  assert.equal((await call(controller.internal.list, { user: otherStaffUser, params: { poId: PO_A } })).statusCode, 404);
  const res = await call(controller.internal.create, { user: staffUser, params: { poId: PO_A }, body: invoiceBody(), reqFile: file(PDF) });
  assert.equal(res.statusCode, 403);
});

test('a supplier draft stays private until issued', async () => {
  const draft = await call(controller.supplier.create, { user: supplierUser(SUP_A), params: { poId: PO_A }, body: invoiceBody(), reqFile: file(PDF) });
  assert.equal(draft.body.data.status, 'DRAFT');
  const managerView = await call(controller.internal.get, { user: managerUser, params: { docId: draft.body.data.id } });
  assert.equal(managerView.statusCode, 404);
  await call(controller.supplier.issue, { user: supplierUser(SUP_A), params: { docId: draft.body.data.id } });
  assert.equal((await call(controller.internal.get, { user: managerUser, params: { docId: draft.body.data.id } })).statusCode, 200);
});

test('warehouse acknowledges a supplier invoice: only the SmartBook recipient row changes', async () => {
  const created = await call(controller.supplier.create, { user: supplierUser(SUP_A), params: { poId: PO_A }, body: invoiceBody({ issue: 'true' }), reqFile: file(PDF) });
  const id = created.body.data.id;
  const ack = await call(controller.internal.acknowledge, { user: managerUser, params: { docId: id } });
  assert.equal(ack.statusCode, 200, JSON.stringify(ack.body));
  assert.equal(ack.body.data.sharing.status, 'ACKNOWLEDGED');
  // the supplier (issuer) cannot "acknowledge" its own invoice
  assert.equal((await call(controller.supplier.acknowledge, { user: supplierUser(SUP_A), params: { docId: id } })).statusCode, 409);
});

test('a delivery note already sent to the warehouse cannot be cancelled (corrected via a discrepancy report)', async () => {
  const id = (await db.client.procurement_documents.create({
    data: { document_number: 'DN-TEST-1', document_type: 'DELIVERY_NOTE', issuer_party: 'SUPPLIER', status: 'ISSUED', purchase_order_id: PO_A, supplier_id: SUP_A },
  })).id;
  await assert.rejects(docs.cancelDocument(db.client, { actor: supplierActor, doc: getDoc(id), reason: 'nhầm' }), (e) => e.statusCode === 409);
  assert.equal(getDoc(id).status, 'ISSUED');
});
