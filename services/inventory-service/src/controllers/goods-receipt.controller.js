const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

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

function createMovementNumber(baseTimestamp, index) {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MV-${baseTimestamp}-${index + 1}-${suffix}`;
}

function parseId(value) {
  return String(value || '').trim() || null;
}

async function getGoodsReceipts(req, res) {
  try {
    const receipts = await prisma.goods_receipts.findMany({
      orderBy: { created_at: 'desc' },
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
    console.error('Error while fetching goods receipts:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getGoodsReceiptById(req, res) {
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({ message: 'Invalid goods receipt id' });
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
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!receipt) {
      return res.status(404).json({ message: 'Goods receipt not found' });
    }

    const items = receipt.goods_receipt_items.map((item) => ({
      id: item.id,
      variant_id: item.variant_id,
      book_id: item.book_variants?.books?.id || null,
      book_title: item.book_variants?.books?.title || 'Chưa có tên sách',
      sku: item.book_variants?.sku || null,
      barcode: item.book_variants?.internal_barcode || item.book_variants?.isbn13 || item.book_variants?.isbn10 || null,
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
    console.error('Error while fetching goods receipt by id:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function createGoodsReceipt(req, res) {
  const { warehouse_id, note, items } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!warehouse_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      message: 'warehouse_id and non-empty items are required',
    });
  }

  for (const item of items) {
    if (!item?.variant_id || !isPositiveInteger(item?.quantity)) {
      return res.status(400).json({
        message: 'Each item must include variant_id and quantity > 0',
      });
    }

    if (!isValidNumber(item?.unit_cost)) {
      return res.status(400).json({
        message: 'Each item must include unit_cost >= 0',
      });
    }
  }

  try {
    const baseTimestamp = Date.now();

    const result = await prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouses.findUnique({ where: { id: warehouse_id } });
      if (!warehouse) {
        throw new Error('WAREHOUSE_NOT_FOUND');
      }

      const variantIds = [...new Set(items.map((item) => item.variant_id))];

      // Normalize location ids: remove null/undefined values before querying
      const locationIds = [...new Set(items.map((item) => item.location_id).filter((id) => id !== null && id !== undefined))];

      const variants = await tx.book_variants.findMany({
        where: { id: { in: variantIds } },
        select: { id: true },
      });

      if (variants.length !== variantIds.length) {
        throw new Error('INVALID_VARIANTS');
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
          throw new Error('INVALID_LOCATIONS');
        }
      }

      const goodsReceipt = await tx.goods_receipts.create({
        data: {
          receipt_number: createReceiptNumber(baseTimestamp),
          warehouse_id,
          status: 'DRAFT',
          received_by_user_id: userId,
          note: note || null,
        },
      });

      const receiptItemsData = items.map((item) => ({
        goods_receipt_id: goodsReceipt.id,
        variant_id: item.variant_id,
        location_id: item.location_id || null,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
      }));

      await tx.goods_receipt_items.createMany({
        data: receiptItemsData,
      });

      const hasNewBook = items.some((item) => Boolean(item.is_new_book));

      if (hasNewBook) {
        await tx.inventory_audit_logs.create({
          data: {
            actor_user_id: userId,
            action_name: 'LIBRARIAN_REVIEW_REQUIRED_FOR_NEW_BOOKS',
            entity_type: 'GOODS_RECEIPT',
            entity_id: goodsReceipt.id,
            after_data: {
              message: 'Phieu nhap chua sach moi. Yeu cau Thu thu bo sung thong tin Tac gia, NXB, The loai.',
              receipt_number: goodsReceipt.receipt_number,
              required_fields: ['author', 'publisher', 'category'],
            },
          },
        });
      }

      return goodsReceipt;
    });

    return res.status(201).json({
      message: 'Goods receipt created successfully in DRAFT status',
      data: result,
    });
  } catch (error) {
    if (error.message === 'WAREHOUSE_NOT_FOUND') {
      return res.status(404).json({ message: 'Warehouse not found' });
    }
    if (error.message === 'INVALID_VARIANTS') {
      return res.status(400).json({ message: 'One or more variant_id values are invalid' });
    }
    if (error.message === 'INVALID_LOCATIONS') {
      return res.status(400).json({ message: 'One or more location_id values are invalid for this warehouse' });
    }
    console.error('Error while creating goods receipt:', error);
    return res.status(500).json({ message: 'Internal server error' });
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

  const locationIds = [...new Set(items.map((item) => item.location_id).filter(Boolean))];
  if (locationIds.length) {
    const validLocations = await tx.locations.findMany({
      where: {
        id: { in: locationIds },
        warehouse_id: goodsReceipt.warehouse_id,
      },
      select: { id: true },
    });

    if (validLocations.length !== locationIds.length) {
      throw new Error('INVALID_LOCATIONS_FOR_RECEIPT');
    }
  }

  const baseTimestamp = Date.now();

  await Promise.all(
    items
      .filter((item) => item.location_id)
      .map((item) =>
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
          },
          create: {
            warehouse_id: goodsReceipt.warehouse_id,
            variant_id: item.variant_id,
            location_id: item.location_id,
            on_hand_qty: item.quantity,
            available_qty: item.quantity,
          },
        })
      )
  );

  await tx.stock_movements.createMany({
    data: items.map((item, index) => ({
      movement_number: createMovementNumber(baseTimestamp, index),
      movement_type: 'INBOUND',
      movement_status: 'POSTED',
      warehouse_id: goodsReceipt.warehouse_id,
      variant_id: item.variant_id,
      to_location_id: item.location_id,
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      source_service: 'INVENTORY_SERVICE',
      reference_type: 'GOODS_RECEIPT',
      reference_id: goodsReceipt.id,
      created_by_user_id: userId,
    })),
  });
}
async function updateGoodsReceipt(req, res) {
  const id = parseId(req.params.id);
  const { status, note } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (!id) {
    return res.status(400).json({ message: 'Invalid goods receipt id' });
  }

  if (status && !['DRAFT', 'POSTED', 'CANCELLED'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status value' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.goods_receipts.findUnique({ where: { id } });

      if (!existing) {
        return { notFound: true };
      }

      const targetStatus = status || existing.status;

      if (existing.status === 'CANCELLED' && targetStatus !== 'CANCELLED') {
        return { invalidTransition: true, message: 'Cannot change status from CANCELLED' };
      }

      if (existing.status === 'POSTED' && targetStatus === 'DRAFT') {
        return { invalidTransition: true, message: 'Cannot rollback POSTED receipt to DRAFT' };
      }

      const updated = await tx.goods_receipts.update({
        where: { id },
        data: {
          ...(status ? { status: targetStatus } : {}),
          ...(note !== undefined ? { note } : {}),
          ...(targetStatus === 'POSTED' && !existing.received_at ? { received_at: new Date() } : {}),
        },
      });

      return { data: updated };
    });

    if (result.notFound) {
      return res.status(404).json({ message: 'Goods receipt not found' });
    }

    if (result.invalidTransition) {
      return res.status(400).json({ message: result.message });
    }

    return res.json({
      message: 'Goods receipt updated successfully',
      data: result.data,
    });
  } catch (error) {
    console.error('Error while updating goods receipt:', error);
    if (error.message === 'INVALID_LOCATIONS_FOR_RECEIPT') {
      return res.status(400).json({ message: 'Receipt contains locations outside the selected warehouse' });
    }
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = {
  getGoodsReceipts,
  getGoodsReceiptById,
  createGoodsReceipt,
  updateGoodsReceipt,
};
