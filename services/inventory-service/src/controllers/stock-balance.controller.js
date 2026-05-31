const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 5);

/**
 * GET /api/stock-balances/low-stock
 * Returns book variants with per-warehouse stock data where available_qty is low.
 * Each item has variant_id, warehouse_id, and suggested supplier (from supplier_variants).
 */
async function getLowStockByWarehouse(req, res) {
  const threshold = Number(req.query.threshold || DEFAULT_LOW_STOCK_THRESHOLD);
  const warehouseId = req.query.warehouse_id || null;
  const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)));

  try {
    const where = {
      OR: [
        { available_qty: { lte: threshold } },
        {
          AND: [
            { reorder_point: { gt: 0 } },
            { available_qty: { lte: threshold * 2 } },
          ],
        },
      ],
    };

    if (warehouseId) {
      where.warehouse_id = warehouseId;
    }

    const balances = await prisma.stock_balances.findMany({
      where,
      include: {
        book_variants: {
          select: {
            id: true,
            sku: true,
            isbn13: true,
            isbn10: true,
            internal_barcode: true,
            books: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
        warehouses: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
      orderBy: [
        { available_qty: 'asc' },
        { warehouse_id: 'asc' },
      ],
      take: limit,
    });

    // Filter: only truly low stock
    const validBalances = balances.filter((balance) => {
      const availableQty = Number(balance.available_qty || 0);
      const reorderPoint = Number(balance.reorder_point || DEFAULT_LOW_STOCK_THRESHOLD);
      return availableQty <= Math.max(reorderPoint, threshold);
    });

    // Lookup suggested suppliers from supplier_variants for all variant_ids
    const variantIds = [...new Set(validBalances.map((b) => b.variant_id))];
    let supplierByVariant = new Map();

    if (variantIds.length > 0) {
      const supplierLinks = await prisma.supplier_variants.findMany({
        where: {
          variant_id: { in: variantIds },
          suppliers: { status: 'ACTIVE' },
        },
        include: {
          suppliers: { select: { id: true, name: true, code: true } },
        },
        orderBy: [
          { is_preferred: 'desc' },
          { lead_time_days: 'asc' },
        ],
      });

      // Map variant_id → best supplier (first match due to ordering)
      for (const link of supplierLinks) {
        if (!supplierByVariant.has(link.variant_id)) {
          supplierByVariant.set(link.variant_id, {
            suggested_supplier_id: link.suppliers.id,
            suggested_supplier_name: link.suppliers.name,
            suggested_supplier_code: link.suppliers.code || null,
            is_preferred: link.is_preferred,
          });
        }
      }
    }

    const data = validBalances.map((balance) => {
      const availableQty = Number(balance.available_qty || 0);
      const reorderPoint = Number(balance.reorder_point || DEFAULT_LOW_STOCK_THRESHOLD);
      const effectiveThreshold = reorderPoint > 0 ? reorderPoint : DEFAULT_LOW_STOCK_THRESHOLD;
      const suggestedQty = Math.max(1, effectiveThreshold * 2 - availableQty);
      const supplierSuggestion = supplierByVariant.get(balance.variant_id) || null;

      return {
        variant_id: balance.variant_id,
        book_id: balance.book_variants?.books?.id || null,
        title: balance.book_variants?.books?.title || 'Unknown',
        isbn: balance.book_variants?.isbn13 || balance.book_variants?.isbn10 || balance.book_variants?.internal_barcode || balance.book_variants?.sku || null,
        sku: balance.book_variants?.sku || null,
        warehouse_id: balance.warehouse_id,
        warehouse_code: balance.warehouses?.code || null,
        warehouse_name: balance.warehouses?.name || null,
        available_qty: availableQty,
        on_hand_qty: Number(balance.on_hand_qty || 0),
        reorder_point: reorderPoint,
        suggested_quantity: suggestedQty,
        priority: availableQty === 0 ? 'HIGH' : availableQty <= Math.floor(effectiveThreshold / 2) ? 'HIGH' : 'MEDIUM',
        reason: availableQty === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
        // Supplier suggestion from supplier_variants (null if no supplier linked)
        suggested_supplier_id: supplierSuggestion?.suggested_supplier_id || null,
        suggested_supplier_name: supplierSuggestion?.suggested_supplier_name || null,
        suggested_supplier_code: supplierSuggestion?.suggested_supplier_code || null,
      };
    });

    return res.json({
      data,
      total: data.length,
      threshold,
    });
  } catch (error) {
    console.error('[stock-balance] getLowStockByWarehouse error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = { getLowStockByWarehouse };
