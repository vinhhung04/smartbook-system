// Per-warehouse stock status, one definition shared by /warehouse-stock-risk
// (counts) and /warehouse-stock-items (the rows behind those counts).
// Pure functions, no DB access, same convention as forecast.js / lead-time.js.
//
// A variant's stock in a warehouse is the SUM over its locations. Counting
// location rows instead made a variant with 0 in a receiving bay and 5 on
// the shelf "out of stock" - the same false positive inventory-service's
// /api/stock-balances/low-stock already fixed by aggregating first.

function toNumber(value) {
  return Number(value || 0);
}

// OUT_OF_STOCK: nothing available. LOW_STOCK: at or under the reorder point
// (or the global threshold when the variant has none). OK otherwise.
function stockStatus(row, lowStockThreshold) {
  const available = toNumber(row.available_qty);
  const reorderPoint = toNumber(row.reorder_point);
  const threshold = reorderPoint > 0 ? reorderPoint : lowStockThreshold;
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available <= threshold) return 'LOW_STOCK';
  return 'OK';
}

// variantRows: one row per (warehouse_id, variant_id) with summed quantities;
// a warehouse with no stock at all arrives as a single row with variant_id null.
// low_stock_variants keeps its historical meaning: every variant at or under
// its threshold, out-of-stock ones included.
function summarizeWarehouses(variantRows, lowStockThreshold) {
  const byWarehouse = new Map();
  for (const row of variantRows) {
    if (!byWarehouse.has(row.warehouse_id)) {
      byWarehouse.set(row.warehouse_id, {
        warehouse_id: row.warehouse_id,
        warehouse_name: row.warehouse_name,
        low_stock_variants: 0,
        out_of_stock_variants: 0,
        total_available_qty: 0,
        total_reserved_qty: 0,
        total_borrowed_qty: 0,
      });
    }
    const summary = byWarehouse.get(row.warehouse_id);
    if (!row.variant_id) continue;
    const status = stockStatus(row, lowStockThreshold);
    if (status !== 'OK') summary.low_stock_variants += 1;
    if (status === 'OUT_OF_STOCK') summary.out_of_stock_variants += 1;
    summary.total_available_qty += toNumber(row.available_qty);
    summary.total_reserved_qty += toNumber(row.reserved_qty);
    summary.total_borrowed_qty += toNumber(row.borrowed_qty);
  }
  return Array.from(byWarehouse.values()).sort((a, b) => b.low_stock_variants - a.low_stock_variants
    || b.out_of_stock_variants - a.out_of_stock_variants
    || String(a.warehouse_name).localeCompare(String(b.warehouse_name)));
}

module.exports = { stockStatus, summarizeWarehouses };
