const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, toInt, normalizeText } = require("../utils/validation");
const { computeLineOutcome } = require("../services/procurement-receipt.service");
const { registerDeliveryNote } = require("../services/procurement-document.service");
const {
  getReadableWarehouseIds,
  canWriteWarehouse,
  requireWarehouseReadAccess,
} = require("../utils/warehouse-scope.utils");

const RECEIVABLE_PO_STATUSES = [
  "SENT_TO_SUPPLIER",
  "SUPPLIER_CONFIRMED",
  "PARTIALLY_RECEIVED",
  "SHORTAGE_REPORTED",
];

function createReceiptNumber() {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GR-${Date.now()}-${suffix}`;
}

function mapInvoice(invoice) {
  return {
    id: invoice.id,
    purchase_order_id: invoice.purchase_order_id,
    supplier_id: invoice.supplier_id,
    supplier_name: invoice.suppliers?.name || null,
    po_number: invoice.purchase_orders?.po_number || null,
    warehouse_id: invoice.purchase_orders?.warehouse_id || null,
    warehouse_code: invoice.purchase_orders?.warehouses?.code || null,
    warehouse_name: invoice.purchase_orders?.warehouses?.name || null,
    invoice_number: invoice.invoice_number,
    delivery_number: invoice.delivery_number,
    invoice_date: invoice.invoice_date,
    expected_delivery_date: invoice.expected_delivery_date,
    carrier_name: invoice.carrier_name || null,
    deliverer_name: invoice.deliverer_name || null,
    status: invoice.status,
    supplier_note: invoice.supplier_note,
    goods_receipts: (invoice.goods_receipts || []).map((receipt) => ({ id: receipt.id, receipt_number: receipt.receipt_number, status: receipt.status })),
    created_at: invoice.created_at,
    updated_at: invoice.updated_at,
    items: (invoice.supplier_delivery_invoice_items || []).map((item) => {
      const orderedQty = Number(item.purchase_order_items?.ordered_qty || 0);
      const receivedQty = Number(item.purchase_order_items?.received_qty || 0);
      return {
        id: item.id,
        purchase_order_item_id: item.purchase_order_item_id,
        variant_id: item.variant_id,
        title: item.book_variants?.books?.title || null,
        sku: item.book_variants?.sku || null,
        isbn13: item.book_variants?.isbn13 || null,
        ordered_qty: orderedQty,
        previously_received_qty: receivedQty,
        remaining_qty: Math.max(0, orderedQty - receivedQty),
        invoiced_qty: Number(item.invoiced_qty || 0),
        delivered_qty: item.delivered_qty == null ? null : Number(item.delivered_qty),
        accepted_qty: Number(item.accepted_qty || 0),
        unit_cost: Number(item.unit_cost || 0),
        note: item.note,
      };
    }),
  };
}

function invoiceInclude() {
  return {
    suppliers: { select: { id: true, name: true } },
    goods_receipts: { select: { id: true, receipt_number: true, status: true }, orderBy: { created_at: "desc" } },
    purchase_orders: {
      select: {
        id: true,
        po_number: true,
        status: true,
        warehouse_id: true,
        warehouses: { select: { id: true, code: true, name: true } },
      },
    },
    supplier_delivery_invoice_items: {
      include: {
        purchase_order_items: { select: { id: true, ordered_qty: true, received_qty: true } },
        book_variants: { select: { sku: true, isbn13: true, books: { select: { title: true } } } },
      },
      orderBy: { id: "asc" },
    },
  };
}

async function audit(tx, actorUserId, actionName, entityType, entityId, afterData, beforeData = null) {
  await tx.inventory_audit_logs.create({
    data: {
      actor_user_id: actorUserId || null,
      action_name: actionName,
      entity_type: entityType,
      entity_id: entityId,
      before_data: beforeData,
      after_data: afterData,
    },
  });
}

async function getSupplierDeliveries(req, res) {
  try {
    const where = {};
    const status = normalizeText(req.query.status);
    const purchaseOrderId = parseId(req.query.purchase_order_id);
    if (status && status.toUpperCase() !== "ALL") where.status = status.toUpperCase();
    if (purchaseOrderId) where.purchase_order_id = purchaseOrderId;

    const readableWarehouseIds = await getReadableWarehouseIds(req.user || {});
    where.purchase_orders = { warehouse_id: { in: readableWarehouseIds } };

    const rows = await prisma.supplier_delivery_invoices.findMany({
      where,
      include: invoiceInclude(),
      orderBy: { created_at: "desc" },
    });

    return res.json({ data: rows.map(mapInvoice) });
  } catch (error) {
    console.error("Error while listing supplier deliveries:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getSupplierDeliveryById(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Mã lần giao hàng của nhà cung cấp không hợp lệ" });

  try {
    const invoice = await prisma.supplier_delivery_invoices.findUnique({
      where: { id },
      include: invoiceInclude(),
    });
    if (!invoice) return res.status(404).json({ message: "Không tìm thấy hóa đơn giao hàng của nhà cung cấp" });

    const canRead = await requireWarehouseReadAccess(req, res, invoice.purchase_orders?.warehouse_id);
    if (!canRead) return;

    return res.json({ data: mapInvoice(invoice) });
  } catch (error) {
    console.error("Error while fetching supplier delivery:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function createSupplierDelivery(req, res) {
  const userId = parseId(req.user?.id);
  const purchaseOrderId = parseId(req.body?.purchase_order_id);
  const invoiceNumber = normalizeText(req.body?.invoice_number);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!purchaseOrderId) return res.status(400).json({ message: "Thiếu purchase_order_id" });
  if (!invoiceNumber) return res.status(400).json({ message: "Thiếu invoice_number" });
  if (items.length === 0) return res.status(400).json({ message: "Thiếu items" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.findUnique({
        where: { id: purchaseOrderId },
        include: { purchase_order_items: true },
      });
      if (!po) return { invalid: true, statusCode: 404, message: "Không tìm thấy đơn đặt hàng" };

      if (!(await canWriteWarehouse(req.user, po.warehouse_id))) {
        return { invalid: true, statusCode: 403, message: "Bạn không có quyền thao tác trên kho này" };
      }

      if (!["SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(po.status)) {
        return { invalid: true, message: "Đơn đặt hàng phải được gửi cho nhà cung cấp trước khi tạo hóa đơn nhà cung cấp" };
      }

      const poItemsById = new Map(po.purchase_order_items.map((item) => [String(item.id), item]));
      const poItemsByVariant = new Map(po.purchase_order_items.map((item) => [String(item.variant_id), item]));
      const invoiceItems = [];
      const seen = new Set();

      for (const rawLine of items) {
        const poItemId = parseId(rawLine?.purchase_order_item_id);
        const variantId = parseId(rawLine?.variant_id);
        const poItem = poItemId ? poItemsById.get(poItemId) : poItemsByVariant.get(String(variantId));
        const invoicedQty = toInt(rawLine?.invoiced_qty);
        const unitCost = Number(rawLine?.unit_cost);
        if (!poItem) return { invalid: true, message: "Ấn bản trong hóa đơn không thuộc đơn đặt hàng" };
        if (variantId && variantId !== poItem.variant_id) return { invalid: true, message: "purchase_order_item_id và variant_id không khớp nhau" };
        if (!invoicedQty || invoicedQty <= 0) return { invalid: true, message: "Mỗi dòng hóa đơn phải có invoiced_qty > 0" };
        if (!Number.isFinite(unitCost) || unitCost < 0) return { invalid: true, message: "Mỗi dòng hóa đơn phải có unit_cost >= 0" };
        if (seen.has(poItem.variant_id)) return { invalid: true, message: "Hóa đơn có ấn bản bị lặp" };
        seen.add(poItem.variant_id);
        const remainingQty = Number(poItem.ordered_qty || 0) - Number(poItem.received_qty || 0);
        if (invoicedQty > remainingQty) return { invalid: true, message: "Số lượng hóa đơn không được vượt số lượng còn lại của đơn đặt hàng" };
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
          raw_payload: req.body || {},
          created_by_user_id: userId,
        },
      });

      await tx.supplier_delivery_invoice_items.createMany({
        data: invoiceItems.map((item) => ({ ...item, invoice_id: invoice.id })),
      });
      await registerDeliveryNote(tx, { delivery: invoice, items: invoiceItems, actorUserId: userId, recordedBy: "SMARTBOOK" });

      await audit(tx, userId, "SUPPLIER_INVOICE_CREATED", "SUPPLIER_DELIVERY_INVOICE", invoice.id, {
        purchase_order_id: po.id,
        invoice_number: invoice.invoice_number,
        line_count: invoiceItems.length,
      });

      return { data: invoice };
    });

    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.status(201).json({ message: "Supplier delivery invoice created", data: result.data });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "Số hóa đơn này đã tồn tại với nhà cung cấp" });
    console.error("Error while creating supplier delivery:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function createGoodsReceiptFromInvoice(req, res) {
  const invoiceId = parseId(req.params.id);
  const userId = parseId(req.user?.id);
  const warehouseId = parseId(req.body?.warehouse_id);
  const note = normalizeText(req.body?.note);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  // Retry-safe: the same Idempotency-Key always returns the receipt created the first time.
  const idempotencyKey = normalizeText(req.get?.("Idempotency-Key") || req.body?.idempotency_key)?.slice(0, 100) || null;

  if (!invoiceId) return res.status(400).json({ message: "Mã lần giao hàng của nhà cung cấp không hợp lệ" });
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!warehouseId) return res.status(400).json({ message: "Thiếu warehouse_id" });
  if (items.length === 0) return res.status(400).json({ message: "Thiếu items" });

  if (idempotencyKey) {
    const previous = await prisma.goods_receipts.findUnique({ where: { idempotency_key: idempotencyKey } });
    if (previous) {
      if (previous.supplier_delivery_invoice_id !== invoiceId) {
        return res.status(409).json({ message: "Idempotency-Key đã được dùng cho một phiếu giao khác" });
      }
      return res.status(200).json({ message: "Goods receipt already created for this request", data: mapCreatedReceipt(previous, invoiceId), idempotent: true });
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.supplier_delivery_invoices.findUnique({
        where: { id: invoiceId },
        include: {
          purchase_orders: { include: { purchase_order_items: true } },
          supplier_delivery_invoice_items: true,
        },
      });
      if (!invoice) return { invalid: true, statusCode: 404, message: "Không tìm thấy hóa đơn giao hàng của nhà cung cấp" };
      const po = invoice.purchase_orders;

      if (!(await canWriteWarehouse(req.user, po.warehouse_id))) {
        return { invalid: true, statusCode: 403, message: "Bạn không có quyền thao tác trên kho này" };
      }

      if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
        return { invalid: true, message: "Đơn đặt hàng chưa sẵn sàng để nhận hàng từ nhà cung cấp" };
      }
      if (warehouseId !== po.warehouse_id) {
        return { invalid: true, message: "warehouse_id phải trùng kho của đơn đặt hàng" };
      }

      // One delivery note = one goods receipt. A second (non-cancelled) receipt for the same
      // delivery would let the same goods be counted twice.
      const existing = await tx.goods_receipts.findFirst({
        where: { supplier_delivery_invoice_id: invoice.id, status: { not: "CANCELLED" } },
        select: { id: true, receipt_number: true, status: true },
      });
      if (existing) {
        return {
          invalid: true,
          statusCode: 409,
          message: `Phiếu giao này đã có phiếu nhập ${existing.receipt_number} (${existing.status}). Hủy phiếu đó trước nếu cần lập lại.`,
          existing_goods_receipt_id: existing.id,
        };
      }

      const invoiceItemsById = new Map(invoice.supplier_delivery_invoice_items.map((item) => [String(item.id), item]));
      const poItemsById = new Map(po.purchase_order_items.map((item) => [String(item.id), item]));
      const receiptItems = [];
      const seen = new Set();

      for (const rawLine of items) {
        const invoiceItemId = parseId(rawLine?.invoice_item_id);
        const invoiceItem = invoiceItemsById.get(String(invoiceItemId));
        const unitCost = Number(rawLine?.unit_cost ?? invoiceItem?.unit_cost ?? 0);
        if (!invoiceItem) return { invalid: true, message: "invoice_item_id không hợp lệ" };
        if (!Number.isFinite(unitCost) || unitCost < 0) return { invalid: true, message: "Mỗi dòng phiếu nhập phải có unit_cost >= 0" };
        if (seen.has(invoiceItem.variant_id)) return { invalid: true, message: "Phiếu nhập kho có ấn bản bị lặp" };
        seen.add(invoiceItem.variant_id);

        const poItem = poItemsById.get(String(invoiceItem.purchase_order_item_id));
        if (!poItem || poItem.variant_id !== invoiceItem.variant_id) {
          return { invalid: true, message: "Ấn bản trong hóa đơn không thuộc đơn đặt hàng" };
        }
        let outcome;
        try {
          outcome = computeLineOutcome({
            noteQty: invoiceItem.invoiced_qty,
            poRemainingQty: Number(poItem.ordered_qty || 0) - Number(poItem.received_qty || 0),
            delivered: rawLine?.delivered_qty ?? rawLine?.quantity,
            damaged: rawLine?.damaged_qty,
            rejected: rawLine?.rejected_qty,
          });
        } catch (error) {
          return { invalid: true, statusCode: error.statusCode || 400, message: error.message };
        }

        receiptItems.push({
          variant_id: invoiceItem.variant_id,
          location_id: parseId(rawLine?.location_id),
          quantity: outcome.accepted,
          delivered_qty: outcome.delivered,
          damaged_qty: outcome.damaged,
          rejected_qty: outcome.rejected,
          unit_cost: unitCost,
          note: normalizeText(rawLine?.note),
        });
      }
      if (receiptItems.every((item) => item.delivered_qty === 0)) {
        return { invalid: true, message: "Chưa có dòng nào thực nhận — không cần lập phiếu nhập" };
      }

      const locationIds = [...new Set(receiptItems.map((item) => item.location_id).filter(Boolean))];
      if (locationIds.length > 0) {
        const locationCount = await tx.locations.count({
          where: { id: { in: locationIds }, warehouse_id: po.warehouse_id, is_active: true },
        });
        if (locationCount !== locationIds.length) {
          return { invalid: true, message: "Có location_id không hợp lệ với kho này" };
        }
      }

      const receipt = await tx.goods_receipts.create({
        data: {
          receipt_number: createReceiptNumber(),
          purchase_order_id: po.id,
          warehouse_id: po.warehouse_id,
          supplier_delivery_invoice_id: invoice.id,
          source_type: "SUPPLIER_INVOICE",
          source_reference_id: invoice.id,
          idempotency_key: idempotencyKey,
          status: "DRAFT",
          received_by_user_id: userId,
          note: note || `Created from supplier invoice ${invoice.invoice_number}`,
        },
      });

      await tx.goods_receipt_items.createMany({
        data: receiptItems.map((item) => ({ goods_receipt_id: receipt.id, ...item })),
      });

      // Discrepancies (missing / damaged / rejected / overage) are recorded when the receipt is
      // POSTED, from the final counted quantities — not here, where the count can still change.
      await audit(tx, userId, "GOODS_RECEIPT_CREATED_FROM_SUPPLIER_INVOICE", "GOODS_RECEIPT", receipt.id, {
        purchase_order_id: po.id,
        invoice_id: invoice.id,
        receipt_number: receipt.receipt_number,
        total_delivered_qty: receiptItems.reduce((sum, item) => sum + item.delivered_qty, 0),
        total_accepted_qty: receiptItems.reduce((sum, item) => sum + item.quantity, 0),
        total_damaged_qty: receiptItems.reduce((sum, item) => sum + item.damaged_qty, 0),
        total_rejected_qty: receiptItems.reduce((sum, item) => sum + item.rejected_qty, 0),
      });

      return { data: { receipt } };
    });

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({
        message: result.message,
        ...(result.existing_goods_receipt_id ? { existing_goods_receipt_id: result.existing_goods_receipt_id } : {}),
      });
    }
    return res.status(201).json({
      message: "Goods receipt draft created from supplier invoice",
      data: mapCreatedReceipt(result.data.receipt, invoiceId),
    });
  } catch (error) {
    if (error.code === "P2002" && idempotencyKey) {
      const previous = await prisma.goods_receipts.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (previous) return res.status(200).json({ message: "Goods receipt already created for this request", data: mapCreatedReceipt(previous, invoiceId), idempotent: true });
    }
    console.error("Error while creating goods receipt from supplier invoice:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

function mapCreatedReceipt(receipt, invoiceId) {
  return {
    id: receipt.id,
    receipt_number: receipt.receipt_number,
    status: receipt.status,
    purchase_order_id: receipt.purchase_order_id,
    supplier_delivery_invoice_id: invoiceId,
    // Kept for API compatibility: discrepancy reports are now created when the receipt is posted.
    shortage_report_id: null,
  };
}

module.exports = {
  getSupplierDeliveries,
  getSupplierDeliveryById,
  createSupplierDelivery,
  createGoodsReceiptFromInvoice,
};
