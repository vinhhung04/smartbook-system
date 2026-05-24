const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, toInt, normalizeText } = require("../utils/validation");

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
    status: invoice.status,
    supplier_note: invoice.supplier_note,
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
  if (!id) return res.status(400).json({ message: "Invalid supplier delivery id" });

  try {
    const invoice = await prisma.supplier_delivery_invoices.findUnique({
      where: { id },
      include: invoiceInclude(),
    });
    if (!invoice) return res.status(404).json({ message: "Supplier delivery invoice not found" });
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
  if (!purchaseOrderId) return res.status(400).json({ message: "purchase_order_id is required" });
  if (!invoiceNumber) return res.status(400).json({ message: "invoice_number is required" });
  if (items.length === 0) return res.status(400).json({ message: "items is required" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.findUnique({
        where: { id: purchaseOrderId },
        include: { purchase_order_items: true },
      });
      if (!po) return { invalid: true, statusCode: 404, message: "Purchase order not found" };
      if (!["SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(po.status)) {
        return { invalid: true, message: "Purchase order must be sent to supplier before supplier invoice can be created" };
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
        if (!poItem) return { invalid: true, message: "Invoice item variant does not belong to purchase order" };
        if (variantId && variantId !== poItem.variant_id) return { invalid: true, message: "purchase_order_item_id and variant_id do not match" };
        if (!invoicedQty || invoicedQty <= 0) return { invalid: true, message: "Each invoice item must include invoiced_qty > 0" };
        if (!Number.isFinite(unitCost) || unitCost < 0) return { invalid: true, message: "Each invoice item must include unit_cost >= 0" };
        if (seen.has(poItem.variant_id)) return { invalid: true, message: "Duplicate variant in invoice items" };
        seen.add(poItem.variant_id);
        const remainingQty = Number(poItem.ordered_qty || 0) - Number(poItem.received_qty || 0);
        if (invoicedQty > remainingQty) return { invalid: true, message: "Invoice quantity cannot exceed remaining purchase order quantity" };
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
          status: "SUBMITTED",
          supplier_note: normalizeText(req.body?.supplier_note),
          raw_payload: req.body || {},
          created_by_user_id: userId,
        },
      });

      await tx.supplier_delivery_invoice_items.createMany({
        data: invoiceItems.map((item) => ({ ...item, invoice_id: invoice.id })),
      });

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
    if (error.code === "P2002") return res.status(409).json({ message: "Supplier invoice number already exists for this supplier" });
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

  if (!invoiceId) return res.status(400).json({ message: "Invalid supplier delivery id" });
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (!warehouseId) return res.status(400).json({ message: "warehouse_id is required" });
  if (items.length === 0) return res.status(400).json({ message: "items is required" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.supplier_delivery_invoices.findUnique({
        where: { id: invoiceId },
        include: {
          purchase_orders: { include: { purchase_order_items: true } },
          supplier_delivery_invoice_items: true,
        },
      });
      if (!invoice) return { invalid: true, statusCode: 404, message: "Supplier delivery invoice not found" };
      const po = invoice.purchase_orders;
      if (!RECEIVABLE_PO_STATUSES.includes(po.status)) {
        return { invalid: true, message: "Purchase order is not ready for supplier receiving" };
      }
      if (warehouseId !== po.warehouse_id) {
        return { invalid: true, message: "warehouse_id must match purchase order warehouse" };
      }

      const invoiceItemsById = new Map(invoice.supplier_delivery_invoice_items.map((item) => [String(item.id), item]));
      const poItemsById = new Map(po.purchase_order_items.map((item) => [String(item.id), item]));
      const receiptItems = [];
      const shortageItems = [];
      const seen = new Set();

      for (const rawLine of items) {
        const invoiceItemId = parseId(rawLine?.invoice_item_id);
        const invoiceItem = invoiceItemsById.get(String(invoiceItemId));
        const deliveredQty = toInt(rawLine?.delivered_qty ?? rawLine?.quantity);
        const unitCost = Number(rawLine?.unit_cost ?? invoiceItem?.unit_cost ?? 0);
        if (!invoiceItem) return { invalid: true, message: "invoice_item_id is invalid" };
        if (!deliveredQty || deliveredQty <= 0) return { invalid: true, message: "Each receipt item must include delivered_qty > 0" };
        if (!Number.isFinite(unitCost) || unitCost < 0) return { invalid: true, message: "Each receipt item must include unit_cost >= 0" };
        if (seen.has(invoiceItem.variant_id)) return { invalid: true, message: "Duplicate variant in goods receipt items" };
        seen.add(invoiceItem.variant_id);

        const poItem = poItemsById.get(String(invoiceItem.purchase_order_item_id));
        if (!poItem || poItem.variant_id !== invoiceItem.variant_id) {
          return { invalid: true, message: "Invoice item variant does not belong to purchase order" };
        }
        const remainingQty = Number(poItem.ordered_qty || 0) - Number(poItem.received_qty || 0);
        if (deliveredQty > remainingQty) {
          return { invalid: true, message: "Cannot receive more than remaining purchase order quantity" };
        }

        const locationId = parseId(rawLine?.location_id);
        receiptItems.push({
          invoice_item_id: invoiceItem.id,
          purchase_order_item_id: poItem.id,
          variant_id: invoiceItem.variant_id,
          location_id: locationId,
          quantity: deliveredQty,
          unit_cost: unitCost,
          note: normalizeText(rawLine?.note),
        });

        const shortageQty = Math.max(0, remainingQty - deliveredQty, Number(invoiceItem.invoiced_qty || 0) - deliveredQty);
        if (shortageQty > 0) {
          shortageItems.push({
            purchase_order_item_id: poItem.id,
            variant_id: invoiceItem.variant_id,
            ordered_qty: Number(poItem.ordered_qty || 0),
            received_qty: Number(poItem.received_qty || 0) + deliveredQty,
            shortage_qty: shortageQty,
            note: normalizeText(rawLine?.note) || `Supplier delivered ${deliveredQty}/${remainingQty}`,
          });
        }
      }

      const locationIds = [...new Set(receiptItems.map((item) => item.location_id).filter(Boolean))];
      if (locationIds.length > 0) {
        const locationCount = await tx.locations.count({
          where: { id: { in: locationIds }, warehouse_id: po.warehouse_id, is_active: true },
        });
        if (locationCount !== locationIds.length) {
          return { invalid: true, message: "One or more location_id values are invalid for this warehouse" };
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
          status: "DRAFT",
          received_by_user_id: userId,
          note: note || `Created from supplier invoice ${invoice.invoice_number}`,
        },
      });

      await tx.goods_receipt_items.createMany({
        data: receiptItems.map((item) => ({
          goods_receipt_id: receipt.id,
          variant_id: item.variant_id,
          location_id: item.location_id,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
          note: item.note,
        })),
      });

      for (const item of receiptItems) {
        await tx.supplier_delivery_invoice_items.update({
          where: { id: item.invoice_item_id },
          data: {
            delivered_qty: item.quantity,
            accepted_qty: { increment: item.quantity },
            updated_at: new Date(),
          },
        });
      }

      let shortageReport = null;
      if (shortageItems.length > 0) {
        shortageReport = await tx.supplier_shortage_reports.create({
          data: {
            purchase_order_id: po.id,
            supplier_id: invoice.supplier_id,
            goods_receipt_id: receipt.id,
            invoice_id: invoice.id,
            status: "OPEN",
            reason: "Supplier delivered less than remaining purchase order quantity or invoice quantity",
            created_by_user_id: userId,
          },
        });
        await tx.supplier_shortage_report_items.createMany({
          data: shortageItems.map((item) => ({
            shortage_report_id: shortageReport.id,
            ...item,
          })),
        });
        await tx.purchase_orders.update({
          where: { id: po.id },
          data: { status: "SHORTAGE_REPORTED", updated_at: new Date() },
        });
        await audit(tx, userId, "SUPPLIER_SHORTAGE_REPORTED", "SUPPLIER_SHORTAGE_REPORT", shortageReport.id, {
          purchase_order_id: po.id,
          invoice_id: invoice.id,
          goods_receipt_id: receipt.id,
          line_count: shortageItems.length,
        });
      }

      await tx.supplier_delivery_invoices.update({
        where: { id: invoice.id },
        data: { status: shortageItems.length > 0 ? "SHORTAGE_REPORTED" : "RECEIVED", updated_at: new Date() },
      });

      await audit(tx, userId, "GOODS_RECEIPT_CREATED_FROM_SUPPLIER_INVOICE", "GOODS_RECEIPT", receipt.id, {
        purchase_order_id: po.id,
        invoice_id: invoice.id,
        receipt_number: receipt.receipt_number,
        total_quantity: receiptItems.reduce((sum, item) => sum + item.quantity, 0),
        shortage_report_id: shortageReport?.id || null,
      });

      return { data: { receipt, shortageReport } };
    });

    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.status(201).json({
      message: "Goods receipt draft created from supplier invoice",
      data: {
        id: result.data.receipt.id,
        receipt_number: result.data.receipt.receipt_number,
        status: result.data.receipt.status,
        purchase_order_id: result.data.receipt.purchase_order_id,
        supplier_delivery_invoice_id: invoiceId,
        shortage_report_id: result.data.shortageReport?.id || null,
      },
    });
  } catch (error) {
    console.error("Error while creating goods receipt from supplier invoice:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  getSupplierDeliveries,
  getSupplierDeliveryById,
  createSupplierDelivery,
  createGoodsReceiptFromInvoice,
};
