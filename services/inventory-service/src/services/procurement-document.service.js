// Shared procurement document registry: one record per document, seen by the supplier and by
// SmartBook (warehouse staff / purchasing manager). Rules enforced here, not in the UI:
//   - only the issuing party may upload versions, issue, or cancel its own documents;
//   - an issued invoice is immutable (no new file version, no edit) — corrections are a
//     cancellation or a replacement document that supersedes it;
//   - nothing is ever deleted; every file upload is a new version row with a SHA-256;
//   - SENT, DELIVERED and ACKNOWLEDGED are tracked separately per recipient.

const crypto = require("crypto");
const { inspectUpload, writeVersionFile, removeOrphanFile } = require("./procurement-document-storage.service");

const DOCUMENT_TYPES = {
  VAT_INVOICE: { prefix: "INV", issuer: "SUPPLIER", invoice: true, label: "Hóa đơn GTGT điện tử" },
  SALES_INVOICE: { prefix: "INV", issuer: "SUPPLIER", invoice: true, label: "Hóa đơn bán hàng" },
  PROFORMA_INVOICE: { prefix: "PINV", issuer: "SUPPLIER", invoice: true, label: "Hóa đơn chiếu lệ / báo giá" },
  DELIVERY_NOTE: { prefix: "DN", issuer: "SUPPLIER", label: "Phiếu giao hàng" },
  GOODS_RECEIPT_CONFIRMATION: { prefix: "GRC", issuer: "SMARTBOOK", label: "Xác nhận kết quả nhận hàng" },
  DELIVERY_ACCEPTANCE_MINUTES: { prefix: "BBGN", issuer: "SMARTBOOK", label: "Biên bản giao nhận (bản scan đã ký)" },
  DISCREPANCY_REPORT: { prefix: "BBCL", issuer: "SMARTBOOK", label: "Biên bản chênh lệch" },
  PAYMENT_EVIDENCE: { prefix: "PAY", issuer: "SMARTBOOK", label: "Chứng từ thanh toán" },
  OTHER: { prefix: "DOC", issuer: null, label: "Chứng từ khác" },
};

// Documents a supplier may create from its portal / a SmartBook user may create internally.
const SUPPLIER_CREATABLE = new Set(["VAT_INVOICE", "SALES_INVOICE", "PROFORMA_INVOICE", "DELIVERY_NOTE", "OTHER"]);
const SMARTBOOK_CREATABLE = new Set(["DELIVERY_ACCEPTANCE_MINUTES", "DISCREPANCY_REPORT", "PAYMENT_EVIDENCE", "OTHER"]);
const STAFF_CREATABLE = new Set(["DELIVERY_ACCEPTANCE_MINUTES", "DISCREPANCY_REPORT"]);

const LIVE_STATUSES = ["DRAFT", "ISSUED", "PENDING_SIGNED_DOCUMENT", "SCAN_UPLOADED"];
const SHAREABLE_STATUSES = new Set(["ISSUED", "SCAN_UPLOADED"]);

class DocumentError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

function text(value, max = 500) {
  const v = String(value ?? "").trim();
  return v ? v.slice(0, max) : null;
}

function money(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new DocumentError("Số tiền phải là số không âm");
  return Math.round(n * 100) / 100;
}

function dateOrNull(value, label) {
  const v = text(value, 40);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new DocumentError(`${label} không hợp lệ`);
  return d;
}

function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    throw new DocumentError("Dữ liệu JSON không hợp lệ");
  }
}

function createDocumentNumber(type, now = new Date()) {
  const prefix = DOCUMENT_TYPES[type]?.prefix || "DOC";
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${ymd}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function isInvoiceType(type) {
  return Boolean(DOCUMENT_TYPES[type]?.invoice);
}

/** Pure: who may create which type. Throws DocumentError. */
function assertCanCreate(actor, type) {
  if (!DOCUMENT_TYPES[type]) throw new DocumentError("Loại chứng từ không hợp lệ");
  if (actor.party === "SUPPLIER") {
    if (!SUPPLIER_CREATABLE.has(type)) throw new DocumentError("Nhà cung cấp không được lập loại chứng từ này", 403);
    return;
  }
  if (actor.role === "STAFF") {
    if (!STAFF_CREATABLE.has(type)) throw new DocumentError("Nhân viên kho chỉ được tải biên bản giao nhận / biên bản chênh lệch", 403);
    return;
  }
  if (!SMARTBOOK_CREATABLE.has(type)) {
    throw new DocumentError("SmartBook không được tự phát hành hóa đơn hay phiếu giao hàng thay nhà cung cấp", 403);
  }
}

/** Pure: invoice money fields. Computes what is missing and rejects inconsistent totals. */
function computeInvoiceAmounts({ lines = [], subtotal_amount, tax_rate, tax_amount, total_amount }) {
  const lineSum = lines.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price), 0);
  const subtotal = money(subtotal_amount) ?? (lines.length > 0 ? Math.round(lineSum * 100) / 100 : null);
  const rate = tax_rate === undefined || tax_rate === null || tax_rate === "" ? null : Number(tax_rate);
  if (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100)) throw new DocumentError("Thuế suất phải trong khoảng 0-100%");
  let tax = money(tax_amount);
  if (tax === null && rate !== null && subtotal !== null) tax = Math.round(subtotal * rate) / 100;
  let total = money(total_amount);
  if (total === null && subtotal !== null) total = Math.round((subtotal + (tax || 0)) * 100) / 100;
  if (subtotal !== null && lines.length > 0 && Math.abs(subtotal - lineSum) > 1) {
    throw new DocumentError("Tiền hàng không khớp tổng các dòng hóa đơn");
  }
  if (subtotal !== null && total !== null && Math.abs(subtotal + (tax || 0) - total) > 1) {
    throw new DocumentError("Tổng tiền phải bằng tiền hàng + tiền thuế");
  }
  return { subtotal_amount: subtotal, tax_rate: rate, tax_amount: tax, total_amount: total };
}

/** Pure: can this actor see this document (with its shares)? */
function canActorSeeDocument(actor, doc) {
  if (actor.party === "SUPPLIER") {
    if (String(doc.supplier_id) !== String(actor.supplierId)) return false;
    if (doc.issuer_party === "SUPPLIER") return true;
    return (doc.procurement_document_shares || []).some((share) => share.recipient_party === "SUPPLIER" && share.status !== "FAILED");
  }
  // SmartBook side never sees a supplier's unissued draft.
  if (doc.issuer_party === "SUPPLIER" && doc.status === "DRAFT") return false;
  return true;
}

function lineTitle(line) {
  return line.book_variants?.books?.title || null;
}

/** Shape for the API. Supplier view never gets internal notes, staff ids or storage paths. */
function mapDocument(doc, actor) {
  const forSupplier = actor.party === "SUPPLIER";
  const metadata = doc.metadata && typeof doc.metadata === "object" ? { ...doc.metadata } : {};
  if (forSupplier) delete metadata.internal;
  const shares = (doc.procurement_document_shares || []).map((share) => ({
    id: share.id,
    channel: share.channel,
    recipient_party: share.recipient_party,
    recipient_email: forSupplier ? null : share.recipient_email,
    status: share.status,
    message_id: forSupplier ? null : share.message_id,
    error_message: forSupplier ? null : share.error_message,
    shared_at: share.shared_at,
    delivered_at: share.delivered_at,
    acknowledged_at: share.acknowledged_at,
  }));
  return {
    id: doc.id,
    document_number: doc.document_number,
    document_type: doc.document_type,
    document_type_label: DOCUMENT_TYPES[doc.document_type]?.label || doc.document_type,
    issuer_party: doc.issuer_party,
    external_number: doc.external_number,
    invoice_series: doc.invoice_series,
    status: doc.status,
    purchase_order_id: doc.purchase_order_id,
    po_number: doc.purchase_orders?.po_number || null,
    supplier_id: doc.supplier_id,
    supplier_name: doc.suppliers?.name || null,
    supplier_delivery_invoice_id: doc.supplier_delivery_invoice_id,
    goods_receipt_id: doc.goods_receipt_id,
    goods_receipt_number: doc.goods_receipts?.receipt_number || null,
    shortage_report_id: doc.shortage_report_id,
    supersedes_document_id: doc.supersedes_document_id,
    superseded_by: (doc.superseded_by || []).map((next) => ({ id: next.id, document_number: next.document_number, status: next.status })),
    issue_date: doc.issue_date,
    subtotal_amount: doc.subtotal_amount == null ? null : Number(doc.subtotal_amount),
    tax_rate: doc.tax_rate == null ? null : Number(doc.tax_rate),
    tax_amount: doc.tax_amount == null ? null : Number(doc.tax_amount),
    total_amount: doc.total_amount == null ? null : Number(doc.total_amount),
    metadata,
    internal_note: forSupplier ? undefined : doc.internal_note,
    cancel_reason: doc.cancel_reason,
    created_by_party: doc.issuer_party,
    issued_at: doc.issued_at,
    cancelled_at: doc.cancelled_at,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    lines: (doc.procurement_document_lines || []).map((line) => ({
      id: line.id,
      purchase_order_item_id: line.purchase_order_item_id,
      variant_id: line.variant_id,
      title: lineTitle(line),
      isbn13: line.book_variants?.isbn13 || null,
      quantity: Number(line.quantity),
      unit_price: Number(line.unit_price),
      line_amount: Number(line.line_amount),
      note: line.note,
    })),
    files: (doc.procurement_document_files || [])
      .slice()
      .sort((a, b) => b.version_no - a.version_no)
      .map((file) => ({
        id: file.id,
        version_no: file.version_no,
        original_name: file.original_name,
        mime_type: file.mime_type,
        size_bytes: file.size_bytes,
        sha256: file.sha256,
        uploaded_by_party: file.uploaded_by_party,
        created_at: file.created_at,
      })),
    shares,
    sharing: summarizeSharing(shares, doc.issuer_party),
  };
}

/** Pure: one sharing status per recipient party (never collapses SENT into ACKNOWLEDGED). */
function summarizeSharing(shares, issuerParty) {
  const recipient = issuerParty === "SUPPLIER" ? "SMARTBOOK" : "SUPPLIER";
  const rows = shares.filter((share) => share.recipient_party === recipient);
  if (rows.length === 0) return { recipient_party: recipient, status: "NOT_SHARED" };
  const rank = { FAILED: 0, SENT: 1, DELIVERED: 2, ACKNOWLEDGED: 3 };
  const best = rows.reduce((top, row) => ((rank[row.status] ?? -1) > (rank[top.status] ?? -1) ? row : top), rows[0]);
  return {
    recipient_party: recipient,
    status: best.status,
    shared_at: rows.map((row) => row.shared_at).filter(Boolean).sort()[0] || null,
    delivered_at: rows.map((row) => row.delivered_at).filter(Boolean).sort()[0] || null,
    acknowledged_at: rows.map((row) => row.acknowledged_at).filter(Boolean).sort()[0] || null,
    channels: [...new Set(rows.map((row) => row.channel))],
  };
}

function documentInclude() {
  return {
    purchase_orders: { select: { po_number: true } },
    suppliers: { select: { name: true } },
    goods_receipts: { select: { receipt_number: true } },
    superseded_by: { select: { id: true, document_number: true, status: true } },
    procurement_document_lines: {
      include: { book_variants: { select: { isbn13: true, books: { select: { title: true } } } } },
      orderBy: { id: "asc" },
    },
    procurement_document_files: true,
    procurement_document_shares: { orderBy: { shared_at: "asc" } },
  };
}

async function audit(db, actor, action, documentId, afterData, beforeData = null) {
  await db.inventory_audit_logs.create({
    data: {
      actor_user_id: actor.userId || null,
      action_name: action,
      entity_type: "PROCUREMENT_DOCUMENT",
      entity_id: documentId,
      before_data: beforeData,
      after_data: { ...afterData, actor_party: actor.party },
    },
  });
}

/** Validate invoice lines against the PO (no remaining-qty limit: an invoice may precede delivery). */
function normalizeInvoiceLines(rawLines, poItems) {
  const byId = new Map(poItems.map((item) => [String(item.id), item]));
  const seen = new Set();
  return rawLines.map((raw) => {
    const poItem = byId.get(String(raw?.purchase_order_item_id || ""));
    if (!poItem) throw new DocumentError("Dòng hóa đơn phải thuộc đơn đặt hàng này");
    if (seen.has(poItem.id)) throw new DocumentError("Hóa đơn có dòng sách bị lặp");
    seen.add(poItem.id);
    const quantity = Number(raw?.quantity);
    const unitPrice = Number(raw?.unit_price);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new DocumentError("Số lượng trên hóa đơn phải là số nguyên > 0");
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new DocumentError("Đơn giá trên hóa đơn phải >= 0");
    return {
      purchase_order_item_id: poItem.id,
      variant_id: poItem.variant_id,
      quantity,
      unit_price: unitPrice,
      line_amount: Math.round(quantity * unitPrice * 100) / 100,
      note: text(raw?.note),
    };
  });
}

async function findDuplicateInvoice(db, { supplierId, series, number, excludeId }) {
  const candidates = await db.procurement_documents.findMany({
    where: {
      supplier_id: supplierId,
      document_type: { in: ["VAT_INVOICE", "SALES_INVOICE", "PROFORMA_INVOICE"] },
      status: { not: "CANCELLED" },
      external_number: { equals: number, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, document_number: true, invoice_series: true },
  });
  return candidates.find((doc) => (doc.invoice_series || "") === (series || "")) || null;
}

/**
 * Create a document (optionally with its first file, optionally issuing it right away).
 * `po` must already be access-checked for `actor` and include purchase_order_items.
 */
async function createDocument(prisma, { actor, po, body = {}, file = null }) {
  const type = String(body.document_type || "").toUpperCase();
  assertCanCreate(actor, type);
  const issuerParty = actor.party;
  const fileInfo = file ? inspectUpload(file) : null;

  const data = {
    document_number: createDocumentNumber(type),
    document_type: type,
    issuer_party: issuerParty,
    purchase_order_id: po.id,
    supplier_id: po.supplier_id,
    created_by_user_id: actor.userId || null,
    external_number: text(body.external_number, 80),
    invoice_series: text(body.invoice_series, 30),
    issue_date: dateOrNull(body.issue_date, "Ngày chứng từ"),
    internal_note: actor.party === "SMARTBOOK" ? text(body.internal_note, 2000) : null,
    status: "DRAFT",
  };
  const metadata = parseJsonField(body.metadata, {});
  if (typeof metadata !== "object" || Array.isArray(metadata)) throw new DocumentError("metadata phải là object");
  let lines = [];

  if (isInvoiceType(type)) {
    if (!data.external_number) throw new DocumentError("Thiếu số hóa đơn");
    if (!data.issue_date) throw new DocumentError("Thiếu ngày lập hóa đơn");
    if (type === "VAT_INVOICE" && !data.invoice_series) throw new DocumentError("Hóa đơn GTGT phải có ký hiệu hóa đơn");
    lines = normalizeInvoiceLines(parseJsonField(body.lines, []), po.purchase_order_items || []);
    Object.assign(data, computeInvoiceAmounts({ ...body, lines }));
    data.metadata = {
      lookup_code: text(metadata.lookup_code, 120),
      lookup_url: text(metadata.lookup_url, 300),
      seller_tax_code: text(metadata.seller_tax_code, 20),
      buyer_tax_code: text(metadata.buyer_tax_code, 20),
      payment_due_date: text(metadata.payment_due_date, 20),
      note: text(metadata.note, 2000),
      // A supplier upload is a claimed document type; SmartBook has not verified it with the tax authority.
      tax_authority_verified: false,
    };
    const duplicate = await findDuplicateInvoice(prisma, { supplierId: po.supplier_id, series: data.invoice_series, number: data.external_number });
    if (duplicate) throw new DocumentError(`Số hóa đơn ${data.invoice_series ? `${data.invoice_series}/` : ""}${data.external_number} đã tồn tại (${duplicate.document_number})`, 409);
  } else if (type === "DELIVERY_NOTE") {
    const deliveryId = text(body.supplier_delivery_invoice_id, 40);
    if (!deliveryId) throw new DocumentError("Phiếu giao hàng phải gắn với một lần giao của đơn");
    const delivery = await prisma.supplier_delivery_invoices.findFirst({ where: { id: deliveryId, purchase_order_id: po.id } });
    if (!delivery) throw new DocumentError("Không tìm thấy lần giao hàng thuộc đơn này", 404);
    data.supplier_delivery_invoice_id = delivery.id;
    data.external_number = data.external_number || delivery.delivery_number || delivery.invoice_number;
    data.metadata = { note: text(metadata.note, 2000) };
  } else if (type === "DELIVERY_ACCEPTANCE_MINUTES" || type === "DISCREPANCY_REPORT") {
    const grId = text(body.goods_receipt_id, 40);
    if (type === "DELIVERY_ACCEPTANCE_MINUTES" && !grId) throw new DocumentError("Biên bản giao nhận phải gắn với một phiếu nhập kho");
    if (grId) {
      const receipt = await prisma.goods_receipts.findFirst({ where: { id: grId, purchase_order_id: po.id } });
      if (!receipt) throw new DocumentError("Không tìm thấy phiếu nhập kho thuộc đơn này", 404);
      if (actor.role === "STAFF" && String(receipt.received_by_user_id) !== String(actor.userId)) {
        throw new DocumentError("Phiếu nhập kho chưa được giao cho bạn", 403);
      }
      data.goods_receipt_id = receipt.id;
      data.supplier_delivery_invoice_id = receipt.supplier_delivery_invoice_id || null;
    }
    const reportId = text(body.shortage_report_id, 40);
    if (reportId) {
      const report = await prisma.supplier_shortage_reports.findFirst({ where: { id: reportId, purchase_order_id: po.id } });
      if (!report) throw new DocumentError("Không tìm thấy biên bản chênh lệch thuộc đơn này", 404);
      data.shortage_report_id = report.id;
    }
    data.metadata = {
      signed_date: text(metadata.signed_date, 20),
      supplier_representative: text(metadata.supplier_representative, 150),
      library_representative: text(metadata.library_representative, 150),
      confirmed_qty: metadata.confirmed_qty == null || metadata.confirmed_qty === "" ? null : Number(metadata.confirmed_qty),
      discrepancy_summary: text(metadata.discrepancy_summary, 2000),
      // Uploading a scan is NOT proof of signature: SmartBook never marks these as signed itself.
      signature_verified: false,
    };
    // Minutes without a scan stay PENDING_SIGNED_DOCUMENT; a scan makes it SCAN_UPLOADED (not "signed").
    data.status = type === "DELIVERY_ACCEPTANCE_MINUTES" ? (fileInfo ? "SCAN_UPLOADED" : "PENDING_SIGNED_DOCUMENT") : (fileInfo ? "ISSUED" : "DRAFT");
  } else if (type === "PAYMENT_EVIDENCE") {
    data.metadata = {
      payment_reference: text(metadata.payment_reference, 120),
      paid_amount: metadata.paid_amount == null || metadata.paid_amount === "" ? null : money(metadata.paid_amount),
      paid_date: text(metadata.paid_date, 20),
      note: text(metadata.note, 2000),
    };
    data.status = fileInfo ? "ISSUED" : "DRAFT";
  } else {
    data.metadata = { note: text(metadata.note, 2000) };
    data.status = fileInfo ? "ISSUED" : "DRAFT";
  }

  const supersedesId = text(body.supersedes_document_id, 40);
  if (supersedesId) {
    const previous = await prisma.procurement_documents.findFirst({
      where: { id: supersedesId, purchase_order_id: po.id, supplier_id: po.supplier_id, issuer_party: issuerParty },
    });
    if (!previous) throw new DocumentError("Không tìm thấy chứng từ cần thay thế", 404);
    if (previous.status !== "ISSUED") throw new DocumentError("Chỉ thay thế được chứng từ đã phát hành");
    if (isInvoiceType(previous.document_type) !== isInvoiceType(type)) throw new DocumentError("Chứng từ thay thế phải cùng nhóm loại chứng từ");
    data.supersedes_document_id = previous.id;
  }

  const wantsIssue = String(body.issue ?? "").toLowerCase() === "true" || body.issue === true;
  if (wantsIssue && isInvoiceType(type) && !fileInfo) throw new DocumentError("Cần đính kèm file hóa đơn (PDF/XML) trước khi phát hành");

  let storageRef = null;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const doc = await tx.procurement_documents.create({ data });
      if (lines.length > 0) {
        await tx.procurement_document_lines.createMany({ data: lines.map((line) => ({ ...line, document_id: doc.id })) });
      }
      if (fileInfo) {
        storageRef = await writeVersionFile({ documentId: doc.id, versionNo: 1, buffer: file.buffer, info: fileInfo });
        await tx.procurement_document_files.create({
          data: {
            document_id: doc.id,
            version_no: 1,
            storage_ref: storageRef,
            original_name: fileInfo.original_name,
            mime_type: fileInfo.mime_type,
            size_bytes: fileInfo.size_bytes,
            sha256: fileInfo.sha256,
            uploaded_by_user_id: actor.userId || null,
            uploaded_by_party: issuerParty,
          },
        });
      }
      await audit(tx, actor, "PROCUREMENT_DOCUMENT_CREATED", doc.id, {
        purchase_order_id: po.id,
        document_type: type,
        document_number: doc.document_number,
        external_number: doc.external_number,
        status: doc.status,
        file_sha256: fileInfo?.sha256 || null,
      });
      if (wantsIssue && doc.status === "DRAFT") await issueInTransaction(tx, actor, doc);
      return doc;
    });
    return created.id;
  } catch (error) {
    if (storageRef) await removeOrphanFile(storageRef);
    if (error?.code === "P2002") throw new DocumentError("Số hóa đơn này đã tồn tại với nhà cung cấp", 409);
    throw error;
  }
}

async function issueInTransaction(tx, actor, doc) {
  const now = new Date();
  // Atomic claim: only one concurrent issue wins.
  const claimed = await tx.procurement_documents.updateMany({
    where: { id: doc.id, status: "DRAFT" },
    data: { status: "ISSUED", issued_at: now, updated_at: now },
  });
  if (claimed.count !== 1) throw new DocumentError("Chứng từ không còn ở trạng thái nháp", 409);
  if (doc.supersedes_document_id) {
    await tx.procurement_documents.updateMany({
      where: { id: doc.supersedes_document_id, status: "ISSUED" },
      data: { status: "SUPERSEDED", updated_at: now },
    });
    await audit(tx, actor, "PROCUREMENT_DOCUMENT_SUPERSEDED", doc.supersedes_document_id, { superseded_by: doc.id });
  }
  // The issuing party's counterpart can now see it in its portal / document center.
  await tx.procurement_document_shares.create({
    data: {
      document_id: doc.id,
      channel: "PORTAL",
      recipient_party: doc.issuer_party === "SUPPLIER" ? "SMARTBOOK" : "SUPPLIER",
      status: "SENT",
      shared_by_user_id: actor.userId || null,
      shared_at: now,
      updated_at: now,
    },
  });
  await audit(tx, actor, "PROCUREMENT_DOCUMENT_ISSUED", doc.id, { document_number: doc.document_number, document_type: doc.document_type });
}

function assertIssuer(actor, doc) {
  if (doc.issuer_party !== actor.party) {
    throw new DocumentError(
      actor.party === "SMARTBOOK" ? "Không được sửa chứng từ do nhà cung cấp phát hành" : "Không được sửa chứng từ do SmartBook phát hành",
      403,
    );
  }
}

async function issueDocument(prisma, { actor, doc }) {
  assertIssuer(actor, doc);
  if (doc.status !== "DRAFT") throw new DocumentError("Chỉ phát hành được chứng từ nháp", 409);
  if (actor.role === "STAFF") throw new DocumentError("Nhân viên kho không phát hành chứng từ", 403);
  const fileCount = await prisma.procurement_document_files.count({ where: { document_id: doc.id } });
  if (isInvoiceType(doc.document_type) && fileCount === 0) throw new DocumentError("Cần đính kèm file hóa đơn (PDF/XML) trước khi phát hành");
  await prisma.$transaction((tx) => issueInTransaction(tx, actor, doc));
}

async function addFileVersion(prisma, { actor, doc, file }) {
  assertIssuer(actor, doc);
  if (["CANCELLED", "SUPERSEDED"].includes(doc.status)) throw new DocumentError("Chứng từ đã hủy hoặc đã bị thay thế", 409);
  if (isInvoiceType(doc.document_type) && doc.status !== "DRAFT") {
    throw new DocumentError("Hóa đơn đã phát hành không được thay file gốc — hãy hủy hoặc lập hóa đơn thay thế", 409);
  }
  if (doc.document_type === "GOODS_RECEIPT_CONFIRMATION") throw new DocumentError("Xác nhận nhận hàng được tạo từ dữ liệu phiếu nhập, không tải file", 409);
  if (actor.role === "STAFF") {
    if (!["DELIVERY_ACCEPTANCE_MINUTES", "DISCREPANCY_REPORT"].includes(doc.document_type)) throw new DocumentError("Bạn không được tải file cho chứng từ này", 403);
    const receipt = doc.goods_receipt_id ? await prisma.goods_receipts.findUnique({ where: { id: doc.goods_receipt_id } }) : null;
    if (!receipt || String(receipt.received_by_user_id) !== String(actor.userId)) throw new DocumentError("Phiếu nhập kho chưa được giao cho bạn", 403);
  }
  const info = inspectUpload(file);
  let storageRef = null;
  try {
    await prisma.$transaction(async (tx) => {
      const latest = await tx.procurement_document_files.findFirst({ where: { document_id: doc.id }, orderBy: { version_no: "desc" } });
      const versionNo = (latest?.version_no || 0) + 1;
      storageRef = await writeVersionFile({ documentId: doc.id, versionNo, buffer: file.buffer, info });
      await tx.procurement_document_files.create({
        data: {
          document_id: doc.id,
          version_no: versionNo,
          storage_ref: storageRef,
          original_name: info.original_name,
          mime_type: info.mime_type,
          size_bytes: info.size_bytes,
          sha256: info.sha256,
          uploaded_by_user_id: actor.userId || null,
          uploaded_by_party: actor.party,
        },
      });
      const nextStatus = doc.document_type === "DELIVERY_ACCEPTANCE_MINUTES" && doc.status === "PENDING_SIGNED_DOCUMENT"
        ? "SCAN_UPLOADED"
        : (["DISCREPANCY_REPORT", "PAYMENT_EVIDENCE", "OTHER"].includes(doc.document_type) && doc.status === "DRAFT" && doc.issuer_party === "SMARTBOOK" ? "ISSUED" : doc.status);
      await tx.procurement_documents.update({ where: { id: doc.id }, data: { status: nextStatus, updated_at: new Date() } });
      await audit(tx, actor, "PROCUREMENT_DOCUMENT_FILE_UPLOADED", doc.id, {
        version_no: versionNo,
        sha256: info.sha256,
        size_bytes: info.size_bytes,
        mime_type: info.mime_type,
        status_after: nextStatus,
      }, { status: doc.status, previous_version_no: latest?.version_no || null });
    });
  } catch (error) {
    if (storageRef) await removeOrphanFile(storageRef);
    if (error?.code === "P2002") throw new DocumentError("Có người vừa tải phiên bản khác, hãy thử lại", 409);
    throw error;
  }
}

async function cancelDocument(prisma, { actor, doc, reason }) {
  assertIssuer(actor, doc);
  if (actor.role === "STAFF") throw new DocumentError("Nhân viên kho không hủy chứng từ", 403);
  const why = text(reason, 1000);
  if (!why) throw new DocumentError("Cần nhập lý do hủy chứng từ");
  if (!LIVE_STATUSES.includes(doc.status)) throw new DocumentError("Chứng từ đã hủy hoặc đã bị thay thế", 409);
  if (doc.document_type === "DELIVERY_NOTE") {
    throw new DocumentError("Phiếu giao hàng đã gửi kho không hủy được — sai lệch được xử lý bằng biên bản chênh lệch", 409);
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.procurement_documents.updateMany({
      where: { id: doc.id, status: doc.status },
      data: { status: "CANCELLED", cancel_reason: why, cancelled_at: now, cancelled_by_user_id: actor.userId || null, updated_at: now },
    });
    if (claimed.count !== 1) throw new DocumentError("Trạng thái chứng từ vừa thay đổi, hãy tải lại", 409);
    await audit(tx, actor, "PROCUREMENT_DOCUMENT_CANCELLED", doc.id, { reason: why, status_after: "CANCELLED" }, { status: doc.status });
  });
}

/**
 * Share a SmartBook-issued document with the supplier. PORTAL = published in the supplier
 * portal (SENT). EMAIL = notification e-mail with the portal link; SENT only when the SMTP
 * relay accepted it, FAILED otherwise (the failure is stored, never reported as sent).
 */
async function shareDocument(prisma, { actor, doc, channel, supplierEmail, portalUrl, sendMail }) {
  if (actor.party !== "SMARTBOOK" || actor.role === "STAFF") throw new DocumentError("Chỉ quản lý mua hàng được chia sẻ chứng từ cho nhà cung cấp", 403);
  if (doc.issuer_party !== "SMARTBOOK") throw new DocumentError("Chứng từ của nhà cung cấp đã có sẵn cho cả hai bên", 409);
  if (!SHAREABLE_STATUSES.has(doc.status)) {
    throw new DocumentError(doc.status === "PENDING_SIGNED_DOCUMENT" ? "Chưa có bản scan biên bản đã ký để chia sẻ" : "Chỉ chia sẻ được chứng từ đã phát hành", 409);
  }
  const ch = String(channel || "PORTAL").toUpperCase();
  if (!["PORTAL", "EMAIL"].includes(ch)) throw new DocumentError("Kênh chia sẻ không hợp lệ");
  const now = new Date();
  let status = "SENT";
  let messageId = null;
  let errorMessage = null;
  let recipientEmail = null;
  if (ch === "EMAIL") {
    recipientEmail = text(supplierEmail, 150);
    if (!recipientEmail) {
      status = "FAILED";
      errorMessage = "Nhà cung cấp chưa có email";
    } else {
      const label = DOCUMENT_TYPES[doc.document_type]?.label || "Chứng từ";
      const result = await sendMail({
        to: recipientEmail,
        subject: `[SmartBook] ${label} ${doc.document_number}`,
        text: `SmartBook đã chia sẻ ${label} ${doc.document_number}. Đăng nhập cổng nhà cung cấp để xem và xác nhận đã nhận: ${portalUrl}`,
        html: `<p>SmartBook đã chia sẻ <strong>${label}</strong> số <strong>${doc.document_number}</strong>.</p><p>Đăng nhập <a href="${portalUrl}">cổng nhà cung cấp</a> để xem, tải về và xác nhận đã nhận chứng từ.</p>`,
      });
      if (result.ok) messageId = result.messageId ? String(result.messageId).slice(0, 255) : null;
      else {
        status = "FAILED";
        errorMessage = result.error;
      }
    }
  }
  const share = await prisma.$transaction(async (tx) => {
    const row = await tx.procurement_document_shares.create({
      data: {
        document_id: doc.id,
        channel: ch,
        recipient_party: "SUPPLIER",
        recipient_email: recipientEmail,
        status,
        message_id: messageId,
        error_message: errorMessage,
        shared_by_user_id: actor.userId || null,
        shared_at: now,
        updated_at: now,
      },
    });
    await audit(tx, actor, status === "FAILED" ? "PROCUREMENT_DOCUMENT_SHARE_FAILED" : "PROCUREMENT_DOCUMENT_SHARED", doc.id, {
      channel: ch,
      recipient_email: recipientEmail,
      status,
      message_id: messageId,
      error_message: errorMessage,
    });
    return row;
  });
  return share;
}

/** Recipient opened/downloaded the document: SENT -> DELIVERED for that party only. */
async function markDelivered(prisma, { actor, doc }) {
  if (doc.issuer_party === actor.party) return 0;
  const now = new Date();
  const result = await prisma.procurement_document_shares.updateMany({
    where: { document_id: doc.id, recipient_party: actor.party, status: "SENT" },
    data: { status: "DELIVERED", delivered_at: now, updated_at: now },
  });
  return result.count;
}

/** Explicit "I received this document" from the recipient party. */
async function acknowledgeDocument(prisma, { actor, doc }) {
  if (doc.issuer_party === actor.party) throw new DocumentError("Bên phát hành không tự xác nhận đã nhận chứng từ của mình", 409);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const result = await tx.procurement_document_shares.updateMany({
      where: { document_id: doc.id, recipient_party: actor.party, status: { in: ["SENT", "DELIVERED"] } },
      data: { status: "ACKNOWLEDGED", acknowledged_at: now, acknowledged_by_user_id: actor.userId || null, updated_at: now },
    });
    if (result.count === 0) {
      const already = await tx.procurement_document_shares.count({ where: { document_id: doc.id, recipient_party: actor.party, status: "ACKNOWLEDGED" } });
      if (already > 0) throw new DocumentError("Chứng từ đã được xác nhận trước đó", 409);
      throw new DocumentError("Chứng từ chưa được chia sẻ cho bạn", 409);
    }
    // Delivered is implied by acknowledgement; keep delivered_at for rows that skipped it.
    await tx.procurement_document_shares.updateMany({
      where: { document_id: doc.id, recipient_party: actor.party, delivered_at: null, status: "ACKNOWLEDGED" },
      data: { delivered_at: now },
    });
    await audit(tx, actor, "PROCUREMENT_DOCUMENT_ACKNOWLEDGED", doc.id, { acknowledged_rows: result.count });
  });
}

/**
 * Register a supplier delivery batch (supplier_delivery_invoices row) in the shared registry as an
 * issued DELIVERY_NOTE, so both sides see the same record. Called inside the creating transaction.
 * `recordedBy` = SMARTBOOK when a manager keyed the supplier's paper delivery note on its behalf.
 */
async function registerDeliveryNote(tx, { delivery, items, actorUserId, recordedBy = "SUPPLIER" }) {
  const now = new Date();
  const doc = await tx.procurement_documents.create({
    data: {
      document_number: createDocumentNumber("DELIVERY_NOTE", now),
      document_type: "DELIVERY_NOTE",
      issuer_party: "SUPPLIER",
      external_number: delivery.delivery_number || delivery.invoice_number,
      status: "ISSUED",
      purchase_order_id: delivery.purchase_order_id,
      supplier_id: delivery.supplier_id,
      supplier_delivery_invoice_id: delivery.id,
      issue_date: delivery.invoice_date || null,
      metadata: {
        carrier_name: delivery.carrier_name || null,
        deliverer_name: delivery.deliverer_name || null,
        expected_delivery_date: delivery.expected_delivery_date || null,
        recorded_by: recordedBy,
      },
      created_by_user_id: actorUserId || null,
      issued_at: now,
    },
  });
  if (items.length > 0) {
    await tx.procurement_document_lines.createMany({
      data: items.map((item) => ({
        document_id: doc.id,
        purchase_order_item_id: item.purchase_order_item_id,
        variant_id: item.variant_id,
        quantity: item.invoiced_qty,
        unit_price: item.unit_cost,
        line_amount: Math.round(Number(item.invoiced_qty) * Number(item.unit_cost) * 100) / 100,
        note: item.note || null,
      })),
    });
  }
  await tx.procurement_document_shares.create({
    data: { document_id: doc.id, channel: "PORTAL", recipient_party: "SMARTBOOK", status: "SENT", shared_by_user_id: actorUserId || null, shared_at: now, updated_at: now },
  });
  await tx.inventory_audit_logs.create({
    data: {
      actor_user_id: actorUserId || null,
      action_name: "PROCUREMENT_DOCUMENT_ISSUED",
      entity_type: "PROCUREMENT_DOCUMENT",
      entity_id: doc.id,
      after_data: { document_type: "DELIVERY_NOTE", document_number: doc.document_number, supplier_delivery_invoice_id: delivery.id, recorded_by: recordedBy, actor_party: recordedBy },
    },
  });
  return doc;
}

module.exports = {
  DOCUMENT_TYPES,
  registerDeliveryNote,
  DocumentError,
  assertCanCreate,
  canActorSeeDocument,
  computeInvoiceAmounts,
  createDocument,
  createDocumentNumber,
  documentInclude,
  issueDocument,
  addFileVersion,
  cancelDocument,
  shareDocument,
  markDelivered,
  acknowledgeDocument,
  mapDocument,
  summarizeSharing,
  normalizeInvoiceLines,
  isInvoiceType,
  audit,
};
