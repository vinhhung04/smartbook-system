const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, normalizeText } = require("../utils/validation");
const { canReadWarehouse, canWriteWarehouse } = require("../utils/warehouse-scope.utils");
const { findAuthenticatedSupplier } = require("./supplier-portal.controller");
const { sendMail } = require("../lib/email-sender");
const { openReadStream } = require("../services/procurement-document-storage.service");
const docs = require("../services/procurement-document.service");

const MANAGER_ROLES = new Set(["ADMIN", "WAREHOUSE_MANAGER", "MANAGER"]);

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sendError(res, error, label) {
  if (error?.statusCode) return res.status(error.statusCode).json({ message: error.message });
  console.error(label, error);
  return res.status(500).json({ message: "Internal server error" });
}

// ── Actors ────────────────────────────────────────────────────────────────────

function internalActor(req) {
  const user = req.user || {};
  const roles = (Array.isArray(user.roles) ? user.roles : []).map((role) => String(role).toUpperCase());
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  const isManager = Boolean(user.is_superuser) || roles.some((role) => MANAGER_ROLES.has(role));
  return {
    party: "SMARTBOOK",
    userId: parseId(user.id || user.sub),
    role: isManager ? "MANAGER" : "STAFF",
    canApprove: Boolean(user.is_superuser) || permissions.includes("inventory.purchase.approve"),
    user,
  };
}

async function supplierActor(req) {
  const supplier = await findAuthenticatedSupplier(req);
  return { party: "SUPPLIER", userId: parseId(req.user?.id || req.user?.sub), supplierId: supplier.id, supplier, role: "SUPPLIER" };
}

const PO_INCLUDE = {
  suppliers: { select: { id: true, name: true, email: true } },
  purchase_order_items: { select: { id: true, variant_id: true, ordered_qty: true, received_qty: true, unit_cost: true } },
};

/** Load a PO the actor may access, or throw 404/403 (a supplier never learns another supplier's PO exists). */
async function loadAccessiblePo(actor, poId, { write = false } = {}) {
  if (!poId) throw httpError("Mã đơn đặt hàng không hợp lệ", 400);
  if (actor.party === "SUPPLIER") {
    const po = await prisma.purchase_orders.findFirst({
      where: { id: poId, supplier_id: actor.supplierId, supplier_order_dispatches: { some: { supplier_id: actor.supplierId } } },
      include: PO_INCLUDE,
    });
    if (!po) throw httpError("Không tìm thấy đơn của nhà cung cấp cho tài khoản này", 404);
    return po;
  }
  const po = await prisma.purchase_orders.findUnique({ where: { id: poId }, include: PO_INCLUDE });
  if (!po) throw httpError("Không tìm thấy đơn đặt hàng", 404);
  if (actor.role === "MANAGER") {
    const allowed = write ? await canWriteWarehouse(actor.user, po.warehouse_id) : await canReadWarehouse(actor.user, po.warehouse_id);
    if (!allowed) throw httpError("Bạn không có quyền truy cập kho của đơn này", 403);
    return po;
  }
  // Warehouse staff: only POs they have a goods receipt assigned for.
  const assigned = await prisma.goods_receipts.count({ where: { purchase_order_id: po.id, received_by_user_id: actor.userId } });
  if (assigned === 0) throw httpError("Không tìm thấy đơn đặt hàng", 404);
  return po;
}

async function loadAccessibleDocument(actor, docId, options = {}) {
  if (!docId) throw httpError("Mã chứng từ không hợp lệ", 400);
  const doc = await prisma.procurement_documents.findUnique({ where: { id: docId }, include: docs.documentInclude() });
  if (!doc) throw httpError("Không tìm thấy chứng từ", 404);
  const po = await loadAccessiblePo(actor, doc.purchase_order_id, options);
  if (!docs.canActorSeeDocument(actor, doc)) throw httpError("Không tìm thấy chứng từ", 404);
  return { doc, po };
}

async function reloadMapped(actor, docId) {
  const doc = await prisma.procurement_documents.findUnique({ where: { id: docId }, include: docs.documentInclude() });
  return docs.mapDocument(doc, actor);
}

// ── Shared handlers (actor resolver decides supplier vs SmartBook) ───────────────────

function handlers(resolveActor, poParam) {
  return {
    async list(req, res) {
      try {
        const actor = await resolveActor(req);
        const po = await loadAccessiblePo(actor, parseId(req.params[poParam]));
        const rows = await prisma.procurement_documents.findMany({
          where: { purchase_order_id: po.id },
          include: docs.documentInclude(),
          orderBy: { created_at: "desc" },
        });
        const visible = rows.filter((doc) => docs.canActorSeeDocument(actor, doc)).map((doc) => docs.mapDocument(doc, actor));
        return res.json({ data: { purchase_order_id: po.id, po_number: po.po_number, documents: visible } });
      } catch (error) {
        return sendError(res, error, "Error while listing procurement documents:");
      }
    },

    async get(req, res) {
      try {
        const actor = await resolveActor(req);
        const { doc } = await loadAccessibleDocument(actor, parseId(req.params.docId));
        await docs.markDelivered(prisma, { actor, doc });
        return res.json({ data: await reloadMapped(actor, doc.id) });
      } catch (error) {
        return sendError(res, error, "Error while loading procurement document:");
      }
    },

    async download(req, res) {
      try {
        const actor = await resolveActor(req);
        const { doc } = await loadAccessibleDocument(actor, parseId(req.params.docId));
        const fileId = parseId(req.params.fileId);
        const file = await prisma.procurement_document_files.findFirst({ where: { id: fileId, document_id: doc.id } });
        if (!file) throw httpError("Không tìm thấy file", 404);
        const stream = openReadStream(file.storage_ref);
        await docs.markDelivered(prisma, { actor, doc });
        await docs.audit(prisma, actor, "PROCUREMENT_DOCUMENT_DOWNLOADED", doc.id, { file_id: file.id, version_no: file.version_no, sha256: file.sha256 });
        res.setHeader("Content-Type", file.mime_type);
        res.setHeader("Content-Length", String(file.size_bytes));
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Document-SHA256", file.sha256);
        stream.on("error", (error) => {
          console.error("Error while streaming procurement document:", error);
          if (!res.headersSent) res.status(500).end();
          else res.destroy(error);
        });
        return stream.pipe(res);
      } catch (error) {
        return sendError(res, error, "Error while downloading procurement document:");
      }
    },

    async create(req, res) {
      try {
        const actor = await resolveActor(req);
        const po = await loadAccessiblePo(actor, parseId(req.params[poParam]), { write: true });
        if (["CANCELLED", "DRAFT", "PENDING_APPROVAL", "REJECTED"].includes(po.status)) {
          throw httpError("Đơn đặt hàng chưa được gửi cho nhà cung cấp", 409);
        }
        const id = await docs.createDocument(prisma, { actor, po, body: req.body || {}, file: req.file || null });
        return res.status(201).json({ message: "Đã tạo chứng từ", data: await reloadMapped(actor, id) });
      } catch (error) {
        return sendError(res, error, "Error while creating procurement document:");
      }
    },

    async uploadVersion(req, res) {
      try {
        const actor = await resolveActor(req);
        const { doc } = await loadAccessibleDocument(actor, parseId(req.params.docId), { write: true });
        await docs.addFileVersion(prisma, { actor, doc, file: req.file || null });
        return res.status(201).json({ message: "Đã tải phiên bản mới", data: await reloadMapped(actor, doc.id) });
      } catch (error) {
        return sendError(res, error, "Error while uploading procurement document version:");
      }
    },

    async issue(req, res) {
      try {
        const actor = await resolveActor(req);
        const { doc } = await loadAccessibleDocument(actor, parseId(req.params.docId), { write: true });
        await docs.issueDocument(prisma, { actor, doc });
        return res.json({ message: "Đã phát hành chứng từ", data: await reloadMapped(actor, doc.id) });
      } catch (error) {
        return sendError(res, error, "Error while issuing procurement document:");
      }
    },

    async cancel(req, res) {
      try {
        const actor = await resolveActor(req);
        const { doc } = await loadAccessibleDocument(actor, parseId(req.params.docId), { write: true });
        await docs.cancelDocument(prisma, { actor, doc, reason: req.body?.reason });
        return res.json({ message: "Đã hủy chứng từ", data: await reloadMapped(actor, doc.id) });
      } catch (error) {
        return sendError(res, error, "Error while cancelling procurement document:");
      }
    },

    async acknowledge(req, res) {
      try {
        const actor = await resolveActor(req);
        const { doc } = await loadAccessibleDocument(actor, parseId(req.params.docId), { write: true });
        await docs.acknowledgeDocument(prisma, { actor, doc });
        return res.json({ message: "Đã xác nhận nhận chứng từ", data: await reloadMapped(actor, doc.id) });
      } catch (error) {
        return sendError(res, error, "Error while acknowledging procurement document:");
      }
    },
  };
}

const internal = handlers(async (req) => internalActor(req), "poId");
const supplier = handlers(supplierActor, "poId");

// ── SmartBook-only handlers ──────────────────────────────────────────────────────

function publicPortalUrl() {
  const base = String(process.env.PUBLIC_WEB_URL || process.env.ALLOWED_ORIGINS || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
  return `${base}/supplier`;
}

async function shareInternalDocument(req, res) {
  try {
    const actor = internalActor(req);
    const { doc, po } = await loadAccessibleDocument(actor, parseId(req.params.docId), { write: true });
    await docs.shareDocument(prisma, {
      actor,
      doc,
      channel: req.body?.channel,
      supplierEmail: po.suppliers?.email,
      portalUrl: publicPortalUrl(),
      sendMail,
    });
    return res.status(201).json({ message: "Đã ghi nhận chia sẻ chứng từ", data: await reloadMapped(actor, doc.id) });
  } catch (error) {
    return sendError(res, error, "Error while sharing procurement document:");
  }
}

/** SmartBook issues a "goods receipt confirmation" built from a POSTED supplier receipt. */
async function issueGoodsReceiptConfirmation(req, res) {
  try {
    const actor = internalActor(req);
    if (actor.role !== "MANAGER") throw httpError("Chỉ quản lý được phát hành xác nhận nhận hàng", 403);
    const grId = parseId(req.params.grId);
    const receipt = await prisma.goods_receipts.findUnique({
      where: { id: grId || "" },
      include: {
        goods_receipt_items: { include: { book_variants: { select: { isbn13: true, books: { select: { title: true } } } } } },
        supplier_delivery_invoices: { include: { supplier_delivery_invoice_items: true } },
      },
    });
    if (!receipt || !receipt.purchase_order_id) throw httpError("Không tìm thấy phiếu nhập kho của đơn mua", 404);
    const po = await loadAccessiblePo(actor, receipt.purchase_order_id, { write: true });
    if (receipt.status !== "POSTED") throw httpError("Chỉ xác nhận được phiếu nhập kho đã ghi sổ", 409);
    const existing = await prisma.procurement_documents.count({
      where: { goods_receipt_id: receipt.id, document_type: "GOODS_RECEIPT_CONFIRMATION", status: { notIn: ["CANCELLED", "SUPERSEDED"] } },
    });
    if (existing > 0) throw httpError("Phiếu nhập này đã có xác nhận nhận hàng", 409);

    const noteByVariant = new Map((receipt.supplier_delivery_invoices?.supplier_delivery_invoice_items || []).map((item) => [String(item.variant_id), item]));
    const lines = receipt.goods_receipt_items.map((item) => {
      const noteQty = Number(noteByVariant.get(String(item.variant_id))?.invoiced_qty ?? 0);
      const delivered = item.delivered_qty ?? Number(item.quantity) + Number(item.damaged_qty || 0) + Number(item.rejected_qty || 0);
      return {
        title: item.book_variants?.books?.title || null,
        isbn13: item.book_variants?.isbn13 || null,
        delivery_note_qty: noteQty,
        delivered_qty: delivered,
        accepted_qty: Number(item.quantity),
        damaged_qty: Number(item.damaged_qty || 0),
        rejected_qty: Number(item.rejected_qty || 0),
        missing_qty: Math.max(0, noteQty - delivered),
      };
    });
    const now = new Date();
    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.procurement_documents.create({
        data: {
          document_number: docs.createDocumentNumber("GOODS_RECEIPT_CONFIRMATION", now),
          document_type: "GOODS_RECEIPT_CONFIRMATION",
          issuer_party: "SMARTBOOK",
          external_number: receipt.receipt_number,
          status: "ISSUED",
          purchase_order_id: po.id,
          supplier_id: po.supplier_id,
          supplier_delivery_invoice_id: receipt.supplier_delivery_invoice_id,
          goods_receipt_id: receipt.id,
          issue_date: now,
          metadata: {
            received_at: receipt.received_at,
            delivery_note_number: receipt.supplier_delivery_invoices?.delivery_number || receipt.supplier_delivery_invoices?.invoice_number || null,
            lines,
            note: normalizeText(req.body?.note),
            disclaimer: "Xác nhận kết quả kiểm nhận của SmartBook. Không phải hóa đơn.",
          },
          created_by_user_id: actor.userId,
          issued_at: now,
        },
      });
      await docs.audit(tx, actor, "PROCUREMENT_DOCUMENT_ISSUED", created.id, { document_type: "GOODS_RECEIPT_CONFIRMATION", goods_receipt_id: receipt.id });
      return created;
    });
    return res.status(201).json({ message: "Đã phát hành xác nhận nhận hàng", data: await reloadMapped(actor, doc.id) });
  } catch (error) {
    return sendError(res, error, "Error while issuing goods receipt confirmation:");
  }
}

/** Documents + receiving outcome for one goods receipt (used by the warehouse staff screen). */
async function getGoodsReceiptDocuments(req, res) {
  try {
    const actor = internalActor(req);
    const receipt = await prisma.goods_receipts.findUnique({
      where: { id: parseId(req.params.grId) || "" },
      include: { goods_receipt_items: { include: { book_variants: { select: { isbn13: true, books: { select: { title: true } } } } }, orderBy: { id: "asc" } } },
    });
    if (!receipt || !receipt.purchase_order_id) throw httpError("Không tìm thấy phiếu nhập kho của đơn mua", 404);
    const po = await loadAccessiblePo(actor, receipt.purchase_order_id);
    const noteItems = receipt.supplier_delivery_invoice_id
      ? await prisma.supplier_delivery_invoice_items.findMany({ where: { invoice_id: receipt.supplier_delivery_invoice_id } })
      : [];
    const noteByVariant = new Map(noteItems.map((item) => [String(item.variant_id), item]));
    const rows = await prisma.procurement_documents.findMany({
      where: {
        purchase_order_id: po.id,
        OR: [
          { goods_receipt_id: receipt.id },
          ...(receipt.supplier_delivery_invoice_id ? [{ supplier_delivery_invoice_id: receipt.supplier_delivery_invoice_id }] : []),
          { document_type: { in: ["VAT_INVOICE", "SALES_INVOICE", "PROFORMA_INVOICE"] } },
        ],
      },
      include: docs.documentInclude(),
      orderBy: { created_at: "desc" },
    });
    return res.json({
      data: {
        goods_receipt_id: receipt.id,
        receipt_number: receipt.receipt_number,
        status: receipt.status,
        purchase_order_id: po.id,
        po_number: po.po_number,
        can_upload_minutes: actor.role === "MANAGER" || String(receipt.received_by_user_id) === String(actor.userId),
        lines: receipt.goods_receipt_items.map((item) => ({
          id: item.id,
          variant_id: item.variant_id,
          title: item.book_variants?.books?.title || null,
          isbn13: item.book_variants?.isbn13 || null,
          delivery_note_qty: noteByVariant.has(String(item.variant_id)) ? Number(noteByVariant.get(String(item.variant_id)).invoiced_qty) : null,
          quantity: Number(item.quantity),
          actual_quantity: item.actual_quantity,
          delivered_qty: item.delivered_qty,
          damaged_qty: Number(item.damaged_qty || 0),
          rejected_qty: Number(item.rejected_qty || 0),
        })),
        documents: rows.filter((doc) => docs.canActorSeeDocument(actor, doc)).map((doc) => docs.mapDocument(doc, actor)),
      },
    });
  } catch (error) {
    return sendError(res, error, "Error while loading goods receipt documents:");
  }
}

/** Audit trail for everything attached to a PO (PO, deliveries, GRNs, discrepancies, documents, responses). */
async function getPurchaseOrderActivity(req, res) {
  try {
    const actor = internalActor(req);
    const po = await loadAccessiblePo(actor, parseId(req.params.poId));
    const [deliveries, receipts, reports, documents, responses] = await Promise.all([
      prisma.supplier_delivery_invoices.findMany({ where: { purchase_order_id: po.id }, select: { id: true } }),
      prisma.goods_receipts.findMany({ where: { purchase_order_id: po.id }, select: { id: true } }),
      prisma.supplier_shortage_reports.findMany({ where: { purchase_order_id: po.id }, select: { id: true } }),
      prisma.procurement_documents.findMany({ where: { purchase_order_id: po.id }, select: { id: true, document_number: true, issuer_party: true, status: true } }),
      prisma.purchase_order_supplier_responses.findMany({ where: { purchase_order_id: po.id }, select: { id: true } }),
    ]);
    // A supplier draft is private to the supplier until issued.
    const hiddenDocIds = new Set(documents.filter((doc) => doc.issuer_party === "SUPPLIER" && doc.status === "DRAFT").map((doc) => doc.id));
    const docNumbers = new Map(documents.map((doc) => [doc.id, doc.document_number]));
    const ids = [po.id, ...deliveries, ...receipts, ...reports, ...responses].map((row) => (typeof row === "string" ? row : row.id))
      .concat(documents.filter((doc) => !hiddenDocIds.has(doc.id)).map((doc) => doc.id));
    const logs = await prisma.inventory_audit_logs.findMany({
      where: { entity_id: { in: ids } },
      orderBy: { created_at: "desc" },
      take: 300,
    });
    return res.json({
      data: logs.map((log) => ({
        id: log.id,
        action_name: log.action_name,
        entity_type: log.entity_type,
        entity_id: log.entity_id,
        entity_label: docNumbers.get(log.entity_id) || null,
        actor_user_id: log.actor_user_id,
        actor_party: log.after_data?.actor_party || null,
        created_at: log.created_at,
        details: log.after_data || null,
      })),
    });
  } catch (error) {
    return sendError(res, error, "Error while loading purchase order activity:");
  }
}

module.exports = {
  internal,
  supplier,
  shareInternalDocument,
  issueGoodsReceiptConfirmation,
  getGoodsReceiptDocuments,
  getPurchaseOrderActivity,
  // exported for tests / other controllers
  internalActor,
  loadAccessiblePo,
};
