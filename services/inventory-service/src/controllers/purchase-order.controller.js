const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, toInt, normalizeText, normalizeIsbn13 } = require("../utils/validation");

const PO_STATUSES = {
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PARTIALLY_RECEIVED: "PARTIALLY_RECEIVED",
  RECEIVED: "RECEIVED",
  CANCELLED: "CANCELLED",
};

function numberValue(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function createPoNumber() {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `PO-${Date.now()}-${suffix}`;
}

function createReceiptNumber() {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GR-${Date.now()}-${suffix}`;
}

function calculateReconciliationStatus(totalOrderedQty, totalReceivedQty) {
  if (totalReceivedQty <= 0) return "NOT_RECEIVED";
  if (totalReceivedQty > totalOrderedQty) return "OVER_RECEIVED";
  if (totalReceivedQty === totalOrderedQty) return "FULLY_RECEIVED";
  return "PARTIALLY_RECEIVED";
}

function calculateLineStatus(orderedQty, receivedQty) {
  if (receivedQty <= 0) return "NOT_RECEIVED";
  if (receivedQty === orderedQty) return "MATCHED";
  if (receivedQty > orderedQty) return "OVER_RECEIVED";
  return "UNDER_RECEIVED";
}

function summarizeItems(items = []) {
  return items.reduce(
    (acc, item) => {
      const ordered = Number(item.ordered_qty || 0);
      const received = Number(item.received_qty || 0);
      const unitCost = numberValue(item.unit_cost);
      acc.item_count += 1;
      acc.total_ordered_qty += ordered;
      acc.total_received_qty += received;
      acc.total_amount += ordered * unitCost;
      return acc;
    },
    {
      item_count: 0,
      total_ordered_qty: 0,
      total_received_qty: 0,
      total_amount: 0,
    },
  );
}

function mapPurchaseOrderSummary(po) {
  const totals = summarizeItems(po.purchase_order_items || []);
  return {
    id: po.id,
    po_number: po.po_number,
    supplier_id: po.supplier_id,
    supplier_name: po.suppliers?.name || null,
    warehouse_id: po.warehouse_id,
    warehouse_code: po.warehouses?.code || null,
    warehouse_name: po.warehouses?.name || null,
    status: po.status,
    ordered_by_user_id: po.ordered_by_user_id,
    approved_by_user_id: po.approved_by_user_id,
    order_date: po.order_date,
    expected_date: po.expected_date,
    item_count: totals.item_count,
    total_ordered_qty: totals.total_ordered_qty,
    total_received_qty: totals.total_received_qty,
    total_amount: totals.total_amount,
    reconciliation_status: calculateReconciliationStatus(
      totals.total_ordered_qty,
      totals.total_received_qty,
    ),
    note: po.note,
    created_at: po.created_at,
    updated_at: po.updated_at,
  };
}

function mapPurchaseOrderItem(item) {
  const orderedQty = Number(item.ordered_qty || 0);
  const receivedQty = Number(item.received_qty || 0);
  const unitCost = numberValue(item.unit_cost);
  return {
    id: item.id,
    variant_id: item.variant_id,
    book_id: item.book_variants?.books?.id || null,
    title: item.book_variants?.books?.title || "Chua co ten sach",
    sku: item.book_variants?.sku || null,
    isbn13: item.book_variants?.isbn13 || null,
    ordered_qty: orderedQty,
    received_qty: receivedQty,
    remaining_qty: Math.max(0, orderedQty - receivedQty),
    unit_cost: unitCost,
    line_total: orderedQty * unitCost,
    reconciliation_status: calculateLineStatus(orderedQty, receivedQty),
    note: item.note,
  };
}

function mapGoodsReceiptSummary(receipt) {
  const items = receipt.goods_receipt_items || [];
  return {
    id: receipt.id,
    receipt_number: receipt.receipt_number,
    status: receipt.status,
    received_at: receipt.received_at,
    item_count: items.length,
    total_quantity: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
  };
}

function buildTimeline(po, totals) {
  return [
    { label: "Created", completed: true, time: po.created_at },
    {
      label: "Submitted",
      completed: ![PO_STATUSES.DRAFT, PO_STATUSES.REJECTED].includes(po.status),
      time: ![PO_STATUSES.DRAFT, PO_STATUSES.REJECTED].includes(po.status) ? po.updated_at : null,
    },
    {
      label: "Approved",
      completed: [
        PO_STATUSES.APPROVED,
        PO_STATUSES.PARTIALLY_RECEIVED,
        PO_STATUSES.RECEIVED,
      ].includes(po.status),
      time: po.approved_by_user_id ? po.updated_at : null,
    },
    {
      label: "Received",
      completed: totals.total_received_qty > 0,
      time: totals.total_received_qty > 0 ? po.updated_at : null,
    },
  ];
}

function mapPurchaseOrderDetail(po) {
  const items = (po.purchase_order_items || []).map(mapPurchaseOrderItem);
  const totals = summarizeItems(po.purchase_order_items || []);
  return {
    id: po.id,
    po_number: po.po_number,
    supplier_id: po.supplier_id,
    warehouse_id: po.warehouse_id,
    supplier: po.suppliers || null,
    warehouse: po.warehouses || null,
    status: po.status,
    ordered_by_user_id: po.ordered_by_user_id,
    approved_by_user_id: po.approved_by_user_id,
    order_date: po.order_date,
    expected_date: po.expected_date,
    note: po.note,
    item_count: totals.item_count,
    total_ordered_qty: totals.total_ordered_qty,
    total_received_qty: totals.total_received_qty,
    total_amount: totals.total_amount,
    reconciliation_status: calculateReconciliationStatus(
      totals.total_ordered_qty,
      totals.total_received_qty,
    ),
    created_at: po.created_at,
    updated_at: po.updated_at,
    items,
    goods_receipts: (po.goods_receipts || []).map(mapGoodsReceiptSummary),
    timeline: buildTimeline(po, totals),
  };
}

async function audit(tx, actorUserId, actionName, entityId, afterData, beforeData = null) {
  await tx.inventory_audit_logs.create({
    data: {
      actor_user_id: actorUserId || null,
      action_name: actionName,
      entity_type: "PURCHASE_ORDER",
      entity_id: entityId,
      before_data: beforeData,
      after_data: afterData,
    },
  });
}

async function resolveVariantIdByIdentifier(tx, line) {
  const directVariantId = parseId(line?.variant_id);
  if (directVariantId) return directVariantId;

  const isbn13 = normalizeIsbn13(line?.isbn13);
  if (!isbn13 || !/^\d{13}$/.test(isbn13)) return null;

  const variant = await tx.book_variants.findFirst({
    where: { isbn13, is_active: true },
    select: { id: true },
  });
  return variant?.id || null;
}

async function normalizePurchaseOrderPayload(tx, body) {
  const supplierId = parseId(body?.supplier_id);
  const warehouseId = parseId(body?.warehouse_id);
  const expectedDate = normalizeText(body?.expected_date);
  const note = normalizeText(body?.note);
  const lines = Array.isArray(body?.items) ? body.items : [];

  if (!supplierId) return { invalid: true, message: "supplier_id is required" };
  if (!warehouseId) return { invalid: true, message: "warehouse_id is required" };
  if (lines.length === 0) return { invalid: true, message: "items is required" };
  if (expectedDate && Number.isNaN(new Date(expectedDate).getTime())) {
    return { invalid: true, message: "expected_date is invalid" };
  }

  const [supplier, warehouse] = await Promise.all([
    tx.suppliers.findUnique({
      where: { id: supplierId },
      select: { id: true, status: true },
    }),
    tx.warehouses.findUnique({
      where: { id: warehouseId },
      select: { id: true, is_active: true },
    }),
  ]);

  if (!supplier || supplier.status !== "ACTIVE") {
    return { invalid: true, message: "Supplier not found or inactive" };
  }
  if (!warehouse || !warehouse.is_active) {
    return { invalid: true, message: "Warehouse not found or inactive" };
  }

  const normalizedItems = [];
  const seenVariants = new Set();
  for (const rawLine of lines) {
    const orderedQty = toInt(rawLine?.ordered_qty);
    const unitCost = Number(rawLine?.unit_cost);
    if (!orderedQty || orderedQty <= 0) {
      return { invalid: true, message: "Each item must include ordered_qty > 0" };
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      return { invalid: true, message: "Each item must include unit_cost >= 0" };
    }

    const variantId = await resolveVariantIdByIdentifier(tx, rawLine);
    if (!variantId) {
      return { invalid: true, message: "Each item must include a valid variant_id or isbn13" };
    }
    if (seenVariants.has(variantId)) {
      return { invalid: true, message: "Duplicate variant in purchase order items" };
    }
    seenVariants.add(variantId);
    normalizedItems.push({
      variant_id: variantId,
      ordered_qty: orderedQty,
      unit_cost: unitCost,
      note: normalizeText(rawLine?.note),
    });
  }

  const variantCount = await tx.book_variants.count({
    where: {
      id: { in: normalizedItems.map((item) => item.variant_id) },
      is_active: true,
      books: { is_active: true },
    },
  });
  if (variantCount !== normalizedItems.length) {
    return { invalid: true, message: "One or more variants are inactive or invalid" };
  }

  return {
    supplier_id: supplierId,
    warehouse_id: warehouseId,
    expected_date: expectedDate ? new Date(expectedDate) : null,
    note,
    items: normalizedItems,
  };
}

function getPurchaseOrderInclude() {
  return {
    suppliers: {
      select: { id: true, code: true, name: true, status: true },
    },
    warehouses: {
      select: { id: true, code: true, name: true, is_active: true },
    },
    purchase_order_items: {
      include: {
        book_variants: {
          select: {
            id: true,
            sku: true,
            isbn13: true,
            books: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { id: "asc" },
    },
    goods_receipts: {
      include: {
        goods_receipt_items: { select: { id: true, quantity: true } },
      },
      orderBy: { created_at: "desc" },
    },
  };
}

async function getPurchaseOrders(req, res) {
  const page = Math.max(1, Number.parseInt(String(req.query.page || "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize || "20"), 10) || 20));
  const status = normalizeText(req.query.status);
  const supplierId = parseId(req.query.supplier_id);
  const warehouseId = parseId(req.query.warehouse_id);
  const search = normalizeText(req.query.search);
  const view = String(req.query.view || "all").trim().toLowerCase();
  const userId = parseId(req.user?.id);

  const where = {};
  if (status && status.toUpperCase() !== "ALL") where.status = status.toUpperCase();
  if (supplierId) where.supplier_id = supplierId;
  if (warehouseId) where.warehouse_id = warehouseId;
  if (view === "my" && userId) where.ordered_by_user_id = userId;
  if (view === "approval") where.status = PO_STATUSES.PENDING_APPROVAL;
  if (search) {
    where.OR = [
      { po_number: { contains: search, mode: "insensitive" } },
      { suppliers: { name: { contains: search, mode: "insensitive" } } },
      { warehouses: { name: { contains: search, mode: "insensitive" } } },
      { warehouses: { code: { contains: search, mode: "insensitive" } } },
    ];
  }

  try {
    const [total, rows] = await Promise.all([
      prisma.purchase_orders.count({ where }),
      prisma.purchase_orders.findMany({
        where,
        include: getPurchaseOrderInclude(),
        orderBy: { created_at: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return res.json({
      data: rows.map(mapPurchaseOrderSummary),
      pagination: { page, pageSize, total },
    });
  } catch (error) {
    console.error("Error while listing purchase orders:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getPurchaseOrderById(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid purchase order id" });

  try {
    const po = await prisma.purchase_orders.findUnique({
      where: { id },
      include: getPurchaseOrderInclude(),
    });
    if (!po) return res.status(404).json({ message: "Purchase order not found" });
    return res.json(mapPurchaseOrderDetail(po));
  } catch (error) {
    console.error("Error while fetching purchase order:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function createPurchaseOrder(req, res) {
  const userId = parseId(req.user?.id);
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const payload = await normalizePurchaseOrderPayload(tx, req.body);
      if (payload.invalid) return payload;

      const po = await tx.purchase_orders.create({
        data: {
          po_number: createPoNumber(),
          supplier_id: payload.supplier_id,
          warehouse_id: payload.warehouse_id,
          status: PO_STATUSES.DRAFT,
          ordered_by_user_id: userId,
          expected_date: payload.expected_date,
          note: payload.note,
        },
      });

      await tx.purchase_order_items.createMany({
        data: payload.items.map((item) => ({
          purchase_order_id: po.id,
          ...item,
        })),
      });

      await audit(tx, userId, "PURCHASE_ORDER_CREATED", po.id, {
        po_number: po.po_number,
        status: po.status,
        line_count: payload.items.length,
        total_ordered_qty: payload.items.reduce((sum, item) => sum + item.ordered_qty, 0),
      });

      return { data: po };
    });

    if (result.invalid) return res.status(400).json({ message: result.message });
    return res.status(201).json({
      message: "Purchase order created successfully",
      data: {
        id: result.data.id,
        po_number: result.data.po_number,
        status: result.data.status,
      },
    });
  } catch (error) {
    console.error("Error while creating purchase order:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function updatePurchaseOrder(req, res) {
  const id = parseId(req.params.id);
  const userId = parseId(req.user?.id);
  if (!id) return res.status(400).json({ message: "Invalid purchase order id" });
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.purchase_orders.findUnique({
        where: { id },
        include: { purchase_order_items: true },
      });
      if (!existing) return { invalid: true, statusCode: 404, message: "Purchase order not found" };
      if (![PO_STATUSES.DRAFT, PO_STATUSES.REJECTED].includes(existing.status)) {
        return { invalid: true, message: "Only DRAFT or REJECTED purchase orders can be updated" };
      }
      const totalReceived = existing.purchase_order_items.reduce((sum, item) => sum + Number(item.received_qty || 0), 0);
      if (totalReceived > 0) {
        return { invalid: true, message: "Cannot update purchase order after receiving has started" };
      }

      const payload = await normalizePurchaseOrderPayload(tx, req.body);
      if (payload.invalid) return payload;

      const updated = await tx.purchase_orders.update({
        where: { id },
        data: {
          supplier_id: payload.supplier_id,
          warehouse_id: payload.warehouse_id,
          expected_date: payload.expected_date,
          note: payload.note,
          updated_at: new Date(),
        },
      });

      await tx.purchase_order_items.deleteMany({ where: { purchase_order_id: id } });
      await tx.purchase_order_items.createMany({
        data: payload.items.map((item) => ({
          purchase_order_id: id,
          ...item,
        })),
      });

      await audit(tx, userId, "PURCHASE_ORDER_UPDATED", id, {
        po_number: existing.po_number,
        status: updated.status,
        line_count: payload.items.length,
        total_ordered_qty: payload.items.reduce((sum, item) => sum + item.ordered_qty, 0),
      }, {
        status: existing.status,
        line_count: existing.purchase_order_items.length,
      });

      return { data: updated };
    });

    if (result.invalid) {
      return res.status(result.statusCode || 400).json({ message: result.message });
    }
    return res.json({
      message: "Purchase order updated successfully",
      data: { id: result.data.id, po_number: result.data.po_number, status: result.data.status },
    });
  } catch (error) {
    console.error("Error while updating purchase order:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function submitPurchaseOrder(req, res) {
  return transitionPurchaseOrder(req, res, {
    allowedFrom: [PO_STATUSES.DRAFT, PO_STATUSES.REJECTED],
    nextStatus: PO_STATUSES.PENDING_APPROVAL,
    actionName: "PURCHASE_ORDER_SUBMITTED",
    message: "Purchase order submitted for approval",
  });
}

async function approvePurchaseOrder(req, res) {
  return transitionPurchaseOrder(req, res, {
    allowedFrom: [PO_STATUSES.PENDING_APPROVAL],
    nextStatus: PO_STATUSES.APPROVED,
    actionName: "PURCHASE_ORDER_APPROVED",
    message: "Purchase order approved",
    approvedBy: true,
    notePrefix: "APPROVED_NOTE",
  });
}

async function rejectPurchaseOrder(req, res) {
  const reason = normalizeText(req.body?.reason);
  return transitionPurchaseOrder(req, res, {
    allowedFrom: [PO_STATUSES.PENDING_APPROVAL],
    nextStatus: PO_STATUSES.REJECTED,
    actionName: "PURCHASE_ORDER_REJECTED",
    message: "Purchase order rejected",
    notePrefix: "REJECTED_REASON",
    noteValue: reason || "Rejected by approver",
  });
}

async function transitionPurchaseOrder(req, res, options) {
  const id = parseId(req.params.id);
  const userId = parseId(req.user?.id);
  if (!id) return res.status(400).json({ message: "Invalid purchase order id" });
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.findUnique({
        where: { id },
        include: { purchase_order_items: true },
      });
      if (!po) return { invalid: true, statusCode: 404, message: "Purchase order not found" };
      if (!options.allowedFrom.includes(po.status)) {
        return {
          invalid: true,
          message: `Purchase order cannot transition from ${po.status} to ${options.nextStatus}`,
        };
      }
      if (po.purchase_order_items.length === 0) {
        return { invalid: true, message: "Purchase order must have at least one item" };
      }

      const noteValue = options.noteValue || normalizeText(req.body?.note);
      const nextNote = noteValue
        ? [po.note, `[${options.notePrefix || options.actionName}] ${noteValue}`].filter(Boolean).join("\n")
        : po.note;

      const updated = await tx.purchase_orders.update({
        where: { id },
        data: {
          status: options.nextStatus,
          note: nextNote,
          updated_at: new Date(),
          ...(options.approvedBy ? { approved_by_user_id: userId } : {}),
        },
      });

      await audit(tx, userId, options.actionName, id, {
        po_number: po.po_number,
        status_before: po.status,
        status_after: options.nextStatus,
        total_ordered_qty: po.purchase_order_items.reduce((sum, item) => sum + Number(item.ordered_qty || 0), 0),
      });

      return { data: updated };
    });

    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.json({
      message: options.message,
      data: { id: result.data.id, po_number: result.data.po_number, status: result.data.status },
    });
  } catch (error) {
    console.error(`Error while transitioning purchase order to ${options.nextStatus}:`, error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function cancelPurchaseOrder(req, res) {
  const id = parseId(req.params.id);
  const userId = parseId(req.user?.id);
  if (!id) return res.status(400).json({ message: "Invalid purchase order id" });
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.findUnique({
        where: { id },
        include: { purchase_order_items: true },
      });
      if (!po) return { invalid: true, statusCode: 404, message: "Purchase order not found" };
      if (![PO_STATUSES.DRAFT, PO_STATUSES.REJECTED, PO_STATUSES.PENDING_APPROVAL, PO_STATUSES.APPROVED].includes(po.status)) {
        return { invalid: true, message: "Purchase order cannot be cancelled in current status" };
      }
      const totalReceived = po.purchase_order_items.reduce((sum, item) => sum + Number(item.received_qty || 0), 0);
      if (totalReceived > 0) {
        return { invalid: true, message: "Cannot cancel purchase order after receiving has started" };
      }

      const updated = await tx.purchase_orders.update({
        where: { id },
        data: { status: PO_STATUSES.CANCELLED, updated_at: new Date() },
      });

      await audit(tx, userId, "PURCHASE_ORDER_CANCELLED", id, {
        po_number: po.po_number,
        status_before: po.status,
        status_after: PO_STATUSES.CANCELLED,
      });

      return { data: updated };
    });

    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.json({
      message: "Purchase order cancelled",
      data: { id: result.data.id, po_number: result.data.po_number, status: result.data.status },
    });
  } catch (error) {
    console.error("Error while cancelling purchase order:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getPurchaseOrderReconciliation(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid purchase order id" });

  try {
    const po = await prisma.purchase_orders.findUnique({
      where: { id },
      include: getPurchaseOrderInclude(),
    });
    if (!po) return res.status(404).json({ message: "Purchase order not found" });

    const items = (po.purchase_order_items || []).map((item) => {
      const mapped = mapPurchaseOrderItem(item);
      const varianceQty = mapped.received_qty - mapped.ordered_qty;
      const status = calculateLineStatus(mapped.ordered_qty, mapped.received_qty);
      return {
        variant_id: mapped.variant_id,
        title: mapped.title,
        isbn13: mapped.isbn13,
        ordered_qty: mapped.ordered_qty,
        received_qty: mapped.received_qty,
        remaining_qty: mapped.remaining_qty,
        variance_qty: varianceQty,
        status,
      };
    });

    const totalOrderedQty = items.reduce((sum, item) => sum + item.ordered_qty, 0);
    const totalReceivedQty = items.reduce((sum, item) => sum + item.received_qty, 0);
    return res.json({
      po_id: po.id,
      po_number: po.po_number,
      status: po.status,
      summary: {
        total_ordered_qty: totalOrderedQty,
        total_received_qty: totalReceivedQty,
        total_remaining_qty: Math.max(0, totalOrderedQty - totalReceivedQty),
        over_received_lines: items.filter((item) => item.status === "OVER_RECEIVED").length,
        under_received_lines: items.filter((item) => item.status === "UNDER_RECEIVED").length,
        matched_lines: items.filter((item) => item.status === "MATCHED").length,
        reconciliation_status: calculateReconciliationStatus(totalOrderedQty, totalReceivedQty),
      },
      items,
      goods_receipts: (po.goods_receipts || []).map(mapGoodsReceiptSummary),
    });
  } catch (error) {
    console.error("Error while reconciling purchase order:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function createGoodsReceiptFromPurchaseOrder(req, res) {
  const id = parseId(req.params.id);
  const userId = parseId(req.user?.id);
  const note = normalizeText(req.body?.note);
  const warehouseId = parseId(req.body?.warehouse_id);
  const allowOverReceive = req.body?.allow_over_receive === true;
  const lines = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!id) return res.status(400).json({ message: "Invalid purchase order id" });
  if (!userId) return res.status(401).json({ message: "Unauthorized" });
  if (lines.length === 0) return res.status(400).json({ message: "items is required" });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchase_orders.findUnique({
        where: { id },
        include: {
          purchase_order_items: {
            include: {
              book_variants: { select: { id: true, isbn13: true, sku: true } },
            },
          },
        },
      });
      if (!po) return { invalid: true, statusCode: 404, message: "Purchase order not found" };
      if (![PO_STATUSES.APPROVED, PO_STATUSES.PARTIALLY_RECEIVED].includes(po.status)) {
        return { invalid: true, message: "Only APPROVED or PARTIALLY_RECEIVED purchase orders can be received" };
      }
      if (warehouseId && warehouseId !== po.warehouse_id) {
        return { invalid: true, message: "warehouse_id must match purchase order warehouse" };
      }

      const poItemsById = new Map();
      const poItemsByVariant = new Map();
      po.purchase_order_items.forEach((item) => {
        poItemsById.set(String(item.id), item);
        poItemsByVariant.set(String(item.variant_id), item);
      });

      const receiptItems = [];
      const seen = new Set();
      for (const rawLine of lines) {
        const itemId = parseId(rawLine?.purchase_order_item_id);
        const variantId = parseId(rawLine?.variant_id);
        const quantity = toInt(rawLine?.quantity);
        const unitCost = Number(rawLine?.unit_cost);
        if (!quantity || quantity <= 0) {
          return { invalid: true, message: "Each receipt item must include quantity > 0" };
        }
        if (!Number.isFinite(unitCost) || unitCost < 0) {
          return { invalid: true, message: "Each receipt item must include unit_cost >= 0" };
        }

        const poItem = itemId ? poItemsById.get(itemId) : poItemsByVariant.get(String(variantId));
        if (!poItem) {
          return { invalid: true, message: "Receipt item variant does not belong to purchase order" };
        }
        if (variantId && variantId !== poItem.variant_id) {
          return { invalid: true, message: "purchase_order_item_id and variant_id do not match" };
        }
        if (seen.has(poItem.variant_id)) {
          return { invalid: true, message: "Duplicate variant in goods receipt items" };
        }
        seen.add(poItem.variant_id);

        const remainingQty = Number(poItem.ordered_qty || 0) - Number(poItem.received_qty || 0);
        if (!allowOverReceive && quantity > remainingQty) {
          return { invalid: true, message: `Cannot receive more than remaining quantity for ${poItem.book_variants?.isbn13 || poItem.book_variants?.sku || poItem.variant_id}` };
        }

        receiptItems.push({
          goods_receipt_id: null,
          variant_id: poItem.variant_id,
          location_id: parseId(rawLine?.location_id),
          quantity,
          unit_cost: unitCost,
          note: normalizeText(rawLine?.note),
        });
      }

      const locationIds = [...new Set(receiptItems.map((item) => item.location_id).filter(Boolean))];
      if (locationIds.length > 0) {
        const locationCount = await tx.locations.count({
          where: {
            id: { in: locationIds },
            warehouse_id: po.warehouse_id,
            is_active: true,
          },
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
          source_type: "PURCHASE_ORDER",
          source_reference_id: po.id,
          status: "DRAFT",
          received_by_user_id: userId,
          note,
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

      await audit(tx, userId, "PURCHASE_ORDER_GOODS_RECEIPT_CREATED", po.id, {
        po_number: po.po_number,
        goods_receipt_id: receipt.id,
        receipt_number: receipt.receipt_number,
        status: po.status,
        total_quantity: receiptItems.reduce((sum, item) => sum + item.quantity, 0),
      });

      return { data: receipt };
    });

    if (result.invalid) return res.status(result.statusCode || 400).json({ message: result.message });
    return res.status(201).json({
      message: "Goods receipt draft created from purchase order",
      data: {
        id: result.data.id,
        receipt_number: result.data.receipt_number,
        status: result.data.status,
        purchase_order_id: result.data.purchase_order_id,
      },
    });
  } catch (error) {
    console.error("Error while creating goods receipt from purchase order:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  getPurchaseOrders,
  getPurchaseOrderById,
  createPurchaseOrder,
  updatePurchaseOrder,
  submitPurchaseOrder,
  approvePurchaseOrder,
  rejectPurchaseOrder,
  cancelPurchaseOrder,
  getPurchaseOrderReconciliation,
  createGoodsReceiptFromPurchaseOrder,
};
