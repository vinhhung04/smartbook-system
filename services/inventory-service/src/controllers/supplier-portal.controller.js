
const { prisma } = require("../lib/prisma");

const { parseId, toInt, normalizeText } = require("../utils/validation");
const { registerDeliveryNote } = require("../services/procurement-document.service");
const { assertInvoiceQtyWithinRemaining } = require("../services/procurement-receipt.service");
const {
  buildSupplierResponse,
  recordFullAcceptance,
  assertSupplierMayDeliver,
  SHORTAGE_PROPOSAL_ACTIONS,
} = require("../services/purchase-order-response.service");

// Centralizing token lookup here means every portal endpoint (read + all writes) picks up
// the expiry check below for free. A leaked/forwarded portal link stops working once
// expires_at (set in purchase-order.controller.js sendToSupplier) has passed.
function getPortalTokenWhere(token) {
  return {
    AND: [
      { payload: { path: ["portal_token"], equals: token } },
      { OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] },
    ],
  };
}

function mapPortalOrder(dispatch) {
  const po = dispatch.purchase_orders;
  const poItemsById = new Map((po.purchase_order_items || []).map((item) => [String(item.id), item]));
  return {
    dispatch: {
      id: dispatch.id,
      dispatch_number: dispatch.dispatch_number,
      status: dispatch.status,
      sent_at: dispatch.sent_at,
      acknowledged_at: dispatch.acknowledged_at,
    },
    purchase_order: {
      id: po.id,
      po_number: po.po_number,
      status: po.status,
      supplier_response_status: po.supplier_response_status || null,
      expected_date: po.expected_date,
      warehouse: po.warehouses,
      supplier: po.suppliers,
      items: po.purchase_order_items.map((item) => ({
        id: item.id,
        variant_id: item.variant_id,
        title: item.book_variants?.books?.title || null,
        sku: item.book_variants?.sku || null,
        isbn13: item.book_variants?.isbn13 || null,
        ordered_qty: Number(item.ordered_qty || 0),
        received_qty: Number(item.received_qty || 0),
        remaining_qty: Math.max(0, Number(item.ordered_qty || 0) - Number(item.received_qty || 0)),
        unit_cost: Number(item.unit_cost || 0),
      })),
    },
    invoices: (po.supplier_delivery_invoices || []).map((invoice) => ({
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      delivery_number: invoice.delivery_number,
      status: invoice.status,
      invoice_date: invoice.invoice_date,
      expected_delivery_date: invoice.expected_delivery_date,
      carrier_name: invoice.carrier_name || null,
      deliverer_name: invoice.deliverer_name || null,
      supplier_note: invoice.supplier_note,
      raw_payload: invoice.raw_payload || {},
      goods_receipts: (invoice.goods_receipts || []).map((receipt) => ({
        id: receipt.id,
        receipt_number: receipt.receipt_number,
        status: receipt.status,
      })),
      items: invoice.supplier_delivery_invoice_items.map((item) => ({
        id: item.id,
        purchase_order_item_id: item.purchase_order_item_id,
        variant_id: item.variant_id,
        title: item.book_variants?.books?.title || null,
        sku: item.book_variants?.sku || null,
        isbn13: item.book_variants?.isbn13 || null,
        ordered_qty: Number(poItemsById.get(String(item.purchase_order_item_id))?.ordered_qty || 0),
        received_qty: Number(poItemsById.get(String(item.purchase_order_item_id))?.received_qty || 0),
        invoiced_qty: Number(item.invoiced_qty || 0),
        delivered_qty: item.delivered_qty == null ? null : Number(item.delivered_qty),
        accepted_qty: Number(item.accepted_qty || 0),
        unit_cost: Number(item.unit_cost || 0),
        note: item.note,
      })),
    })),
    shortage_reports: (po.supplier_shortage_reports || []).map((report) => ({
      id: report.id,
      purchase_order_id: report.purchase_order_id,
      supplier_id: report.supplier_id,
      goods_receipt_id: report.goods_receipt_id,
      invoice_id: report.invoice_id,
      status: report.status,
      reason: report.reason,
      discrepancy_type: report.discrepancy_type || "SHORTAGE",
      supplier_proposed_action: report.supplier_proposed_action || null,
      supplier_response_note: report.supplier_response_note || null,
      resolution_action: report.resolution_action || null,
      resolution_note: report.resolution_note || null,
      sent_at: report.sent_at,
      resolved_at: report.resolved_at,
      created_at: report.created_at,
      updated_at: report.updated_at,
      items: report.supplier_shortage_report_items.map((item) => ({
        id: item.id,
        purchase_order_item_id: item.purchase_order_item_id,
        variant_id: item.variant_id,
        title: item.book_variants?.books?.title || null,
        sku: item.book_variants?.sku || null,
        isbn13: item.book_variants?.isbn13 || null,
        ordered_qty: Number(item.ordered_qty || 0),
        received_qty: Number(item.received_qty || 0),
        shortage_qty: Number(item.shortage_qty || 0),
        discrepancy_type: item.discrepancy_type || "SHORTAGE",
        note: item.note,
      })),
    })),
    supplier_responses: (po.purchase_order_supplier_responses || []).map((response) => ({
      id: response.id,
      decision: response.decision,
      reason: response.reason,
      proposed_delivery_date: response.proposed_delivery_date,
      lines: response.lines,
      has_variance: response.has_variance,
      review_status: response.review_status,
      review_note: response.review_note,
      reviewed_at: response.reviewed_at,
      created_at: response.created_at,
    })),
  };
}

async function findDispatchByToken(token) {
  return prisma.supplier_order_dispatches.findFirst({
    where: getPortalTokenWhere(token),
    include: {
      purchase_orders: {
        include: {
          suppliers: { select: { id: true, code: true, name: true } },
          warehouses: { select: { id: true, code: true, name: true } },
          purchase_order_items: {
            include: {
              book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
            },
            orderBy: { id: "asc" },
          },
          supplier_delivery_invoices: {
            include: {
              goods_receipts: { select: { id: true, receipt_number: true, status: true } },
              supplier_delivery_invoice_items: {
                include: {
                  book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
                },
                orderBy: { id: "asc" },
              },
            },
            orderBy: { created_at: "desc" },
          },
          supplier_shortage_reports: {
            include: {
              supplier_shortage_report_items: {
                include: {
                  book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
                },
                orderBy: { id: "asc" },
              },
            },
            orderBy: { created_at: "desc" },
          },
          purchase_order_supplier_responses: { orderBy: { created_at: "desc" } },
        },
      },
    },
  });
}

function canUseSupplierAccount(user) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
  return roles.includes("SUPPLIER") || permissions.includes("supplier.portal.read") || permissions.includes("supplier.portal.write");
}

async function findAuthenticatedSupplier(req) {
  if (!canUseSupplierAccount(req.user)) {
    const error = new Error("Cần vai trò tài khoản nhà cung cấp");
    error.statusCode = 403;
    throw error;
  }

  const email = (normalizeText(req.user?.email) || "").toLowerCase();
  if (!email) {
    const error = new Error("Tài khoản nhà cung cấp chưa có email");
    error.statusCode = 403;
    throw error;
  }

  const supplier = await prisma.suppliers.findFirst({
    where: {
      status: "ACTIVE",
      email: { equals: email, mode: "insensitive" },
    },
  });

  if (!supplier) {
    const error = new Error("Không có nhà cung cấp đang hoạt động nào gắn với email tài khoản này");
    error.statusCode = 403;
    throw error;
  }

  return supplier;
}

async function findAuthenticatedDispatch(req, poId) {
  if (!poId) {
    const error = new Error("Mã đơn đặt hàng không hợp lệ");
    error.statusCode = 400;
    throw error;
  }

  const supplier = await findAuthenticatedSupplier(req);
  const dispatch = await prisma.supplier_order_dispatches.findFirst({
    where: {
      purchase_order_id: poId,
      supplier_id: supplier.id,
    },
    orderBy: { created_at: "desc" },
  });

  if (!dispatch) {
    const error = new Error("Không tìm thấy đơn của nhà cung cấp cho tài khoản này");
    error.statusCode = 404;
    throw error;
  }

  const token = dispatch.payload?.portal_token;
  if (!token) {
    const error = new Error("Đơn của nhà cung cấp thiếu thông tin mã truy cập cổng");
    error.statusCode = 409;
    throw error;
  }

  return { supplier, dispatch, token };
}

function handleSupplierAccountError(res, error, label) {
  if (error?.statusCode) {
    return res.status(error.statusCode).json({ message: error.message });
  }
  console.error(label, error);
  return res.status(500).json({ message: "Internal server error" });
}

async function getPortalOrder(req, res) {
  const token = normalizeText(req.params.token);
  if (!token) return res.status(400).json({ message: "Thiếu mã truy cập cổng nhà cung cấp" });

  try {
    const dispatch = await findDispatchByToken(token);
    if (!dispatch) return res.status(404).json({ message: "Không tìm thấy đơn trên cổng nhà cung cấp" });
    return res.json({ data: mapPortalOrder(dispatch) });
  } catch (error) {
    console.error("Error while loading supplier portal order:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function confirmPortalOrder(req, res) {
  const token = normalizeText(req.params.token);
  if (!token) return res.status(400).json({ message: "Thiếu mã truy cập cổng nhà cung cấp" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dispatch = await tx.supplier_order_dispatches.findFirst({
        where: getPortalTokenWhere(token),
        include: { purchase_orders: { include: { purchase_order_items: true } } },
      });
      if (!dispatch) return { invalid: true, statusCode: 404, message: "Không tìm thấy đơn trên cổng nhà cung cấp" };
      const po = dispatch.purchase_orders;
      if (po.status !== "SENT_TO_SUPPLIER") {
        return { invalid: true, message: "Nhà cung cấp chỉ xác nhận được đơn đặt hàng đã gửi" };
      }

      await tx.supplier_order_dispatches.update({
        where: { id: dispatch.id },
        data: { status: "ACKNOWLEDGED", acknowledged_at: new Date(), updated_at: new Date() },
      });
      await recordFullAcceptance(tx, po, parseId(req.user?.id) || null);
      const updatedPo = await tx.purchase_orders.update({
        where: { id: po.id },
        data: { status: "SUPPLIER_CONFIRMED", supplier_response_status: "ACCEPTED", updated_at: new Date() },
      });
      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: parseId(req.user?.id) || null,
          action_name: "SUPPLIER_ORDER_ACKNOWLEDGED",
          entity_type: "PURCHASE_ORDER",
          entity_id: po.id,
          after_data: { dispatch_id: dispatch.id, po_number: po.po_number, status: updatedPo.status },
        },
      });
      return { data: updatedPo };
    });

    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.json({ message: "Supplier order confirmed", data: result.data });
  } catch (error) {
    console.error("Error while confirming supplier portal order:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function createPortalInvoice(req, res) {
  const token = normalizeText(req.params.token);
  // A delivery note may carry no invoice number (the formal invoice can be issued later as its
  // own document); the delivery-note number then identifies the batch.
  const invoiceNumber = normalizeText(req.body?.invoice_number) || normalizeText(req.body?.delivery_number);
  const sourceShortageReportId = parseId(req.body?.source_shortage_report_id || req.body?.shortage_report_id);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!token) return res.status(400).json({ message: "Thiếu mã truy cập cổng nhà cung cấp" });
  if (!invoiceNumber) return res.status(400).json({ message: "Thiếu số phiếu giao hàng (delivery_number) hoặc invoice_number" });
  if (items.length === 0) return res.status(400).json({ message: "Thiếu items" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dispatch = await tx.supplier_order_dispatches.findFirst({
        where: getPortalTokenWhere(token),
        include: { purchase_orders: { include: { purchase_order_items: true } } },
      });
      if (!dispatch) return { invalid: true, statusCode: 404, message: "Không tìm thấy đơn trên cổng nhà cung cấp" };
      const po = dispatch.purchase_orders;
      if (!["SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(po.status)) {
        return { invalid: true, message: "Đơn đặt hàng chưa sẵn sàng để lập hóa đơn nhà cung cấp" };
      }
      const blocked = await assertSupplierMayDeliver(tx, po);
      if (blocked) return blocked;

      if (po.status === "SENT_TO_SUPPLIER") {
        // Shipping against a sent PO is an implicit acceptance of it as ordered.
        await recordFullAcceptance(tx, po, parseId(req.user?.id) || null);
        await tx.purchase_orders.update({
          where: { id: po.id },
          data: { status: "SUPPLIER_CONFIRMED", supplier_response_status: "ACCEPTED", updated_at: new Date() },
        });
        await tx.supplier_order_dispatches.update({
          where: { id: dispatch.id },
          data: { status: "ACKNOWLEDGED", acknowledged_at: new Date(), updated_at: new Date() },
        });
      }

      let shortageReport = null;
      let shortageItemsByPoItemId = new Map();
      if (sourceShortageReportId) {
        shortageReport = await tx.supplier_shortage_reports.findFirst({
          where: {
            id: sourceShortageReportId,
            purchase_order_id: po.id,
            supplier_id: po.supplier_id,
            status: { in: ["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"] },
          },
          include: { supplier_shortage_report_items: true },
        });
        if (!shortageReport) {
          return { invalid: true, statusCode: 404, message: "Không tìm thấy báo cáo thiếu hàng cho đơn này của nhà cung cấp" };
        }
        // Lock the shortage report before reading what's already been redelivered against it:
        // two redelivery notes submitted for the same report at the same instant must not both
        // read "nothing redelivered yet" and each claim the full shortage_qty.
        await tx.$queryRawUnsafe("SELECT id FROM supplier_shortage_reports WHERE id = $1::uuid FOR UPDATE", shortageReport.id);
        // One PO line can carry several discrepancy rows (e.g. 2 missing + 3 damaged): the
        // redelivery limit is their sum. Overage rows are excess goods, never "to redeliver".
        shortageItemsByPoItemId = new Map();
        for (const item of shortageReport.supplier_shortage_report_items) {
          if ((item.discrepancy_type || "SHORTAGE") === "OVERAGE") continue;
          const key = String(item.purchase_order_item_id);
          const previous = shortageItemsByPoItemId.get(key);
          shortageItemsByPoItemId.set(key, { ...item, shortage_qty: Number(previous?.shortage_qty || 0) + Number(item.shortage_qty || 0) });
        }
        // Subtract redelivery notes already submitted against this same report so the limit
        // below is "what's still owed", not "what was ever owed".
        const priorRedeliveryRows = await tx.supplier_delivery_invoice_items.findMany({
          where: { purchase_order_item_id: { in: Array.from(shortageItemsByPoItemId.keys()) } },
          select: { purchase_order_item_id: true, invoiced_qty: true, supplier_delivery_invoices: { select: { raw_payload: true } } },
        });
        const alreadyRedeliveredByPoItemId = new Map();
        for (const row of priorRedeliveryRows) {
          const payload = row.supplier_delivery_invoices?.raw_payload;
          if (payload?.redelivery !== true || String(payload?.source_shortage_report_id) !== String(shortageReport.id)) continue;
          const key = String(row.purchase_order_item_id);
          alreadyRedeliveredByPoItemId.set(key, Number(alreadyRedeliveredByPoItemId.get(key) || 0) + Number(row.invoiced_qty || 0));
        }
        for (const [key, item] of shortageItemsByPoItemId) {
          const already = Number(alreadyRedeliveredByPoItemId.get(key) || 0);
          shortageItemsByPoItemId.set(key, { ...item, shortage_qty: Math.max(0, Number(item.shortage_qty || 0) - already) });
        }
      }

      const poItemsById = new Map(po.purchase_order_items.map((item) => [String(item.id), item]));
      const invoiceItems = [];
      const seen = new Set();
      for (const rawLine of items) {
        const poItemId = parseId(rawLine?.purchase_order_item_id);
        const poItem = poItemsById.get(String(poItemId));
        const invoicedQty = toInt(rawLine?.invoiced_qty);
        const unitCost = Number(rawLine?.unit_cost);
        if (!poItem) return { invalid: true, message: "Dòng hóa đơn phải thuộc đơn đặt hàng này" };
        if (!invoicedQty || invoicedQty <= 0) return { invalid: true, message: "Mỗi dòng hóa đơn phải có invoiced_qty > 0" };
        if (!Number.isFinite(unitCost) || unitCost < 0) return { invalid: true, message: "Mỗi dòng hóa đơn phải có unit_cost >= 0" };
        if (seen.has(poItem.variant_id)) return { invalid: true, message: "Hóa đơn có ấn bản bị lặp" };
        seen.add(poItem.variant_id);
        if (poItem.closure_status === "CLOSED_WITH_REMAINING") {
          return { invalid: true, message: "Dòng đơn đặt hàng đã được đóng phần còn lại, không thể lập hóa đơn thêm" };
        }
        if (!sourceShortageReportId) {
          // A redelivery note is bounded by its shortage report's shortage_qty below instead:
          // it re-declares quantity an earlier note already claimed but that was never accepted.
          const overBy = await assertInvoiceQtyWithinRemaining(tx, poItem, invoicedQty);
          if (overBy !== null) {
            return {
              invalid: true,
              message: `Số lượng hóa đơn không được vượt số lượng còn lại chưa lập hóa đơn của đơn đặt hàng (còn ${overBy})`,
            };
          }
        }
        if (sourceShortageReportId) {
          const shortageItem = shortageItemsByPoItemId.get(String(poItem.id));
          if (!shortageItem) {
            return { invalid: true, message: "Hóa đơn giao bù chỉ được gồm các dòng trong báo cáo thiếu hàng" };
          }
          if (invoicedQty > Number(shortageItem.shortage_qty || 0)) {
            return { invalid: true, message: "Số lượng giao bù không được vượt số lượng thiếu" };
          }
        }
        invoiceItems.push({
          purchase_order_item_id: poItem.id,
          variant_id: poItem.variant_id,
          invoiced_qty: invoicedQty,
          unit_cost: unitCost,
          note: normalizeText(rawLine?.note),
        });
      }

      const invoice = await tx.supplier_delivery_invoices.create({
        data: {
          purchase_order_id: po.id,
          supplier_id: po.supplier_id,
          invoice_number: invoiceNumber,
          delivery_number: normalizeText(req.body?.delivery_number),
          invoice_date: req.body?.invoice_date ? new Date(req.body.invoice_date) : null,
          expected_delivery_date: req.body?.expected_delivery_date ? new Date(req.body.expected_delivery_date) : null,
          carrier_name: normalizeText(req.body?.carrier_name),
          deliverer_name: normalizeText(req.body?.deliverer_name),
          status: "SUBMITTED",
          supplier_note: normalizeText(req.body?.supplier_note),
          raw_payload: {
            ...(req.body || {}),
            ...(sourceShortageReportId ? { source_shortage_report_id: sourceShortageReportId, redelivery: true } : {}),
          },
          created_by_user_id: parseId(req.user?.id) || null,
        },
      });

      await tx.supplier_delivery_invoice_items.createMany({
        data: invoiceItems.map((item) => ({ ...item, invoice_id: invoice.id })),
      });
      await registerDeliveryNote(tx, { delivery: invoice, items: invoiceItems, actorUserId: parseId(req.user?.id) || null });
      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: parseId(req.user?.id) || null,
          action_name: sourceShortageReportId ? "SUPPLIER_REDELIVERY_INVOICE_CREATED" : "SUPPLIER_INVOICE_CREATED",
          entity_type: "SUPPLIER_DELIVERY_INVOICE",
          entity_id: invoice.id,
          after_data: {
            purchase_order_id: po.id,
            invoice_number: invoice.invoice_number,
            source: "SUPPLIER_PORTAL",
            source_shortage_report_id: sourceShortageReportId || null,
          },
        },
      });
      if (sourceShortageReportId && ["OPEN", "SENT_TO_SUPPLIER"].includes(shortageReport.status)) {
        await tx.supplier_shortage_reports.update({
          where: { id: sourceShortageReportId },
          data: { status: "ACKNOWLEDGED", updated_at: new Date() },
        });
      }
      return { data: invoice };
    });

    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.status(201).json({ message: "Supplier invoice created", data: result.data });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "Số hóa đơn này đã tồn tại với nhà cung cấp" });
    console.error("Error while creating supplier portal invoice:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function acknowledgeShortageReport(req, res) {
  const token = normalizeText(req.params.token);
  const reportId = parseId(req.params.reportId);
  if (!token) return res.status(400).json({ message: "Thiếu mã truy cập cổng nhà cung cấp" });
  if (!reportId) return res.status(400).json({ message: "Mã báo cáo thiếu hàng không hợp lệ" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dispatch = await tx.supplier_order_dispatches.findFirst({
        where: getPortalTokenWhere(token),
        include: { purchase_orders: true },
      });
      if (!dispatch) return { invalid: true, statusCode: 404, message: "Không tìm thấy đơn trên cổng nhà cung cấp" };
      const po = dispatch.purchase_orders;
      const report = await tx.supplier_shortage_reports.findFirst({
        where: { id: reportId, purchase_order_id: po.id, supplier_id: po.supplier_id },
      });
      if (!report) return { invalid: true, statusCode: 404, message: "Không tìm thấy báo cáo thiếu hàng" };
      if (!["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status)) {
        return { invalid: true, message: "Không thể xác nhận báo cáo thiếu hàng ở trạng thái hiện tại" };
      }

      const updated = await tx.supplier_shortage_reports.update({
        where: { id: report.id },
        data: { status: "ACKNOWLEDGED", updated_at: new Date() },
      });
      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: parseId(req.user?.id) || null,
          action_name: "SUPPLIER_SHORTAGE_ACKNOWLEDGED",
          entity_type: "SUPPLIER_SHORTAGE_REPORT",
          entity_id: report.id,
          before_data: { status: report.status },
          after_data: { status: updated.status, purchase_order_id: po.id },
        },
      });
      return { data: updated };
    });

    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.json({ message: "Shortage report acknowledged", data: result.data });
  } catch (error) {
    console.error("Error while acknowledging supplier shortage report:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function cannotFulfillShortageReport(req, res) {
  const token = normalizeText(req.params.token);
  const reportId = parseId(req.params.reportId);
  const reason = normalizeText(req.body?.reason) || "Supplier cannot fulfill remaining shortage";
  if (!token) return res.status(400).json({ message: "Thiếu mã truy cập cổng nhà cung cấp" });
  if (!reportId) return res.status(400).json({ message: "Mã báo cáo thiếu hàng không hợp lệ" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dispatch = await tx.supplier_order_dispatches.findFirst({
        where: getPortalTokenWhere(token),
        include: { purchase_orders: true },
      });
      if (!dispatch) return { invalid: true, statusCode: 404, message: "Không tìm thấy đơn trên cổng nhà cung cấp" };
      const po = dispatch.purchase_orders;
      const report = await tx.supplier_shortage_reports.findFirst({
        where: { id: reportId, purchase_order_id: po.id, supplier_id: po.supplier_id },
      });
      if (!report) return { invalid: true, statusCode: 404, message: "Không tìm thấy báo cáo thiếu hàng" };
      if (!["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status)) {
        return { invalid: true, message: "Không thể cập nhật báo cáo thiếu hàng ở trạng thái hiện tại" };
      }

      const nextReason = [report.reason, `[SUPPLIER_CANNOT_FULFILL] ${reason}`].filter(Boolean).join("\n");
      const updated = await tx.supplier_shortage_reports.update({
        where: { id: report.id },
        data: { status: "ACKNOWLEDGED", reason: nextReason, updated_at: new Date() },
      });
      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: parseId(req.user?.id) || null,
          action_name: "SUPPLIER_SHORTAGE_CANNOT_FULFILL",
          entity_type: "SUPPLIER_SHORTAGE_REPORT",
          entity_id: report.id,
          before_data: { status: report.status, reason: report.reason },
          after_data: { status: updated.status, reason, purchase_order_id: po.id },
        },
      });
      return { data: updated };
    });

    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.json({ message: "Shortage report updated", data: result.data });
  } catch (error) {
    console.error("Error while marking supplier shortage cannot fulfill:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

function createRedeliveryInvoice(req, res) {
  const reportId = parseId(req.params.reportId);
  if (!reportId) return res.status(400).json({ message: "Mã báo cáo thiếu hàng không hợp lệ" });
  req.body = {
    ...(req.body || {}),
    source_shortage_report_id: reportId,
    redelivery: true,
  };
  return createPortalInvoice(req, res);
}

async function getSupplierAccountOrders(req, res) {
  try {
    const supplier = await findAuthenticatedSupplier(req);
    const dispatches = await prisma.supplier_order_dispatches.findMany({
      where: { supplier_id: supplier.id },
      include: {
        purchase_orders: {
          include: {
            suppliers: { select: { id: true, code: true, name: true } },
            warehouses: { select: { id: true, code: true, name: true } },
            purchase_order_items: {
              include: {
                book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
              },
              orderBy: { id: "asc" },
            },
            supplier_delivery_invoices: {
              include: {
                goods_receipts: { select: { id: true, receipt_number: true, status: true } },
                supplier_delivery_invoice_items: {
                  include: {
                    book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
                  },
                  orderBy: { id: "asc" },
                },
              },
              orderBy: { created_at: "desc" },
            },
            supplier_shortage_reports: {
              include: {
                supplier_shortage_report_items: {
                  include: {
                    book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
                  },
                  orderBy: { id: "asc" },
                },
              },
              orderBy: { created_at: "desc" },
            },
            purchase_order_supplier_responses: { orderBy: { created_at: "desc" } },
          },
        },
      },
      orderBy: { created_at: "desc" },
    });

    return res.json({
      data: {
        supplier: { id: supplier.id, code: supplier.code, name: supplier.name, email: supplier.email },
        orders: dispatches.map(mapPortalOrder),
      },
    });
  } catch (error) {
    return handleSupplierAccountError(res, error, "Error while loading supplier account orders:");
  }
}

async function confirmSupplierAccountOrder(req, res) {
  try {
    const { token } = await findAuthenticatedDispatch(req, parseId(req.params.poId));
    req.params.token = token;
    return confirmPortalOrder(req, res);
  } catch (error) {
    return handleSupplierAccountError(res, error, "Error while confirming supplier account order:");
  }
}

async function createSupplierAccountInvoice(req, res) {
  try {
    const { token } = await findAuthenticatedDispatch(req, parseId(req.params.poId));
    req.params.token = token;
    return createPortalInvoice(req, res);
  } catch (error) {
    return handleSupplierAccountError(res, error, "Error while creating supplier account invoice:");
  }
}

async function acknowledgeSupplierAccountShortage(req, res) {
  try {
    const { token } = await findAuthenticatedDispatch(req, parseId(req.params.poId));
    req.params.token = token;
    return acknowledgeShortageReport(req, res);
  } catch (error) {
    return handleSupplierAccountError(res, error, "Error while acknowledging supplier account shortage:");
  }
}

async function cannotFulfillSupplierAccountShortage(req, res) {
  try {
    const { token } = await findAuthenticatedDispatch(req, parseId(req.params.poId));
    req.params.token = token;
    return cannotFulfillShortageReport(req, res);
  } catch (error) {
    return handleSupplierAccountError(res, error, "Error while marking supplier account shortage cannot fulfill:");
  }
}

async function createSupplierAccountRedeliveryInvoice(req, res) {
  try {
    const { token } = await findAuthenticatedDispatch(req, parseId(req.params.poId));
    req.params.token = token;
    return createRedeliveryInvoice(req, res);
  } catch (error) {
    return handleSupplierAccountError(res, error, "Error while creating supplier account redelivery:");
  }
}

/** Supplier answers a sent PO: accept all, accept part (qty/price changes need SmartBook review) or reject. */
async function respondSupplierAccountOrder(req, res) {
  try {
    const { dispatch } = await findAuthenticatedDispatch(req, parseId(req.params.poId));
    const userId = parseId(req.user?.id) || null;
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.findUnique({
        where: { id: dispatch.purchase_order_id },
        include: { purchase_order_items: { orderBy: { id: "asc" } } },
      });
      if (!po || po.status !== "SENT_TO_SUPPLIER") {
        return { invalid: true, statusCode: 409, message: "Chỉ phản hồi được đơn đang chờ nhà cung cấp xác nhận" };
      }
      let response;
      try {
        response = buildSupplierResponse(po, req.body || {});
      } catch (error) {
        return { invalid: true, statusCode: error.statusCode || 400, message: error.message };
      }
      await tx.purchase_order_supplier_responses.updateMany({
        where: { purchase_order_id: po.id, review_status: "PENDING_REVIEW" },
        data: { review_status: "WITHDRAWN" },
      });
      const row = await tx.purchase_order_supplier_responses.create({
        data: {
          purchase_order_id: po.id,
          supplier_id: po.supplier_id,
          decision: response.decision,
          reason: response.reason,
          proposed_delivery_date: response.proposed_delivery_date,
          lines: response.lines,
          has_variance: response.has_variance,
          review_status: response.review_status,
          responded_by_user_id: userId,
        },
      });
      const confirmsNow = response.decision !== "REJECTED" && !response.has_variance;
      await tx.purchase_orders.update({
        where: { id: po.id },
        data: {
          supplier_response_status: response.decision,
          ...(confirmsNow ? { status: "SUPPLIER_CONFIRMED" } : {}),
          updated_at: new Date(),
        },
      });
      await tx.supplier_order_dispatches.update({
        where: { id: dispatch.id },
        data: { status: "ACKNOWLEDGED", acknowledged_at: dispatch.acknowledged_at || new Date(), updated_at: new Date() },
      });
      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: userId,
          action_name: "SUPPLIER_ORDER_RESPONDED",
          entity_type: "PURCHASE_ORDER",
          entity_id: po.id,
          before_data: { status: po.status, supplier_response_status: po.supplier_response_status },
          after_data: {
            response_id: row.id,
            decision: response.decision,
            has_variance: response.has_variance,
            review_status: response.review_status,
            reason: response.reason,
            lines: response.lines,
            actor_party: "SUPPLIER",
          },
        },
      });
      return { data: row };
    });
    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.status(201).json({ message: "Đã gửi phản hồi đơn hàng", data: result.data });
  } catch (error) {
    return handleSupplierAccountError(res, error, "Error while recording supplier order response:");
  }
}

/** Supplier answers a discrepancy report with a proposal (redeliver, exchange, return, adjust documents...). */
async function proposeSupplierAccountShortageAction(req, res) {
  try {
    const { supplier, dispatch } = await findAuthenticatedDispatch(req, parseId(req.params.poId));
    const reportId = parseId(req.params.reportId);
    const action = String(req.body?.action || "").trim().toUpperCase();
    const note = normalizeText(req.body?.note);
    if (!SHORTAGE_PROPOSAL_ACTIONS.has(action)) {
      return res.status(400).json({ message: "Đề xuất phải là REDELIVER, EXCHANGE, RETURN, DOCUMENT_ADJUSTMENT hoặc CANNOT_FULFILL" });
    }
    const report = await prisma.supplier_shortage_reports.findFirst({
      where: { id: reportId || "", purchase_order_id: dispatch.purchase_order_id, supplier_id: supplier.id },
    });
    if (!report) return res.status(404).json({ message: "Không tìm thấy biên bản chênh lệch" });
    if (!["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status)) {
      return res.status(409).json({ message: "Biên bản chênh lệch đã được xử lý" });
    }
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.supplier_shortage_reports.update({
        where: { id: report.id },
        data: { status: "ACKNOWLEDGED", supplier_proposed_action: action, supplier_response_note: note, updated_at: new Date() },
      });
      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: parseId(req.user?.id) || null,
          action_name: "SUPPLIER_DISCREPANCY_PROPOSAL",
          entity_type: "SUPPLIER_SHORTAGE_REPORT",
          entity_id: report.id,
          before_data: { status: report.status, supplier_proposed_action: report.supplier_proposed_action },
          after_data: { status: row.status, supplier_proposed_action: action, note, purchase_order_id: report.purchase_order_id, actor_party: "SUPPLIER" },
        },
      });
      return row;
    });
    return res.json({ message: "Đã gửi đề xuất xử lý chênh lệch", data: updated });
  } catch (error) {
    return handleSupplierAccountError(res, error, "Error while recording supplier discrepancy proposal:");
  }
}

function supplierCannotPostStock(_req, res) {
  return res.status(403).json({ message: "Cổng nhà cung cấp không được tạo hoặc ghi sổ phiếu nhập kho" });
}

module.exports = {
  getPortalOrder,
  confirmPortalOrder,
  createPortalInvoice,
  acknowledgeShortageReport,
  cannotFulfillShortageReport,
  createRedeliveryInvoice,
  getSupplierAccountOrders,
  confirmSupplierAccountOrder,
  createSupplierAccountInvoice,
  acknowledgeSupplierAccountShortage,
  cannotFulfillSupplierAccountShortage,
  createSupplierAccountRedeliveryInvoice,
  supplierCannotPostStock,
  respondSupplierAccountOrder,
  proposeSupplierAccountShortageAction,
  findAuthenticatedSupplier,
};
