const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, normalizeIsbn13 } = require("../utils/validation");
const { createMovementNumber } = require("../utils/inventory");
const { resolveOrCreateReceivingLocation } = require("../utils/locations");
const { pushToRooms } = require("../lib/socket-emitter");

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isValidNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0;
}

function createReceiptNumber(baseTimestamp) {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GR-${baseTimestamp}-${suffix}`;
}

function calculatePoStatus(totalOrderedQty, totalReceivedQty, hasOpenShortage = false) {
  if (totalReceivedQty <= 0) return "APPROVED";
  if (totalReceivedQty >= totalOrderedQty) return "RECEIVED";
  if (hasOpenShortage) return "SHORTAGE_REPORTED";
  return "PARTIALLY_RECEIVED";
}

function aggregateQuantitiesByVariant(items) {
  const map = new Map();
  items.forEach((item) => {
    const key = String(item.variant_id);
    map.set(key, Number(map.get(key) || 0) + Number(item.quantity || 0));
  });
  return map;
}

async function getPoTotals(tx, purchaseOrderId) {
  const items = await tx.purchase_order_items.findMany({
    where: { purchase_order_id: purchaseOrderId },
    select: { ordered_qty: true, received_qty: true },
  });
  return items.reduce(
    (acc, item) => {
      acc.total_ordered_qty += Number(item.ordered_qty || 0);
      acc.total_received_qty += Number(item.received_qty || 0);
      return acc;
    },
    { total_ordered_qty: 0, total_received_qty: 0 },
  );
}

async function updatePurchaseOrderStatusFromTotals(tx, purchaseOrderId) {
  const totals = await getPoTotals(tx, purchaseOrderId);
  const openShortageCount = await tx.supplier_shortage_reports.count({
    where: {
      purchase_order_id: purchaseOrderId,
      status: { in: ["OPEN", "SENT_TO_SUPPLIER", "ACKNOWLEDGED"] },
    },
  });
  const nextStatus = calculatePoStatus(
    totals.total_ordered_qty,
    totals.total_received_qty,
    openShortageCount > 0,
  );
  await tx.purchase_orders.update({
    where: { id: purchaseOrderId },
    data: { status: nextStatus, updated_at: new Date() },
  });
  return { ...totals, status: nextStatus };
}

async function applyPurchaseOrderReceipt(tx, goodsReceipt, userId) {
  if (!goodsReceipt.purchase_order_id) return;

  const receiptItems = await tx.goods_receipt_items.findMany({
    where: { goods_receipt_id: goodsReceipt.id },
    select: { variant_id: true, quantity: true },
  });
  const qtyByVariant = aggregateQuantitiesByVariant(receiptItems);
  const variantIds = Array.from(qtyByVariant.keys());

  const poItems = await tx.purchase_order_items.findMany({
    where: {
      purchase_order_id: goodsReceipt.purchase_order_id,
      variant_id: { in: variantIds },
    },
    select: { id: true, variant_id: true, ordered_qty: true, received_qty: true },
  });

  if (poItems.length !== variantIds.length) {
    throw new Error("PO_RECEIPT_VARIANT_MISMATCH");
  }

  for (const poItem of poItems) {
    const receiptQty = Number(qtyByVariant.get(String(poItem.variant_id)) || 0);
    const nextReceived = Number(poItem.received_qty || 0) + receiptQty;
    if (nextReceived > Number(poItem.ordered_qty || 0)) {
      throw new Error("PO_RECEIPT_OVER_RECEIVED");
    }
    await tx.purchase_order_items.update({
      where: { id: poItem.id },
      data: { received_qty: { increment: receiptQty } },
    });
  }

  const totals = await updatePurchaseOrderStatusFromTotals(
    tx,
    goodsReceipt.purchase_order_id,
  );

  if (goodsReceipt.supplier_delivery_invoice_id) {
    await tx.supplier_delivery_invoices.update({
      where: { id: goodsReceipt.supplier_delivery_invoice_id },
      data: {
        status: totals.status === "RECEIVED" ? "RECEIVED" : "PARTIALLY_RECEIVED",
        updated_at: new Date(),
      },
    });
  }

  await tx.inventory_audit_logs.create({
    data: {
      actor_user_id: userId,
      action_name: "PURCHASE_ORDER_RECEIVED_AGAINST_GR",
      entity_type: "PURCHASE_ORDER",
      entity_id: goodsReceipt.purchase_order_id,
      after_data: {
        goods_receipt_id: goodsReceipt.id,
        receipt_number: goodsReceipt.receipt_number,
        total_received_qty: totals.total_received_qty,
        total_ordered_qty: totals.total_ordered_qty,
        status: totals.status,
      },
    },
  });
}

async function reversePurchaseOrderReceipt(tx, goodsReceipt, userId) {
  if (!goodsReceipt.purchase_order_id) return;

  const receiptItems = await tx.goods_receipt_items.findMany({
    where: { goods_receipt_id: goodsReceipt.id },
    select: { variant_id: true, quantity: true },
  });
  const qtyByVariant = aggregateQuantitiesByVariant(receiptItems);
  const variantIds = Array.from(qtyByVariant.keys());

  const poItems = await tx.purchase_order_items.findMany({
    where: {
      purchase_order_id: goodsReceipt.purchase_order_id,
      variant_id: { in: variantIds },
    },
    select: { id: true, variant_id: true, received_qty: true },
  });

  for (const poItem of poItems) {
    const receiptQty = Number(qtyByVariant.get(String(poItem.variant_id)) || 0);
    const currentReceived = Number(poItem.received_qty || 0);
    await tx.purchase_order_items.update({
      where: { id: poItem.id },
      data: { received_qty: Math.max(0, currentReceived - receiptQty) },
    });
  }

  const totals = await updatePurchaseOrderStatusFromTotals(
    tx,
    goodsReceipt.purchase_order_id,
  );

  await tx.inventory_audit_logs.create({
    data: {
      actor_user_id: userId,
      action_name: "PURCHASE_ORDER_RECEIPT_CANCELLED",
      entity_type: "PURCHASE_ORDER",
      entity_id: goodsReceipt.purchase_order_id,
      after_data: {
        goods_receipt_id: goodsReceipt.id,
        receipt_number: goodsReceipt.receipt_number,
        total_received_qty: totals.total_received_qty,
        total_ordered_qty: totals.total_ordered_qty,
        status: totals.status,
      },
    },
  });
}

async function resolveVariantIdByIsbn13(tx, isbn13) {
  if (!isbn13) return null;

  const normalized = normalizeIsbn13(isbn13);
  if (!normalized || !/^\d{13}$/.test(normalized)) {
    return null;
  }

  const variant = await tx.book_variants.findFirst({
    where: { isbn13: normalized },
    select: { id: true },
  });

  return variant?.id || null;
}

function canViewAllReceivingTasks(user = {}) {
  if (user.is_superuser) return true;
  const roles = Array.isArray(user.roles)
    ? user.roles.map((role) => String(role).toUpperCase())
    : [];
  return roles.includes("ADMIN") || roles.includes("WAREHOUSE_MANAGER");
}

function canManageReceiving(user = {}) {
  return canViewAllReceivingTasks(user);
}

function canAccessAssignedReceiving(user = {}, receivedByUserId) {
  if (canManageReceiving(user)) return true;
  const currentUserId = parseId(user.id || user.sub);
  const assignedUserId = parseId(receivedByUserId);
  return Boolean(currentUserId && assignedUserId && currentUserId === assignedUserId);
}

async function getGoodsReceipts(req, res) {
  try {
    const receipts = await prisma.goods_receipts.findMany({
      where: canViewAllReceivingTasks(req.user || {})
        ? {}
        : { received_by_user_id: req.user?.id },
      orderBy: { created_at: "desc" },
      include: {
        warehouses: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        purchase_orders: {
          select: {
            id: true,
            po_number: true,
          },
        },
        goods_receipt_items: {
          select: {
            id: true,
            quantity: true,
            unit_cost: true,
          },
        },
      },
    });

    const data = receipts.map((receipt) => {
      const itemCount = receipt.goods_receipt_items.length;
      const totalAmount = receipt.goods_receipt_items.reduce((sum, item) => {
        return sum + Number(item.unit_cost) * item.quantity;
      }, 0);

      return {
        id: receipt.id,
        receipt_number: receipt.receipt_number,
        purchase_order_id: receipt.purchase_order_id,
        po_number: receipt.purchase_orders?.po_number || null,
        source_type: receipt.source_type,
        warehouse_id: receipt.warehouse_id,
        warehouse_name: receipt.warehouses?.name || null,
        warehouse_code: receipt.warehouses?.code || null,
        status: receipt.status,
        note: receipt.note,
        received_by_user_id: receipt.received_by_user_id,
        received_at: receipt.received_at,
        created_at: receipt.created_at,
        updated_at: receipt.updated_at,
        item_count: itemCount,
        total_amount: totalAmount,
      };
    });

    return res.json(data);
  } catch (error) {
    console.error("Error while fetching goods receipts:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getGoodsReceiptById(req, res) {
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({ message: "Invalid goods receipt id" });
  }

  try {
    const receipt = await prisma.goods_receipts.findUnique({
      where: { id },
      include: {
        warehouses: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        purchase_orders: {
          select: {
            id: true,
            po_number: true,
            status: true,
          },
        },
        goods_receipt_items: {
          include: {
            book_variants: {
              include: {
                books: {
                  select: {
                    id: true,
                    title: true,
                  },
                },
              },
            },
            locations: {
              select: {
                id: true,
                location_code: true,
                location_type: true,
              },
            },
          },
          orderBy: { id: "asc" },
        },
      },
    });

    if (!receipt) {
      return res.status(404).json({ message: "Goods receipt not found" });
    }

    if (!canViewAllReceivingTasks(req.user || {}) && receipt.received_by_user_id !== req.user?.id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const items = receipt.goods_receipt_items.map((item) => ({
      id: item.id,
      variant_id: item.variant_id,
      book_id: item.book_variants?.books?.id || null,
      book_title: item.book_variants?.books?.title || "Chưa có tên sách",
      sku: item.book_variants?.sku || null,
      barcode:
        item.book_variants?.internal_barcode ||
        item.book_variants?.isbn13 ||
        item.book_variants?.isbn10 ||
        null,
      location_id: item.location_id,
      location_code: item.locations?.location_code || null,
      location_type: item.locations?.location_type || null,
      quantity: item.quantity,
      actual_quantity: item.actual_quantity ?? null,
      unit_cost: Number(item.unit_cost),
      line_total: Number(item.unit_cost) * item.quantity,
    }));

    const totalAmount = items.reduce((sum, item) => sum + item.line_total, 0);

    // Embed supplier invoice data so assigned staff can see it without a separate permission check.
    let invoiceData = null;
    if (receipt.supplier_delivery_invoice_id) {
      const inv = await prisma.supplier_delivery_invoices.findUnique({
        where: { id: receipt.supplier_delivery_invoice_id },
        include: {
          supplier_delivery_invoice_items: {
            include: {
              book_variants: {
                select: {
                  isbn13: true,
                  sku: true,
                  internal_barcode: true,
                  books: { select: { title: true } },
                },
              },
            },
          },
          purchase_orders: {
            select: {
              po_number: true,
              suppliers: { select: { name: true } },
            },
          },
        },
      });
      if (inv) {
        invoiceData = {
          id: inv.id,
          invoice_number: inv.invoice_number,
          supplier_name: inv.purchase_orders?.suppliers?.name || null,
          po_number: inv.purchase_orders?.po_number || null,
          expected_delivery_date: inv.expected_delivery_date,
          items: inv.supplier_delivery_invoice_items.map((invItem) => ({
            id: invItem.id,
            variant_id: invItem.variant_id,
            title: invItem.book_variants?.books?.title || null,
            isbn13: invItem.book_variants?.isbn13 || null,
            sku: invItem.book_variants?.sku || null,
            barcode: invItem.book_variants?.internal_barcode || invItem.book_variants?.isbn13 || null,
            invoiced_qty: Number(invItem.invoiced_qty || 0),
          })),
        };
      }
    }

    return res.json({
      id: receipt.id,
      receipt_number: receipt.receipt_number,
      purchase_order_id: receipt.purchase_order_id,
      po_number: receipt.purchase_orders?.po_number || null,
      supplier_delivery_invoice_id: receipt.supplier_delivery_invoice_id || null,
      source_type: receipt.source_type,
      warehouse_id: receipt.warehouse_id,
      warehouse_name: receipt.warehouses?.name || null,
      warehouse_code: receipt.warehouses?.code || null,
      status: receipt.status,
      note: receipt.note,
      received_by_user_id: receipt.received_by_user_id,
      received_at: receipt.received_at,
      created_at: receipt.created_at,
      updated_at: receipt.updated_at,
      item_count: items.length,
      total_amount: totalAmount,
      items,
      invoice: invoiceData,
    });
  } catch (error) {
    console.error("Error while fetching goods receipt by id:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function createGoodsReceipt(req, res) {
  const { warehouse_id, note, items, purchase_order_id, supplier_delivery_invoice_id, invoice_number } = req.body;
  const userId = req.user?.id;
  const managerScope = canManageReceiving(req.user || {});

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!managerScope && (purchase_order_id || supplier_delivery_invoice_id || invoice_number)) {
    return res.status(403).json({
      message: "Warehouse staff can only create manual receiving draft receipts",
    });
  }

  if ((!warehouse_id && !purchase_order_id) || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      message: "warehouse_id (or purchase_order_id) and non-empty items are required",
    });
  }

  for (const item of items) {
    const variantId = parseId(item?.variant_id);
    const isbn13 = normalizeIsbn13(item?.isbn13);

    if ((!variantId && !isbn13) || !isPositiveInteger(item?.quantity)) {
      return res.status(400).json({
        message:
          "Each item must include isbn13 (or variant_id) and quantity > 0",
      });
    }

    if (isbn13 && !/^\d{13}$/.test(isbn13)) {
      return res.status(400).json({
        message: "isbn13 must contain exactly 13 digits",
      });
    }

    if (!managerScope && item?.unit_cost !== undefined && Number(item.unit_cost) < 0) {
      return res.status(400).json({
        message: "Each item must include unit_cost >= 0",
      });
    }

    if (managerScope && !isValidNumber(item?.unit_cost)) {
      return res.status(400).json({
        message: "Each item must include unit_cost >= 0",
      });
    }
  }

  try {
    const baseTimestamp = Date.now();

    const result = await prisma.$transaction(async (tx) => {
      let linkedPo = null;
      let supplierInvoice = null;
      let effectiveWarehouseId = warehouse_id;
      if (purchase_order_id) {
        if (!supplier_delivery_invoice_id && !invoice_number) {
          throw new Error("PURCHASE_ORDER_REQUIRES_SUPPLIER_INVOICE");
        }
        linkedPo = await tx.purchase_orders.findUnique({
          where: { id: purchase_order_id },
          include: {
            purchase_order_items: {
              select: {
                id: true,
                variant_id: true,
                ordered_qty: true,
                received_qty: true,
              },
            },
          },
        });
        if (!linkedPo) {
          throw new Error("PURCHASE_ORDER_NOT_FOUND");
        }
        if (!["SENT_TO_SUPPLIER", "SUPPLIER_CONFIRMED", "PARTIALLY_RECEIVED", "SHORTAGE_REPORTED"].includes(linkedPo.status)) {
          throw new Error("PURCHASE_ORDER_NOT_RECEIVABLE");
        }
        if (warehouse_id && warehouse_id !== linkedPo.warehouse_id) {
          throw new Error("PURCHASE_ORDER_WAREHOUSE_MISMATCH");
        }
        effectiveWarehouseId = linkedPo.warehouse_id;

        if (supplier_delivery_invoice_id) {
          supplierInvoice = await tx.supplier_delivery_invoices.findFirst({
            where: { id: supplier_delivery_invoice_id, purchase_order_id: linkedPo.id },
          });
        } else if (invoice_number) {
          supplierInvoice = await tx.supplier_delivery_invoices.findFirst({
            where: { purchase_order_id: linkedPo.id, invoice_number: String(invoice_number).trim() },
          });
        }
        if (!supplierInvoice) {
          throw new Error("SUPPLIER_INVOICE_NOT_FOUND");
        }
      }

      const warehouse = await tx.warehouses.findUnique({
        where: { id: effectiveWarehouseId },
      });
      if (!warehouse) {
        throw new Error("WAREHOUSE_NOT_FOUND");
      }

      const normalizedItems = [];
      for (const item of items) {
        const rawVariantId = parseId(item?.variant_id);
        const isbn13 = normalizeIsbn13(item?.isbn13);
        const resolvedVariantId =
          rawVariantId || (await resolveVariantIdByIsbn13(tx, isbn13));

        if (!resolvedVariantId) {
          throw new Error("INVALID_VARIANTS");
        }

        normalizedItems.push({
          ...item,
          variant_id: resolvedVariantId,
          isbn13: isbn13 || null,
          unit_cost: managerScope ? item.unit_cost : Number(item.unit_cost || 0),
        });
      }

      const variantIds = [
        ...new Set(normalizedItems.map((item) => item.variant_id)),
      ];

      // Normalize location ids: remove null/undefined values before querying
      const locationIds = [
        ...new Set(
          normalizedItems
            .map((item) => item.location_id)
            .filter((id) => id !== null && id !== undefined),
        ),
      ];

      const variants = await tx.book_variants.findMany({
        where: { id: { in: variantIds } },
        select: { id: true },
      });

      if (variants.length !== variantIds.length) {
        throw new Error("INVALID_VARIANTS");
      }

      if (locationIds.length > 0) {
        const locations = await tx.locations.findMany({
          where: {
            id: { in: locationIds },
            warehouse_id: effectiveWarehouseId,
          },
          select: { id: true },
        });

        if (locations.length !== locationIds.length) {
          throw new Error("INVALID_LOCATIONS");
        }
      }

      if (linkedPo) {
        const poItemsByVariant = new Map();
        linkedPo.purchase_order_items.forEach((item) => {
          poItemsByVariant.set(String(item.variant_id), item);
        });
        const qtyByVariant = aggregateQuantitiesByVariant(normalizedItems);
        for (const [variantId, quantity] of qtyByVariant.entries()) {
          const poItem = poItemsByVariant.get(variantId);
          if (!poItem) {
            throw new Error("PURCHASE_ORDER_ITEM_MISMATCH");
          }
          const remainingQty =
            Number(poItem.ordered_qty || 0) - Number(poItem.received_qty || 0);
          if (quantity > remainingQty) {
            throw new Error("PURCHASE_ORDER_OVER_RECEIVED");
          }
        }
      }

      const goodsReceipt = await tx.goods_receipts.create({
        data: {
          receipt_number: createReceiptNumber(baseTimestamp),
          warehouse_id: effectiveWarehouseId,
          purchase_order_id: linkedPo?.id || null,
          supplier_delivery_invoice_id: supplierInvoice?.id || null,
          source_type: linkedPo ? "SUPPLIER_INVOICE" : "MANUAL",
          source_reference_id: supplierInvoice?.id || null,
          status: "DRAFT",
          received_by_user_id: userId,
          note: note || (managerScope ? null : "Created by warehouse staff receiving scan"),
        },
      });

      const receiptItemsData = normalizedItems.map((item) => ({
        goods_receipt_id: goodsReceipt.id,
        variant_id: item.variant_id,
        location_id: item.location_id || null,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
      }));

      await tx.goods_receipt_items.createMany({
        data: receiptItemsData,
      });

      const hasNewBook = normalizedItems.some((item) =>
        Boolean(item.is_new_book),
      );

      if (!managerScope) {
        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: userId,
            action_name: "WAREHOUSE_STAFF_RECEIVING_DRAFT_CREATED",
            entity_type: "GOODS_RECEIPT",
            entity_id: goodsReceipt.id,
            after_data: {
              receipt_number: goodsReceipt.receipt_number,
              warehouse_id: effectiveWarehouseId,
              item_count: normalizedItems.length,
              requires_manager_approval: true,
            },
          },
        });
      }

      if (hasNewBook) {
        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: userId,
            action_name: "LIBRARIAN_REVIEW_REQUIRED_FOR_NEW_BOOKS",
            entity_type: "GOODS_RECEIPT",
            entity_id: goodsReceipt.id,
            after_data: {
              message:
                "Phieu nhap chua sach moi. Yeu cau Thu thu bo sung thong tin Tac gia, NXB, The loai.",
              receipt_number: goodsReceipt.receipt_number,
              required_fields: ["author", "publisher", "category"],
            },
          },
        });
      }

      return goodsReceipt;
    });

    setImmediate(() => void pushToRooms(['admin', 'warehouse_manager', 'warehouse_staff'], 'goods_receipt:created', {
      id: result.id,
      receipt_number: result.receipt_number,
      warehouse_id: result.warehouse_id,
      status: result.status,
    }));

    return res.status(201).json({
      message: "Goods receipt created successfully in DRAFT status",
      data: result,
    });
  } catch (error) {
    if (error.message === "WAREHOUSE_NOT_FOUND") {
      return res.status(404).json({ message: "Warehouse not found" });
    }
    if (error.message === "PURCHASE_ORDER_NOT_FOUND") {
      return res.status(404).json({ message: "Purchase order not found" });
    }
    if (error.message === "PURCHASE_ORDER_NOT_RECEIVABLE") {
      return res
        .status(400)
        .json({ message: "Purchase order must be sent to supplier or supplier-confirmed before receiving" });
    }
    if (error.message === "PURCHASE_ORDER_REQUIRES_SUPPLIER_INVOICE") {
      return res
        .status(400)
        .json({ message: "Create goods receipt from supplier invoice/delivery note instead of directly from purchase order" });
    }
    if (error.message === "SUPPLIER_INVOICE_NOT_FOUND") {
      return res.status(404).json({ message: "Supplier invoice/delivery note not found for purchase order" });
    }
    if (error.message === "PURCHASE_ORDER_WAREHOUSE_MISMATCH") {
      return res
        .status(400)
        .json({ message: "warehouse_id must match purchase order warehouse" });
    }
    if (error.message === "PURCHASE_ORDER_ITEM_MISMATCH") {
      return res
        .status(400)
        .json({ message: "One or more receipt variants do not belong to the purchase order" });
    }
    if (error.message === "PURCHASE_ORDER_OVER_RECEIVED") {
      return res
        .status(400)
        .json({ message: "Cannot receive more than remaining purchase order quantity" });
    }
    if (error.message === "INVALID_VARIANTS") {
      return res
        .status(400)
        .json({ message: "One or more variant_id values are invalid" });
    }
    if (error.message === "INVALID_LOCATIONS") {
      return res
        .status(400)
        .json({
          message:
            "One or more location_id values are invalid for this warehouse",
        });
    }
    console.error("Error while creating goods receipt:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function postDraftGoodsReceipt(tx, goodsReceipt, userId) {
  const items = await tx.goods_receipt_items.findMany({
    where: { goods_receipt_id: goodsReceipt.id },
    select: {
      variant_id: true,
      location_id: true,
      quantity: true,
      unit_cost: true,
    },
  });

  const itemsWithLocation = items.filter((item) => item.location_id);
  const itemsWithoutLocation = items.filter((item) => !item.location_id);

  if (itemsWithLocation.length > 0) {
    const locationIds = [
      ...new Set(itemsWithLocation.map((item) => item.location_id)),
    ];
    const validLocations = await tx.locations.findMany({
      where: {
        id: { in: locationIds },
        warehouse_id: goodsReceipt.warehouse_id,
      },
      select: { id: true },
    });

    if (validLocations.length !== locationIds.length) {
      throw new Error("INVALID_LOCATIONS_FOR_RECEIPT");
    }

    const baseTimestamp = Date.now();

    await Promise.all(
      itemsWithLocation.map((item) =>
        tx.stock_balances.upsert({
          where: {
            variant_id_location_id: {
              variant_id: item.variant_id,
              location_id: item.location_id,
            },
          },
          update: {
            on_hand_qty: { increment: item.quantity },
            available_qty: { increment: item.quantity },
            version: { increment: 1 },
            last_movement_at: new Date(),
          },
          create: {
            warehouse_id: goodsReceipt.warehouse_id,
            variant_id: item.variant_id,
            location_id: item.location_id,
            on_hand_qty: item.quantity,
            available_qty: item.quantity,
            version: 1,
            last_movement_at: new Date(),
          },
        }),
      ),
    );

    await tx.stock_movements.createMany({
      data: itemsWithLocation.map((item, index) => ({
        movement_number: createMovementNumber(baseTimestamp, index),
        movement_type: "INBOUND",
        movement_status: "POSTED",
        warehouse_id: goodsReceipt.warehouse_id,
        variant_id: item.variant_id,
        to_location_id: item.location_id,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        source_service: "INVENTORY_SERVICE",
        reference_type: "GOODS_RECEIPT",
        reference_id: goodsReceipt.id,
        created_by_user_id: userId,
      })),
    });
  }

  if (itemsWithoutLocation.length > 0) {
    const receivingLocation = await resolveOrCreateReceivingLocation(
      tx,
      goodsReceipt.warehouse_id,
    );

    const aggregateMap = new Map();
    itemsWithoutLocation.forEach((item) => {
      const key = String(item.variant_id);
      const current = aggregateMap.get(key);
      if (!current) {
        aggregateMap.set(key, {
          variant_id: item.variant_id,
          quantity: Number(item.quantity || 0),
          unit_cost: item.unit_cost,
        });
        return;
      }
      current.quantity += Number(item.quantity || 0);
    });

    const aggregatedItems = Array.from(aggregateMap.values());

    for (const item of aggregatedItems) {
      await tx.stock_balances.upsert({
        where: {
          variant_id_location_id: {
            variant_id: item.variant_id,
            location_id: receivingLocation.id,
          },
        },
        update: {
          on_hand_qty: { increment: item.quantity },
          available_qty: 0,
          version: { increment: 1 },
          last_movement_at: new Date(),
        },
        create: {
          warehouse_id: goodsReceipt.warehouse_id,
          variant_id: item.variant_id,
          location_id: receivingLocation.id,
          on_hand_qty: item.quantity,
          available_qty: 0,
          version: 1,
          last_movement_at: new Date(),
        },
      });
    }

    const baseTimestamp = Date.now();
    await tx.stock_movements.createMany({
      data: aggregatedItems.map((item, index) => ({
        movement_number: createMovementNumber(
          baseTimestamp,
          index + itemsWithLocation.length,
        ),
        movement_type: "INBOUND",
        movement_status: "POSTED",
        warehouse_id: goodsReceipt.warehouse_id,
        variant_id: item.variant_id,
        to_location_id: receivingLocation.id,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        source_service: "INVENTORY_SERVICE",
        reference_type: "GOODS_RECEIPT",
        reference_id: goodsReceipt.id,
        created_by_user_id: userId,
        metadata: {
          source_type: "GOODS_RECEIPT_NO_LOCATION",
          bucket: "RECEIVING_HOLD",
        },
      })),
    });
  }
}

async function postTransferReceiptToReceiving(tx, goodsReceipt, userId) {
  const existingMovementCount = await tx.stock_movements.count({
    where: {
      reference_type: "GOODS_RECEIPT",
      reference_id: goodsReceipt.id,
      reverted: false,
    },
  });

  if (existingMovementCount > 0) {
    return;
  }

  const receivingLocation = await resolveOrCreateReceivingLocation(
    tx,
    goodsReceipt.warehouse_id,
  );

  const items = await tx.goods_receipt_items.findMany({
    where: { goods_receipt_id: goodsReceipt.id },
    select: {
      variant_id: true,
      quantity: true,
      unit_cost: true,
    },
  });

  if (items.length === 0) {
    return;
  }

  const aggregateMap = new Map();
  items.forEach((item) => {
    const key = String(item.variant_id);
    const current = aggregateMap.get(key);
    if (!current) {
      aggregateMap.set(key, {
        variant_id: item.variant_id,
        quantity: Number(item.quantity || 0),
      });
      return;
    }
    current.quantity += Number(item.quantity || 0);
  });

  const aggregatedItems = Array.from(aggregateMap.values());

  for (const item of aggregatedItems) {
    await tx.stock_balances.upsert({
      where: {
        variant_id_location_id: {
          variant_id: item.variant_id,
          location_id: receivingLocation.id,
        },
      },
      update: {
        on_hand_qty: { increment: item.quantity },
        available_qty: 0,
        version: { increment: 1 },
        last_movement_at: new Date(),
      },
      create: {
        warehouse_id: goodsReceipt.warehouse_id,
        variant_id: item.variant_id,
        location_id: receivingLocation.id,
        on_hand_qty: item.quantity,
        available_qty: 0,
        version: 1,
        last_movement_at: new Date(),
      },
    });
  }

  const baseTimestamp = Date.now();
  await tx.stock_movements.createMany({
    data: items.map((item, index) => ({
      movement_number: createMovementNumber(baseTimestamp, index),
      movement_type: "INBOUND",
      movement_status: "POSTED",
      warehouse_id: goodsReceipt.warehouse_id,
      variant_id: item.variant_id,
      to_location_id: receivingLocation.id,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      source_service: "INVENTORY_SERVICE",
      reference_type: "GOODS_RECEIPT",
      reference_id: goodsReceipt.id,
      created_by_user_id: userId,
      metadata: {
        source_type: "TRANSFER",
        bucket: "RECEIVING_HOLD",
      },
    })),
  });
}

async function cancelStockMovements(tx, goodsReceiptId) {
  const movements = await tx.stock_movements.findMany({
    where: {
      reference_type: "GOODS_RECEIPT",
      reference_id: goodsReceiptId,
      reverted: false,
    },
    select: {
      id: true,
      variant_id: true,
      to_location_id: true,
      from_location_id: true,
      quantity: true,
      movement_type: true,
      metadata: true,
    },
  });

  if (movements.length === 0) return;

  for (const movement of movements) {
    const meta =
      movement.metadata && typeof movement.metadata === "object"
        ? movement.metadata
        : null;
    const bucket =
      meta && meta.movement_bucket ? String(meta.movement_bucket) : null;
    // available_qty was incremented only for PUTAWAY bucket and for items with location in postDraftGoodsReceipt
    const hasAvailableQty =
      bucket === "PUTAWAY" ||
      (bucket === null && movement.to_location_id !== null);

    if (movement.movement_type === "INBOUND" && movement.to_location_id) {
      const currentBalance = await tx.stock_balances.findUnique({
        where: {
          variant_id_location_id: {
            variant_id: movement.variant_id,
            location_id: movement.to_location_id,
          },
        },
        select: { available_qty: true },
      });

      const currentAvail = Number(currentBalance?.available_qty || 0);
      // If stock was already picked (available_qty would go negative), only restore on_hand.
      const canRestoreAvailable = currentAvail >= movement.quantity;

      await tx.stock_balances.update({
        where: {
          variant_id_location_id: {
            variant_id: movement.variant_id,
            location_id: movement.to_location_id,
          },
        },
        data: {
          on_hand_qty: { decrement: movement.quantity },
          ...(canRestoreAvailable && hasAvailableQty
            ? { available_qty: { decrement: movement.quantity } }
            : {}),
          version: { increment: 1 },
          last_movement_at: new Date(),
        },
      });
    } else if (
      movement.movement_type === "OUTBOUND" &&
      movement.from_location_id
    ) {
      await tx.stock_balances.update({
        where: {
          variant_id_location_id: {
            variant_id: movement.variant_id,
            location_id: movement.from_location_id,
          },
        },
        data: {
          on_hand_qty: { increment: movement.quantity },
          ...(hasAvailableQty
            ? { available_qty: { increment: movement.quantity } }
            : {}),
          version: { increment: 1 },
          last_movement_at: new Date(),
        },
      });
    }

    await tx.stock_movements.update({
      where: { id: movement.id },
      data: { reverted: true },
    });
  }
}
async function updateGoodsReceipt(req, res) {
  const id = parseId(req.params.id);
  const { status, note } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!id) {
    return res.status(400).json({ message: "Invalid goods receipt id" });
  }

  if (status && !["DRAFT", "POSTED", "CANCELLED"].includes(status)) {
    return res.status(400).json({ message: "Invalid status value" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.goods_receipts.findUnique({ where: { id } });

      if (!existing) {
        return { notFound: true };
      }

      const targetStatus = status || existing.status;

      if (!canAccessAssignedReceiving(req.user || {}, existing.received_by_user_id)) {
        return {
          forbidden: true,
          message: "Goods receipt must be assigned to current warehouse staff",
        };
      }

      if (!canManageReceiving(req.user || {}) && targetStatus === "CANCELLED") {
        return {
          forbidden: true,
          message: "Warehouse staff cannot cancel goods receipts",
        };
      }

      if (!canManageReceiving(req.user || {}) && targetStatus === "POSTED") {
        return {
          forbidden: true,
          message: "Warehouse staff can create receiving drafts, but manager approval is required before stock is posted",
        };
      }

      if (existing.status === "CANCELLED" && targetStatus !== "CANCELLED") {
        return {
          invalidTransition: true,
          message: "Cannot change status from CANCELLED",
        };
      }

      if (existing.status === "POSTED" && targetStatus === "DRAFT") {
        return {
          invalidTransition: true,
          message: "Cannot rollback POSTED receipt to DRAFT",
        };
      }

      // Allow assigned staff to verify item quantities on DRAFT receipts.
      // Saves to actual_quantity (không ghi đè quantity gốc từ PO/hóa đơn).
      const itemUpdates = req.body.items;
      if (Array.isArray(itemUpdates) && existing.status === "DRAFT") {
        for (const item of itemUpdates) {
          if (item.id && typeof item.actual_quantity === "number" && item.actual_quantity >= 0) {
            await tx.goods_receipt_items.updateMany({
              where: { id: item.id, goods_receipt_id: id },
              data: { actual_quantity: item.actual_quantity },
            });
          } else if (item.id && typeof item.quantity === "number" && item.quantity >= 0 && !('actual_quantity' in item)) {
            // Backwards compat: nếu chỉ có quantity thì vẫn lưu vào quantity
            await tx.goods_receipt_items.updateMany({
              where: { id: item.id, goods_receipt_id: id },
              data: { quantity: item.quantity },
            });
          }
        }
      }

      const updated = await tx.goods_receipts.update({
        where: { id },
        data: {
          ...(status ? { status: targetStatus } : {}),
          ...(note !== undefined ? { note } : {}),
          ...(targetStatus === "POSTED" && !existing.received_at
            ? { received_at: new Date() }
            : {}),
          ...(targetStatus === "CANCELLED" && !existing.cancelled_at
            ? { cancelled_at: new Date(), cancelled_by_user_id: userId }
            : {}),
        },
      });

      if (targetStatus === "POSTED" && existing.status !== "POSTED") {
        if (existing.source_type === "TRANSFER") {
          await postTransferReceiptToReceiving(tx, updated, userId);
        } else {
          await applyPurchaseOrderReceipt(tx, updated, userId);
          await postDraftGoodsReceipt(tx, updated, userId);
        }

        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: userId,
            action_name: "GOODS_RECEIPT_POSTED",
            entity_type: "GOODS_RECEIPT",
            entity_id: updated.id,
            after_data: {
              receipt_number: updated.receipt_number,
              purchase_order_id: updated.purchase_order_id,
              supplier_delivery_invoice_id: updated.supplier_delivery_invoice_id,
              source_type: updated.source_type,
            },
          },
        });
      }

      if (targetStatus === "CANCELLED" && existing.status === "POSTED") {
        await cancelStockMovements(tx, id);
        await reversePurchaseOrderReceipt(tx, updated, userId);
      }

      return { data: updated };
    });

    if (result.notFound) {
      return res.status(404).json({ message: "Goods receipt not found" });
    }

    if (result.forbidden) {
      return res.status(403).json({ message: result.message || "Forbidden" });
    }

    if (result.invalidTransition) {
      return res.status(400).json({ message: result.message });
    }

    return res.json({
      message: "Goods receipt updated successfully",
      data: result.data,
    });
  } catch (error) {
    console.error("Error while updating goods receipt:", error);
    if (error.message === "INVALID_LOCATIONS_FOR_RECEIPT") {
      return res
        .status(400)
        .json({
          message: "Receipt contains locations outside the selected warehouse",
        });
    }
    if (error.message === "PO_RECEIPT_VARIANT_MISMATCH") {
      return res
        .status(400)
        .json({ message: "Receipt contains variants outside the linked purchase order" });
    }
    if (error.message === "PO_RECEIPT_OVER_RECEIVED") {
      return res
        .status(400)
        .json({ message: "Cannot post receipt because it exceeds remaining purchase order quantity" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function assignGoodsReceipt(req, res) {
  const id = parseId(req.params.id);
  const receivedByUserId = parseId(req.body?.received_by_user_id || req.body?.user_id);

  if (!id || !receivedByUserId) {
    return res.status(400).json({
      message: "goods receipt id and received_by_user_id are required",
    });
  }

  try {
    const updated = await prisma.goods_receipts.update({
      where: { id },
      data: {
        received_by_user_id: receivedByUserId,
        updated_at: new Date(),
      },
    });

    await prisma.inventory_audit_logs.create({
      data: {
        actor_user_id: req.user?.id || req.user?.sub || null,
        action_name: "GOODS_RECEIPT_ASSIGNED",
        entity_type: "GOODS_RECEIPT",
        entity_id: updated.id,
        after_data: {
          receipt_number: updated.receipt_number,
          received_by_user_id: receivedByUserId,
        },
      },
    });

    return res.json({
      message: "Goods receipt assigned successfully",
      data: updated,
    });
  } catch (error) {
    if (error?.code === "P2025") {
      return res.status(404).json({ message: "Goods receipt not found" });
    }
    console.error("Error while assigning goods receipt:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function getMyDraftReceiptsForVerification(req, res) {
  const userId = req.user?.id || req.user?.sub;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const receipts = await prisma.goods_receipts.findMany({
      where: {
        status: 'DRAFT',
        received_by_user_id: userId,
      },
      orderBy: { created_at: 'desc' },
      include: {
        warehouses: { select: { id: true, name: true, code: true } },
        goods_receipt_items: { select: { id: true, quantity: true, actual_quantity: true } },
      },
    });

    const data = receipts.map((r) => {
      const items = r.goods_receipt_items;
      const totalPlanned = items.reduce((sum, i) => sum + i.quantity, 0);
      const totalActual = items.filter((i) => i.actual_quantity !== null).reduce((sum, i) => sum + (i.actual_quantity || 0), 0);
      const isVerified = items.length > 0 && items.every((i) => i.actual_quantity !== null);
      return {
        id: r.id,
        receipt_number: r.receipt_number,
        status: r.status,
        warehouse_code: r.warehouses?.code || null,
        warehouse_name: r.warehouses?.name || null,
        item_count: items.length,
        total_planned_quantity: totalPlanned,
        total_actual_quantity: isVerified ? totalActual : null,
        is_verified: isVerified,
        created_at: r.created_at,
      };
    });

    return res.json({ data });
  } catch (error) {
    console.error('Error loading draft receipts for verification:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getGoodsReceipts,
  getGoodsReceiptById,
  createGoodsReceipt,
  updateGoodsReceipt,
  assignGoodsReceipt,
  getMyDraftReceiptsForVerification,
};
