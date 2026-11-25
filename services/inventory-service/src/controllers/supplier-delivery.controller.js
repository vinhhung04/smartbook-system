const { RequestBindingError, receiptIdentity, assertReceiptReplay } = require('../services/request-binding.service');
const { findActiveDeliveryReceipt } = require('../services/delivery-receipt-guard.service');

const { prisma } = require("../lib/prisma");

const { parseId, toInt, normalizeText } = require("../utils/validation");
const { computeLineOutcome, assertInvoiceQtyWithinRemaining, assertLineNotClosed } = require("../services/procurement-receipt.service");
const { registerDeliveryNote } = require("../services/procurement-document.service");
const { isInvoiceFirst } = require("../services/purchase-order-line.service");
const { classifyBookCode } = require("../services/catalog-metadata.validation");
const { buildManualSku, getOrCreateUncategorizedCategory, getOrCreateUncategorizedPublisher } = require("./book.controller");
const { normalizeDeliveryAgainstInvoice } = require("../services/invoice-fulfillment.service");
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
    tracking_number: invoice.tracking_number || null,
    invoice_document_id: invoice.invoice_document_id || null,
    procurement_flow: invoice.purchase_orders?.procurement_flow || "LEGACY",
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
        title: item.purchase_order_items?.item_title || item.book_variants?.books?.title || null,
        sku: item.book_variants?.sku || null,
        isbn13: item.book_variants?.isbn13 || null,
        // ordered snapshot, shown when linking a typed book to the catalog at receiving
        item_code: item.purchase_order_items?.item_code || null,
        item_author: item.purchase_order_items?.item_author || null,
        item_publish_year: item.purchase_order_items?.item_publish_year ?? null,
        linked_to_catalog: Boolean(item.variant_id),
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
        procurement_flow: true,
        warehouse_id: true,
        warehouses: { select: { id: true, code: true, name: true } },
      },
    },
    supplier_delivery_invoice_items: {
      include: {
        purchase_order_items: {
          select: { id: true, ordered_qty: true, received_qty: true, item_title: true, item_code: true, item_author: true, item_publish_year: true },
        },
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

      await tx.$queryRawUnsafe("SELECT id FROM purchase_order_items WHERE purchase_order_id = $1::uuid ORDER BY id FOR UPDATE", po.id);
      const freshPoItems = await tx.purchase_order_items.findMany({ where: { purchase_order_id: po.id } });
      const poItemsById = new Map(freshPoItems.map((item) => [String(item.id), item]));
      const poItemsByVariant = new Map(freshPoItems.map((item) => [String(item.variant_id), item]));
      let invoiceItems = [];
      let invoiceDocumentId = null;
      if (isInvoiceFirst(po)) {
        // SmartBook recording a paper delivery note still ships against the approved invoice
        const checked = await normalizeDeliveryAgainstInvoice(tx, { ...po, purchase_order_items: freshPoItems }, parseId(req.body?.invoice_document_id), items);
        invoiceItems = checked.items;
        invoiceDocumentId = checked.invoice.id;
      }
      const seen = new Set();

      for (const rawLine of invoiceDocumentId ? [] : items) {
        const poItemId = parseId(rawLine?.purchase_order_item_id);
        const variantId = parseId(rawLine?.variant_id);
        const poItem = poItemId ? poItemsById.get(poItemId) : poItemsByVariant.get(String(variantId));
        const invoicedQty = toInt(rawLine?.invoiced_qty);
        const unitCost = Number(rawLine?.unit_cost);
        if (!poItem) return { invalid: true, message: "Ấn bản trong hóa đơn không thuộc đơn đặt hàng" };
        assertLineNotClosed(poItem);
        if (variantId && variantId !== poItem.variant_id) return { invalid: true, message: "purchase_order_item_id và variant_id không khớp nhau" };
        if (!invoicedQty || invoicedQty <= 0) return { invalid: true, message: "Mỗi dòng hóa đơn phải có invoiced_qty > 0" };
        if (!Number.isFinite(unitCost) || unitCost < 0) return { invalid: true, message: "Mỗi dòng hóa đơn phải có unit_cost >= 0" };
        if (seen.has(poItem.variant_id)) return { invalid: true, message: "Hóa đơn có ấn bản bị lặp" };
        seen.add(poItem.variant_id);
        const remainingQty = Number(poItem.ordered_qty || 0) - Number(poItem.received_qty || 0);
        if (invoicedQty > remainingQty) return { invalid: true, message: "Số lượng hóa đơn không được vượt số lượng còn lại của đơn đặt hàng" };
        const remainingNoted = await assertInvoiceQtyWithinRemaining(tx, poItem, invoicedQty);
        if (remainingNoted !== null) return { invalid: true, message: `Số lượng phiếu giao vượt phần PO chưa khai báo giao (${Math.max(0, remainingNoted)})` };
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
          tracking_number: normalizeText(req.body?.tracking_number),
          invoice_document_id: invoiceDocumentId,
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
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
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

  try {
    if (idempotencyKey) {
      const previous = await prisma.goods_receipts.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (previous) {
        return await replayCreatedReceipt(req, res, previous, invoiceId, warehouseId);
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT id FROM supplier_delivery_invoices WHERE id = $1::uuid FOR UPDATE", invoiceId);
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
      const existing = await findActiveDeliveryReceipt(tx, invoice.id);
      if (existing) {
        if (idempotencyKey && existing.idempotency_key === idempotencyKey) {
          await assertReceiptReplay(tx, req, existing, invoice);
          return { data: { receipt: existing }, idempotent: true };
        }
        return {
          invalid: true,
          statusCode: 409,
          message: `Phiếu giao này đã có phiếu nhập ${existing.receipt_number} (${existing.status}). Hủy phiếu đó trước nếu cần lập lại.`,
          existing_goods_receipt_id: existing.id,
        };
      }

      // Invoice-first lines may be typed books not in the catalog yet: stock needs a real variant.
      const unlinked = invoice.supplier_delivery_invoice_items.filter((item) => !item.variant_id);
      if (unlinked.length > 0) {
        const titles = unlinked.map((item) => po.purchase_order_items.find((row) => row.id === item.purchase_order_item_id)?.item_title || "sách");
        return {
          invalid: true,
          statusCode: 409,
          code: "PO_LINE_NOT_LINKED",
          message: `Cần liên kết sách với danh mục trước khi nhập kho: ${titles.join(", ")}`,
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
      if (receiptItems.length !== invoice.supplier_delivery_invoice_items.length) {
        return { invalid: true, message: "Phải kiểm đếm đầy đủ các dòng phiếu giao, ghi 0 cho dòng không thực nhận" };
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
          // unassigned: left for warehouse staff to claim (Công việc kho của tôi) or for a later assignment
          received_by_user_id: req.body?.unassigned === true ? null : userId,
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
        request_identity: receiptIdentity(req, invoice),
      });

      return { data: { receipt } };
    });

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({
        message: result.message,
        ...(result.code ? { code: result.code } : {}),
        ...(result.existing_goods_receipt_id ? { existing_goods_receipt_id: result.existing_goods_receipt_id } : {}),
      });
    }
    return res.status(result.idempotent ? 200 : 201).json({
      message: result.idempotent ? "Goods receipt already created for this request" : "Goods receipt draft created from supplier invoice",
      data: mapCreatedReceipt(result.data.receipt, invoiceId),
      ...(result.idempotent ? { idempotent: true } : {}),
    });
  } catch (error) {
    if (error instanceof RequestBindingError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    if (error.code === "P2002" && idempotencyKey) {
      const previous = await prisma.goods_receipts.findUnique({ where: { idempotency_key: idempotencyKey } });
      if (previous) return await replayCreatedReceipt(req, res, previous, invoiceId, warehouseId);
    }
    console.error("Error while creating goods receipt from supplier invoice:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Receiving a typed book: the code scanned or typed from the physical book decides how a new
 * catalog variant is identified. ISBN-13 / EAN-13 are standard codes, an ISBN-10 is converted to
 * its ISBN-13, anything else (no standard barcode) becomes the internal barcode.
 * Pure; throws a 400-style error object for unusable input.
 */
function classifyReceivingCode(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { error: "Nhập hoặc quét mã in trên sách" };
  const { kind, code } = classifyBookCode(raw);
  if (kind === "ISBN13") return { isbn13: code, internal_barcode: code, standard: true };
  if (kind === "EAN13") return { isbn13: null, internal_barcode: code, standard: true };
  if (kind === "ISBN10") {
    const core = `978${code.slice(0, 9)}`;
    const sum = [...core].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    const isbn13 = `${core}${(10 - (sum % 10)) % 10}`;
    return { isbn13, isbn10: code, internal_barcode: isbn13, standard: true };
  }
  // same rule as the catalog's internal barcode: only a 13-digit code with a wrong EAN/ISBN check
  // digit is refused (almost surely a misread barcode); other shapes are internal codes
  if (kind === "INVALID" && code.length === 13) return { error: `Mã ${code} có dạng ISBN-13/EAN-13 nhưng sai số kiểm tra — kiểm tra lại mã in trên sách` };
  if (raw.length > 50) return { error: "Mã nội bộ tối đa 50 ký tự" };
  return { isbn13: null, internal_barcode: raw, standard: false };
}

/**
 * Inside a transaction: link a typed PO line (invoice-first, not in the catalog when ordered)
 * to a catalog variant. The PO snapshot (title, code, author, year) is kept as ordered and the
 * catalog record is not modified. Returns { data } or { invalid, statusCode, message }.
 */
async function linkPoItemInTx(tx, { user, deliveryId, poItemId, variantId, userId, createdBookId = null }) {
  await tx.$queryRawUnsafe("SELECT id FROM purchase_order_items WHERE id = $1::uuid FOR UPDATE", poItemId);
  const delivery = await tx.supplier_delivery_invoices.findUnique({
    where: { id: deliveryId },
    include: { purchase_orders: true, supplier_delivery_invoice_items: { select: { purchase_order_item_id: true } } },
  });
  if (!delivery) return { invalid: true, statusCode: 404, message: "Không tìm thấy phiếu giao hàng" };
  if (!(await canWriteWarehouse(user, delivery.purchase_orders.warehouse_id))) {
    return { invalid: true, statusCode: 403, message: "Bạn không có quyền thao tác trên kho này" };
  }
  if (!delivery.supplier_delivery_invoice_items.some((item) => item.purchase_order_item_id === poItemId)) {
    return { invalid: true, message: "Dòng sách này không có trên phiếu giao" };
  }
  const poItem = await tx.purchase_order_items.findUnique({ where: { id: poItemId } });
  if (variantId && poItem.variant_id === variantId) return { data: poItem, unchanged: true };
  if (poItem.variant_id) return { invalid: true, statusCode: 409, message: "Dòng này đã được liên kết với một sách khác" };
  if (!variantId) return { data: poItem, poItem };

  const variant = await tx.book_variants.findFirst({ where: { id: variantId, is_active: true }, select: { id: true } });
  if (!variant) return { invalid: true, statusCode: 404, message: "Không tìm thấy sách trong danh mục hoặc sách đã ngừng hoạt động" };
  const clash = await tx.purchase_order_items.findFirst({
    where: { purchase_order_id: poItem.purchase_order_id, variant_id: variantId, id: { not: poItemId } },
    select: { item_title: true },
  });
  if (clash) return { invalid: true, statusCode: 409, message: `Sách này đã có trên dòng "${clash.item_title || "khác"}" của cùng đơn` };

  const updated = await tx.purchase_order_items.update({ where: { id: poItemId }, data: { variant_id: variantId } });
  await tx.supplier_delivery_invoice_items.updateMany({ where: { purchase_order_item_id: poItemId, variant_id: null }, data: { variant_id: variantId } });
  await tx.procurement_document_lines.updateMany({ where: { purchase_order_item_id: poItemId, variant_id: null }, data: { variant_id: variantId } });
  await audit(tx, userId, "PURCHASE_ORDER_ITEM_LINKED_TO_CATALOG", "PURCHASE_ORDER", poItem.purchase_order_id, {
    purchase_order_item_id: poItemId,
    variant_id: variantId,
    created_book_id: createdBookId,
    ordered_snapshot: { title: poItem.item_title, code: poItem.item_code, author: poItem.item_author, publish_year: poItem.item_publish_year },
    delivery_id: deliveryId,
  });
  return { data: updated };
}

/** Receiving links a typed PO line to an existing catalog book. */
async function linkDeliveryItemToCatalog(req, res) {
  const deliveryId = parseId(req.params.id);
  const poItemId = parseId(req.body?.purchase_order_item_id);
  const variantId = parseId(req.body?.variant_id);
  if (!deliveryId || !poItemId || !variantId) return res.status(400).json({ message: "Thiếu phiếu giao, dòng đơn hoặc sách cần liên kết" });

  try {
    const result = await prisma.$transaction((tx) => linkPoItemInTx(tx, { user: req.user, deliveryId, poItemId, variantId, userId: parseId(req.user?.id) }));
    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.json({ message: result.unchanged ? "Dòng đã được liên kết với sách này" : "Đã liên kết sách với danh mục", data: result.data });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "Sách này đã có trên một dòng khác của cùng đơn" });
    console.error("Error while linking PO item to catalog:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

/**
 * Receiving a book that is not in the catalog: create it from the ordered snapshot (title, author,
 * publish year) with the code read from the physical book, then link the PO line - one transaction.
 * A code already used by another catalog book is refused with that book, so the UI can link it instead.
 */
async function createCatalogBookAndLink(req, res) {
  const deliveryId = parseId(req.params.id);
  const poItemId = parseId(req.body?.purchase_order_item_id);
  const userId = parseId(req.user?.id);
  const price = Number(req.body?.price);
  if (!deliveryId || !poItemId) return res.status(400).json({ message: "Thiếu phiếu giao hoặc dòng đơn" });
  const code = classifyReceivingCode(req.body?.code);
  if (code.error) return res.status(400).json({ message: code.error, code: "INVALID_BOOK_CODE" });
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "Giá bán phải là số lớn hơn hoặc bằng 0" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      // same access / state checks as linking, without a variant yet
      const check = await linkPoItemInTx(tx, { user: req.user, deliveryId, poItemId, variantId: null, userId });
      if (check.invalid) return check;
      const poItem = check.poItem;

      const codes = [...new Set([code.internal_barcode, code.isbn13, code.isbn10].filter(Boolean))];
      const existing = await tx.book_variants.findFirst({
        where: { OR: codes.flatMap((value) => [{ isbn13: value }, { isbn10: value }, { internal_barcode: value }, { sku: value }]) },
        select: { id: true, books: { select: { title: true } } },
      });
      if (existing) {
        return {
          invalid: true,
          statusCode: 409,
          code: "BOOK_CODE_EXISTS",
          existing: { variant_id: existing.id, title: existing.books?.title || null },
          message: `Mã ${code.internal_barcode} đã thuộc sách "${existing.books?.title || "khác"}" trong danh mục`,
        };
      }

      const [category, publisher] = await Promise.all([getOrCreateUncategorizedCategory(tx), getOrCreateUncategorizedPublisher(tx)]);
      const book = await tx.books.create({
        data: {
          title: poItem.item_title,
          default_language: "vi",
          publisher_id: publisher.id,
          metadata: {
            is_incomplete: true,
            requires_librarian_review: true,
            incomplete_reason: "Created at receiving from a purchase order line",
            purchase_order_item_id: poItem.id,
            created_by_user_id: userId,
          },
        },
      });
      await tx.book_categories.create({ data: { book_id: book.id, category_id: category.id } });
      if (poItem.item_author) {
        const author = await tx.authors.upsert({ where: { full_name: poItem.item_author.slice(0, 150) }, update: {}, create: { full_name: poItem.item_author.slice(0, 150) } });
        await tx.book_authors.create({ data: { book_id: book.id, author_id: author.id } });
      }
      const variant = await tx.book_variants.create({
        data: {
          book_id: book.id,
          sku: buildManualSku(code.internal_barcode),
          internal_barcode: code.internal_barcode,
          ...(code.isbn13 ? { isbn13: code.isbn13 } : {}),
          ...(code.isbn10 ? { isbn10: code.isbn10 } : {}),
          unit_cost: Number(poItem.unit_cost || 0),
          list_price: price,
          language_code: "vi",
          ...(poItem.item_publish_year ? { publish_year: poItem.item_publish_year } : {}),
        },
      });
      await audit(tx, userId, "INCOMPLETE_BOOK_CREATED_FROM_PURCHASE_ORDER", "BOOK", book.id, {
        title: poItem.item_title,
        author: poItem.item_author,
        internal_barcode: code.internal_barcode,
        isbn13: code.isbn13,
        standard_code: code.standard,
        purchase_order_item_id: poItem.id,
      });
      const linked = await linkPoItemInTx(tx, { user: req.user, deliveryId, poItemId, variantId: variant.id, userId, createdBookId: book.id });
      if (linked.invalid) throw Object.assign(new Error(linked.message), { statusCode: linked.statusCode });
      return { data: { variant_id: variant.id, book_id: book.id, internal_barcode: code.internal_barcode, isbn13: code.isbn13 } };
    });
    if (result.invalid) {
      return res.status(result.statusCode || 400).json({ message: result.message, ...(result.code ? { code: result.code } : {}), ...(result.existing ? { existing: result.existing } : {}) });
    }
    return res.status(201).json({ message: "Đã tạo sách trong danh mục và liên kết", data: result.data });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    if (error.code === "P2002") return res.status(409).json({ message: "Mã sách vừa được dùng cho sách khác, hãy tải lại", code: "BOOK_CODE_EXISTS" });
    console.error("Error while creating catalog book at receiving:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function replayCreatedReceipt(req, res, receipt, invoiceId, warehouseId) {
  // A key is not an access credential. Authorize the stored receipt and its actual
  // delivery/PO warehouse on both normal replay and unique-constraint recovery.
  if (!(await canWriteWarehouse(req.user, receipt.warehouse_id))) {
    return res.status(403).json({ message: "Bạn không có quyền thao tác trên kho này" });
  }
  if (receipt.supplier_delivery_invoice_id !== invoiceId) {
    return res.status(409).json({ message: "Idempotency-Key đã được dùng cho một phiếu giao khác" });
  }
  const invoice = await prisma.supplier_delivery_invoices.findUnique({ where: { id: invoiceId }, include: { purchase_orders: true, supplier_delivery_invoice_items: true } });
  const po = invoice?.purchase_orders;
  if (!po || !(await canWriteWarehouse(req.user, po.warehouse_id))) {
    return res.status(403).json({ message: "Bạn không có quyền thao tác trên kho này" });
  }
  if (warehouseId !== po.warehouse_id || receipt.warehouse_id !== po.warehouse_id || receipt.purchase_order_id !== po.id) {
    return res.status(409).json({ message: "Idempotency-Key không khớp chứng từ và kho của yêu cầu" });
  }
  try {
    await assertReceiptReplay(prisma, req, receipt, invoice);
  } catch (error) {
    if (error instanceof RequestBindingError) return res.status(error.statusCode).json({ message: error.message, code: error.code });
    throw error;
  }
  return res.status(200).json({ message: "Goods receipt already created for this request", data: mapCreatedReceipt(receipt, invoiceId), idempotent: true });
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
  linkDeliveryItemToCatalog,
  createCatalogBookAndLink,
  classifyReceivingCode,
  getSupplierDeliveries,
  getSupplierDeliveryById,
  createSupplierDelivery,
  createGoodsReceiptFromInvoice,
};
