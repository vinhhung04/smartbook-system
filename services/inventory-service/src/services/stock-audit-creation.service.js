// Extracted from stock-audit.controller.js's createStockAudit so the location-
// scoping behavior (the exact mechanism the warehouse floor map's "Tao phieu
// kiem ke" button depends on) is unit-testable without a real database,
// matching this service's existing goods-receipt-posting.service.js pattern.

/** Prisma `where` clause for the stock_balances lookup that becomes an audit's
 * lines. Scoped to specific locations when locationIds is non-empty (e.g. the
 * floor map's "audit just this one bin" flow); whole-warehouse otherwise
 * (the Stock Audits page's existing "audit everything" flow). */
function buildStockBalanceFilter(warehouseId, locationIds) {
  return {
    warehouse_id: warehouseId,
    ...(locationIds.length ? { location_id: { in: locationIds } } : {}),
  };
}

/** Creates the audit header + one line per already-fetched stock_balances row,
 * inside the caller's transaction. `balances` rows: { variant_id, location_id,
 * on_hand_qty }. */
async function createAuditWithLines(tx, { auditNumber, warehouseId, note, userId, balances }) {
  const audit = await tx.stock_audits.create({
    data: {
      audit_number: auditNumber,
      warehouse_id: warehouseId,
      status: 'DRAFT',
      created_by_user_id: userId,
      started_at: new Date(),
      note,
    },
  });

  await tx.stock_audit_lines.createMany({
    data: balances.map((b) => ({
      stock_audit_id: audit.id,
      variant_id: b.variant_id,
      location_id: b.location_id,
      expected_qty: b.on_hand_qty,
    })),
  });

  return audit;
}

module.exports = { buildStockBalanceFilter, createAuditWithLines };
