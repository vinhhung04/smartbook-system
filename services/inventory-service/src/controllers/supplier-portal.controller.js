const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, toInt, normalizeText } = require("../utils/validation");

function getPortalTokenWhere(token) {
  return { payload: { path: ["portal_token"], equals: token } };
}

function mapPortalOrder(dispatch) {
  const po = dispatch.purchase_orders;
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
      status: invoice.status,
      invoice_date: invoice.invoice_date,
      expected_delivery_date: invoice.expected_delivery_date,
      items: invoice.supplier_delivery_invoice_items.map((item) => ({
        id: item.id,
        purchase_order_item_id: item.purchase_order_item_id,
        variant_id: item.variant_id,
        invoiced_qty: Number(item.invoiced_qty || 0),
        unit_cost: Number(item.unit_cost || 0),
      })),
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
            include: { supplier_delivery_invoice_items: true },
            orderBy: { created_at: "desc" },
          },
        },
      },
    },
  });
}

async function getPortalOrder(req, res) {
  const token = normalizeText(req.params.token);
  if (!token) return res.status(400).json({ message: "Portal token is required" });

  try {
    const dispatch = await findDispatchByToken(token);
    if (!dispatch) return res.status(404).json({ message: "Supplier portal order not found" });
    return res.json({ data: mapPortalOrder(dispatch) });
  } catch (error) {
    console.error("Error while loading supplier portal order:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function confirmPortalOrder(req, res) {
  const token = normalizeText(req.params.token);
  if (!token) return res.status(400).json({ message: "Portal token is required" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dispatch = await tx.supplier_order_dispatches.findFirst({
        where: getPortalTokenWhere(token),
        include: { purchase_orders: true },
      });
      if (!dispatch) return { invalid: true, statusCode: 404, message: "Supplier portal order not found" };
      const po = dispatch.purchase_orders;
      if (po.status !== "SENT_TO_SUPPLIER") {
        return { invalid: true, message: "Only sent purchase orders can be confirmed by supplier" };
      }

      await tx.supplier_order_dispatches.update({
        where: { id: dispatch.id },
        data: { status: "ACKNOWLEDGED", acknowledged_at: new Date(), updated_at: new Date() },
      });
      const updatedPo = await tx.purchase_orders.update({
        where: { id: po.id },
        data: { status: "SUPPLIER_CONFIRMED", updated_at: new Date() },
      });
      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: null,
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
  const invoiceNumber = normalizeText(req.body?.invoice_number);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!token) return res.status(400).json({ message: "Portal token is required" });
  if (!invoiceNumber) return res.status(400).json({ message: "invoice_number is required" });
  if (items.length === 0) return res.status(400).json({ message: "items is required" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dispatch = await tx.supplier_order_dispatches.findFirst({
        where: getPortalTokenWhere(token),
        include: { purchase_orders: { include: { purchase_order_items: true } } },
      });
      if (!dispatch) return { invalid: true, statusCode: 404, message: "Supplier portal order not found" };
      const po = dispatch.purchase_orders;
      if (!["SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(po.status)) {
        return { invalid: true, message: "Purchase order is not ready for supplier invoice" };
      }

      if (po.status === "SENT_TO_SUPPLIER") {
        await tx.purchase_orders.update({
          where: { id: po.id },
          data: { status: "SUPPLIER_CONFIRMED", updated_at: new Date() },
        });
        await tx.supplier_order_dispatches.update({
          where: { id: dispatch.id },
          data: { status: "ACKNOWLEDGED", acknowledged_at: new Date(), updated_at: new Date() },
        });
      }

      const poItemsById = new Map(po.purchase_order_items.map((item) => [String(item.id), item]));
      const invoiceItems = [];
      const seen = new Set();
      for (const rawLine of items) {
        const poItemId = parseId(rawLine?.purchase_order_item_id);
        const poItem = poItemsById.get(String(poItemId));
        const invoicedQty = toInt(rawLine?.invoiced_qty);
        const unitCost = Number(rawLine?.unit_cost);
        if (!poItem) return { invalid: true, message: "Invoice item must belong to this purchase order" };
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
          created_by_user_id: null,
        },
      });

      await tx.supplier_delivery_invoice_items.createMany({
        data: invoiceItems.map((item) => ({ ...item, invoice_id: invoice.id })),
      });
      await tx.inventory_audit_logs.create({
        data: {
          actor_user_id: null,
          action_name: "SUPPLIER_INVOICE_CREATED",
          entity_type: "SUPPLIER_DELIVERY_INVOICE",
          entity_id: invoice.id,
          after_data: { purchase_order_id: po.id, invoice_number: invoice.invoice_number, source: "SUPPLIER_PORTAL" },
        },
      });
      return { data: invoice };
    });

    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.status(201).json({ message: "Supplier invoice created", data: result.data });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ message: "Supplier invoice number already exists for this supplier" });
    console.error("Error while creating supplier portal invoice:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

function supplierCannotPostStock(_req, res) {
  return res.status(403).json({ message: "Supplier portal cannot create or post goods receipts" });
}

module.exports = {
  getPortalOrder,
  confirmPortalOrder,
  createPortalInvoice,
  supplierCannotPostStock,
};
