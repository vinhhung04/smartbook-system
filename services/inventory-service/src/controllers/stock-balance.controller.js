const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 5);

/**
 * GET /api/stock-balances/low-stock
 *
 * Returns one aggregated row per (warehouse, variant) where the TOTAL available_qty
 * across all locations is below the low-stock threshold.
 *
 * Previous implementation queried individual location rows and deduped by min(available_qty),
 * which caused false positives: a variant with RECEIVING(0) + shelf(5) was reported as "còn 0"
 * even though total available was 5. This version fixes that by aggregating at the DB level.
 */
async function getLowStockByWarehouse(req, res) {
  const threshold = Number(req.query.threshold || DEFAULT_LOW_STOCK_THRESHOLD);
  const warehouseId = req.query.warehouse_id || null;
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));

  try {
    // Aggregate available_qty and on_hand_qty across all locations for the same
    // (warehouse_id, variant_id) pair, then filter by the aggregated total.
    const warehouseFilter = warehouseId
      ? Prisma.sql`AND sb.warehouse_id = ${warehouseId}`
      : Prisma.empty;

    const rows = await prisma.$queryRaw`
      SELECT
        sb.warehouse_id,
        sb.variant_id,
        -- on_hand_qty = total physical stock (shelf + receiving + in-transit).
        -- This is the "tồn kho" figure users see in the Inventory page.
        CAST(COALESCE(SUM(sb.on_hand_qty),   0) AS INTEGER) AS available_qty,
        -- shelf_qty = truly available (not borrowed/reserved/receiving).
        CAST(COALESCE(SUM(sb.available_qty), 0) AS INTEGER) AS shelf_qty,
        CAST(MAX(sb.reorder_point)           AS INTEGER)    AS reorder_point,
        w.id       AS warehouse_db_id,
        w.code     AS warehouse_code,
        w.name     AS warehouse_name,
        w.province AS warehouse_province,
        w.district AS warehouse_district,
        bv.isbn13,
        bv.isbn10,
        bv.internal_barcode,
        bv.sku,
        b.id    AS book_id,
        b.title AS book_title
      FROM   stock_balances sb
      INNER JOIN warehouses    w  ON w.id  = sb.warehouse_id
      INNER JOIN book_variants bv ON bv.id = sb.variant_id
      INNER JOIN books         b  ON b.id  = bv.book_id
      WHERE  w.is_active = true
      ${warehouseFilter}
      GROUP BY
        sb.warehouse_id, sb.variant_id,
        w.id, w.code, w.name, w.province, w.district,
        bv.isbn13, bv.isbn10, bv.internal_barcode, bv.sku,
        b.id, b.title
      HAVING
        -- Low-stock detection uses on_hand_qty (total physical) so receiving stock is counted.
        COALESCE(SUM(sb.on_hand_qty), 0) <= ${threshold}
        OR (
          MAX(sb.reorder_point) > 0
          AND COALESCE(SUM(sb.on_hand_qty), 0) <= GREATEST(MAX(sb.reorder_point), ${threshold})
        )
      ORDER BY
        COALESCE(SUM(sb.on_hand_qty), 0) ASC,
        sb.warehouse_id ASC
      LIMIT ${limit}
    `;

    // Lookup best suggested supplier for each variant
    const variantIds = [...new Set(rows.map((r) => r.variant_id))];
    const supplierByVariant = new Map();

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

      for (const link of supplierLinks) {
        if (!supplierByVariant.has(link.variant_id)) {
          supplierByVariant.set(link.variant_id, {
            suggested_supplier_id: link.suppliers.id,
            suggested_supplier_name: link.suppliers.name,
            suggested_supplier_code: link.suppliers.code || null,
          });
        }
      }
    }

    const data = rows.map((row) => {
      // available_qty in this response = on_hand_qty (total physical: shelf + receiving).
      // shelf_qty = truly shelf-available (not borrowed/reserved/in-transit).
      const availableQty = Number(row.available_qty || 0);   // = on_hand total
      const shelfQty     = Number(row.shelf_qty    || 0);   // = truly available
      const reorderPoint = Number(row.reorder_point || DEFAULT_LOW_STOCK_THRESHOLD);
      const effectiveThreshold = reorderPoint > 0 ? reorderPoint : DEFAULT_LOW_STOCK_THRESHOLD;
      const suggestedQty = Math.max(1, effectiveThreshold * 2 - availableQty);
      const supplierSuggestion = supplierByVariant.get(row.variant_id) || null;

      return {
        variant_id: row.variant_id,
        book_id: row.book_id || null,
        title: row.book_title || 'Unknown',
        isbn: row.isbn13 || row.isbn10 || row.internal_barcode || row.sku || null,
        sku: row.sku || null,
        warehouse_id: row.warehouse_id,
        warehouse_code: row.warehouse_code || null,
        warehouse_name: row.warehouse_name || null,
        warehouse_province: row.warehouse_province || null,
        warehouse_district: row.warehouse_district || null,
        available_qty: availableQty,   // on_hand total (shelf + receiving)
        shelf_qty: shelfQty,           // truly available on shelf
        on_hand_qty: availableQty,     // alias for clarity
        reorder_point: reorderPoint,
        suggested_quantity: suggestedQty,
        priority: availableQty === 0
          ? 'HIGH'
          : availableQty <= Math.floor(effectiveThreshold / 2)
            ? 'HIGH'
            : 'MEDIUM',
        reason: availableQty === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
        suggested_supplier_id: supplierSuggestion?.suggested_supplier_id || null,
        suggested_supplier_name: supplierSuggestion?.suggested_supplier_name || null,
        suggested_supplier_code: supplierSuggestion?.suggested_supplier_code || null,
      };
    });

    return res.json({ data, total: data.length, threshold });
  } catch (error) {
    console.error('[stock-balance] getLowStockByWarehouse error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = { getLowStockByWarehouse };
