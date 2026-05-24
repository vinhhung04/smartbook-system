const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, toInt, normalizeText } = require("../utils/validation");

function getPortalTokenWhere(token) {
  return { payload: { path: ["portal_token"], equals: token } };
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
        note: item.note,
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
    const error = new Error("Supplier account role is required");
    error.statusCode = 403;
    throw error;
  }

  const email = (normalizeText(req.user?.email) || "").toLowerCase();
  if (!email) {
    const error = new Error("Supplier account email is required");
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
    const error = new Error("No active supplier is linked to this account email");
    error.statusCode = 403;
    throw error;
  }

  return supplier;
}

async function findAuthenticatedDispatch(req, poId) {
  if (!poId) {
    const error = new Error("Invalid purchase order id");
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
    const error = new Error("Supplier order not found for this account");
    error.statusCode = 404;
    throw error;
  }

  const token = dispatch.payload?.portal_token;
  if (!token) {
    const error = new Error("Supplier order is missing portal token metadata");
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
  const invoiceNumber = normalizeText(req.body?.invoice_number);
  const sourceShortageReportId = parseId(req.body?.source_shortage_report_id || req.body?.shortage_report_id);
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
          return { invalid: true, statusCode: 404, message: "Shortage report not found for this supplier order" };
        }
        shortageItemsByPoItemId = new Map(
          shortageReport.supplier_shortage_report_items.map((item) => [String(item.purchase_order_item_id), item]),
        );
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
        if (sourceShortageReportId) {
          const shortageItem = shortageItemsByPoItemId.get(String(poItem.id));
          if (!shortageItem) {
            return { invalid: true, message: "Redelivery invoice can only include items from the shortage report" };
          }
          if (invoicedQty > Number(shortageItem.shortage_qty || 0)) {
            return { invalid: true, message: "Redelivery quantity cannot exceed shortage quantity" };
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
    if (error.code === "P2002") return res.status(409).json({ message: "Supplier invoice number already exists for this supplier" });
    console.error("Error while creating supplier portal invoice:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function acknowledgeShortageReport(req, res) {
  const token = normalizeText(req.params.token);
  const reportId = parseId(req.params.reportId);
  if (!token) return res.status(400).json({ message: "Portal token is required" });
  if (!reportId) return res.status(400).json({ message: "Invalid shortage report id" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dispatch = await tx.supplier_order_dispatches.findFirst({
        where: getPortalTokenWhere(token),
        include: { purchase_orders: true },
      });
      if (!dispatch) return { invalid: true, statusCode: 404, message: "Supplier portal order not found" };
      const po = dispatch.purchase_orders;
      const report = await tx.supplier_shortage_reports.findFirst({
        where: { id: reportId, purchase_order_id: po.id, supplier_id: po.supplier_id },
      });
      if (!report) return { invalid: true, statusCode: 404, message: "Shortage report not found" };
      if (!["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status)) {
        return { invalid: true, message: "Shortage report cannot be acknowledged from current status" };
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
  if (!token) return res.status(400).json({ message: "Portal token is required" });
  if (!reportId) return res.status(400).json({ message: "Invalid shortage report id" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const dispatch = await tx.supplier_order_dispatches.findFirst({
        where: getPortalTokenWhere(token),
        include: { purchase_orders: true },
      });
      if (!dispatch) return { invalid: true, statusCode: 404, message: "Supplier portal order not found" };
      const po = dispatch.purchase_orders;
      const report = await tx.supplier_shortage_reports.findFirst({
        where: { id: reportId, purchase_order_id: po.id, supplier_id: po.supplier_id },
      });
      if (!report) return { invalid: true, statusCode: 404, message: "Shortage report not found" };
      if (!["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"].includes(report.status)) {
        return { invalid: true, message: "Shortage report cannot be updated from current status" };
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
  if (!reportId) return res.status(400).json({ message: "Invalid shortage report id" });
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

function supplierCannotPostStock(_req, res) {
  return res.status(403).json({ message: "Supplier portal cannot create or post goods receipts" });
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
};
