const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const { parseId, normalizeIsbn13 } = require("../utils/validation");
const { createMovementNumber } = require("../utils/inventory");
const { resolveOrCreateReceivingLocation } = require("../utils/locations");

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

async function getGoodsReceipts(req, res) {
  try {
    const receipts = await prisma.goods_receipts.findMany({
      orderBy: { created_at: "desc" },
      include: {
        warehouses: {
          select: {
            id: true,
            name: true,
            code: true,
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
      unit_cost: Number(item.unit_cost),
      line_total: Number(item.unit_cost) * item.quantity,
    }));

    const totalAmount = items.reduce((sum, item) => sum + item.line_total, 0);

    return res.json({
      id: receipt.id,
      receipt_number: receipt.receipt_number,
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
    });
  } catch (error) {
    console.error("Error while fetching goods receipt by id:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}

async function createGoodsReceipt(req, res) {
  const { warehouse_id, note, items } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (!warehouse_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      message: "warehouse_id and non-empty items are required",
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

    if (!isValidNumber(item?.unit_cost)) {
      return res.status(400).json({
        message: "Each item must include unit_cost >= 0",
      });
    }
  }

  try {
    const baseTimestamp = Date.now();

    const result = await prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouses.findUnique({
        where: { id: warehouse_id },
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
            warehouse_id,
          },
          select: { id: true },
        });

        if (locations.length !== locationIds.length) {
          throw new Error("INVALID_LOCATIONS");
        }
      }

      const goodsReceipt = await tx.goods_receipts.create({
        data: {
          receipt_number: createReceiptNumber(baseTimestamp),
          warehouse_id,
          status: "DRAFT",
          received_by_user_id: userId,
          note: note || null,
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

    return res.status(201).json({
      message: "Goods receipt created successfully in DRAFT status",
      data: result,
    });
  } catch (error) {
    if (error.message === "WAREHOUSE_NOT_FOUND") {
      return res.status(404).json({ message: "Warehouse not found" });
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
          await postDraftGoodsReceipt(tx, updated, userId);
        }
      }

      if (targetStatus === "CANCELLED" && existing.status === "POSTED") {
        await cancelStockMovements(tx, id);
      }

      return { data: updated };
    });

    if (result.notFound) {
      return res.status(404).json({ message: "Goods receipt not found" });
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
    return res.status(500).json({ message: "Internal server error" });
  }
}

module.exports = {
  getGoodsReceipts,
  getGoodsReceiptById,
  createGoodsReceipt,
  updateGoodsReceipt,
};
