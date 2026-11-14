const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, normalizeText } = require("../utils/validation");
const { canReadWarehouse, canWriteWarehouse } = require("../utils/warehouse-scope.utils");
const { buildDocumentReconciliation } = require("../services/procurement-reconciliation.service");

function fail(res, statusCode, message) {
  return res.status(statusCode).json({ message });
}

function hasPermission(user, permission) {
  return Boolean(user?.is_superuser) || (Array.isArray(user?.permissions) && user.permissions.includes(permission));
}

/**
 * SmartBook decides on a supplier response that changed quantity or price.
 * APPROVE applies the confirmed quantities/prices to the PO lines (old values kept in the
 * response row and the audit log) and confirms the PO. REJECT keeps the PO lines untouched.
 */
async function reviewSupplierResponse(req, res) {
  const poId = parseId(req.params.id);
  const responseId = parseId(req.params.responseId);
  const userId = parseId(req.user?.id);
  const decision = String(req.body?.decision || "").trim().toUpperCase();
  const note = normalizeText(req.body?.note);
  if (!poId || !responseId) return fail(res, 400, "Mã đơn hoặc mã phản hồi không hợp lệ");
  if (!["APPROVE", "REJECT"].includes(decision)) return fail(res, 400, "decision phải là APPROVE hoặc REJECT");
  if (decision === "REJECT" && !note) return fail(res, 400, "Cần ghi lý do không chấp nhận thay đổi");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.findUnique({ where: { id: poId }, include: { purchase_order_items: true } });
      if (!po) return { statusCode: 404, message: "Không tìm thấy đơn đặt hàng" };
      if (!(await canWriteWarehouse(req.user, po.warehouse_id))) return { statusCode: 403, message: "Bạn không có quyền thao tác trên kho này" };
      const response = await tx.purchase_order_supplier_responses.findFirst({ where: { id: responseId, purchase_order_id: po.id } });
      if (!response) return { statusCode: 404, message: "Không tìm thấy phản hồi của nhà cung cấp" };
      if (response.review_status !== "PENDING_REVIEW") return { statusCode: 409, message: "Phản hồi này không còn chờ duyệt" };
      if (po.status !== "SENT_TO_SUPPLIER") return { statusCode: 409, message: "Đơn không còn ở trạng thái chờ nhà cung cấp" };
      const totalReceived = po.purchase_order_items.reduce((sum, item) => sum + Number(item.received_qty || 0), 0);
      if (totalReceived > 0) return { statusCode: 409, message: "Đơn đã bắt đầu nhận hàng" };

      const now = new Date();
      const claimed = await tx.purchase_order_supplier_responses.updateMany({
        where: { id: response.id, review_status: "PENDING_REVIEW" },
        data: { review_status: decision === "APPROVE" ? "APPROVED" : "REJECTED", review_note: note, reviewed_by_user_id: userId, reviewed_at: now },
      });
      if (claimed.count !== 1) return { statusCode: 409, message: "Phản hồi vừa được xử lý bởi người khác" };

      const before = po.purchase_order_items.map((item) => ({ id: item.id, ordered_qty: item.ordered_qty, unit_cost: Number(item.unit_cost) }));
      if (decision === "APPROVE") {
        const lines = Array.isArray(response.lines) ? response.lines : [];
        for (const line of lines) {
          const item = po.purchase_order_items.find((row) => String(row.id) === String(line.purchase_order_item_id));
          if (!item) continue;
          await tx.purchase_order_items.update({
            where: { id: item.id },
            data: { ordered_qty: Number(line.confirmed_qty), unit_cost: Number(line.confirmed_unit_cost) },
          });
        }
        await tx.purchase_orders.update({
          where: { id: po.id },
          data: {
            status: "SUPPLIER_CONFIRMED",
            ...(response.proposed_delivery_date ? { expected_date: response.proposed_delivery_date } : {}),
            updated_at: now,
          },
        });
      } else {
        await tx.purchase_orders.update({ where: { id: po.id }, data: { supplier_response_status: "CHANGES_REJECTED", updated_at: now } });
      }

      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: decision === "APPROVE" ? "SUPPLIER_RESPONSE_APPROVED" : "SUPPLIER_RESPONSE_REJECTED",
          entity_type: "PURCHASE_ORDER",
          entity_id: po.id,
          before_data: { status: po.status, items: before, expected_date: po.expected_date },
          after_data: { response_id: response.id, decision, note, lines: response.lines, actor_party: "SMARTBOOK" },
        },
      });
      return { ok: true };
    });
    if (!result.ok) return fail(res, result.statusCode, result.message);
    return res.json({ message: decision === "APPROVE" ? "Đã duyệt thay đổi của nhà cung cấp" : "Đã từ chối thay đổi của nhà cung cấp" });
  } catch (error) {
    console.error("Error while reviewing supplier response:", error);
    return fail(res, 500, "Internal server error");
  }
}

async function loadReconciliationInput(poId) {
  const po = await prisma.purchase_orders.findUnique({
    where: { id: poId },
    include: {
      purchase_order_items: {
        include: { book_variants: { select: { isbn13: true, books: { select: { title: true } } } } },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!po) return null;
  const [documents, deliveryNotes, receipts, reports, history] = await Promise.all([
    prisma.procurement_documents.findMany({ where: { purchase_order_id: po.id }, include: { procurement_document_lines: true } }),
    prisma.supplier_delivery_invoices.findMany({ where: { purchase_order_id: po.id }, include: { supplier_delivery_invoice_items: true }, orderBy: { created_at: "asc" } }),
    prisma.goods_receipts.findMany({ where: { purchase_order_id: po.id }, include: { goods_receipt_items: true }, orderBy: { created_at: "asc" } }),
    prisma.supplier_shortage_reports.findMany({ where: { purchase_order_id: po.id }, include: { supplier_shortage_report_items: true } }),
    prisma.procurement_reconciliations.findMany({ where: { purchase_order_id: po.id }, orderBy: { created_at: "desc" } }),
  ]);
  const result = buildDocumentReconciliation({
    poItems: po.purchase_order_items.map((item) => ({
      id: item.id,
      variant_id: item.variant_id,
      title: item.book_variants?.books?.title || null,
      isbn13: item.book_variants?.isbn13 || null,
      ordered_qty: item.ordered_qty,
      unit_cost: item.unit_cost,
    })),
    documents: documents.map((doc) => ({ ...doc, lines: doc.procurement_document_lines })),
    deliveryNotes: deliveryNotes.map((note) => ({ ...note, items: note.supplier_delivery_invoice_items })),
    receipts: receipts.map((receipt) => ({ ...receipt, items: receipt.goods_receipt_items })),
    discrepancyReports: reports.map((report) => ({ ...report, items: report.supplier_shortage_report_items })),
  });
  return { po, result, history };
}

async function getDocumentReconciliation(req, res) {
  const poId = parseId(req.params.id);
  if (!poId) return fail(res, 400, "Mã đơn đặt hàng không hợp lệ");
  try {
    const loaded = await loadReconciliationInput(poId);
    if (!loaded) return fail(res, 404, "Không tìm thấy đơn đặt hàng");
    if (!(await canReadWarehouse(req.user, loaded.po.warehouse_id))) return fail(res, 403, "Bạn không có quyền truy cập kho của đơn này");
    return res.json({
      data: {
        purchase_order_id: loaded.po.id,
        po_number: loaded.po.po_number,
        ...loaded.result,
        history: loaded.history.map((row) => ({
          id: row.id,
          result_status: row.result_status,
          exception_approved: row.exception_approved,
          note: row.note,
          completed_by_user_id: row.completed_by_user_id,
          created_at: row.created_at,
        })),
      },
    });
  } catch (error) {
    console.error("Error while building document reconciliation:", error);
    return fail(res, 500, "Internal server error");
  }
}

/**
 * Close the reconciliation of a PO. Allowed when everything MATCHED, or as an exception
 * approved by a user holding inventory.purchase.approve with a written reason.
 */
async function completeDocumentReconciliation(req, res) {
  const poId = parseId(req.params.id);
  const userId = parseId(req.user?.id);
  const exception = req.body?.exception_approved === true || String(req.body?.exception_approved) === "true";
  const note = normalizeText(req.body?.note);
  if (!poId) return fail(res, 400, "Mã đơn đặt hàng không hợp lệ");
  try {
    const loaded = await loadReconciliationInput(poId);
    if (!loaded) return fail(res, 404, "Không tìm thấy đơn đặt hàng");
    if (!(await canWriteWarehouse(req.user, loaded.po.warehouse_id))) return fail(res, 403, "Bạn không có quyền thao tác trên kho này");
    const { result } = loaded;
    if (!result.can_complete_without_exception) {
      if (!exception) {
        return fail(res, 409, `Chưa thể hoàn tất đối soát (trạng thái ${result.status}). Cần xử lý chênh lệch hoặc duyệt ngoại lệ.`);
      }
      if (!hasPermission(req.user, "inventory.purchase.approve")) return fail(res, 403, "Chỉ người có quyền duyệt mua hàng mới được duyệt ngoại lệ đối soát");
      if (!note) return fail(res, 400, "Cần ghi lý do duyệt ngoại lệ");
    }
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.procurement_reconciliations.create({
        data: {
          purchase_order_id: loaded.po.id,
          result_status: result.status,
          exception_approved: !result.can_complete_without_exception,
          note,
          snapshot: { totals: result.totals, lines: result.lines, invoices: result.invoices, deliveries: result.deliveries },
          completed_by_user_id: userId,
        },
      });
      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "PROCUREMENT_RECONCILIATION_COMPLETED",
          entity_type: "PURCHASE_ORDER",
          entity_id: loaded.po.id,
          after_data: { reconciliation_id: created.id, result_status: result.status, exception_approved: created.exception_approved, note, actor_party: "SMARTBOOK" },
        },
      });
      return created;
    });
    return res.status(201).json({ message: "Đã hoàn tất đối soát", data: row });
  } catch (error) {
    console.error("Error while completing document reconciliation:", error);
    return fail(res, 500, "Internal server error");
  }
}

module.exports = {
  reviewSupplierResponse,
  getDocumentReconciliation,
  completeDocumentReconciliation,
};
