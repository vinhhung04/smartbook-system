// Soft reservation for outbound requests: an approved outbound/transfer order
// that is not fully picked yet holds its remaining quantity against the
// warehouse's pickable available_qty, so two requests cannot be promised the
// same copies. Picking moves stock out of available_qty, and the order's
// processed_qty/shipped_qty grows by the same amount, so each copy is counted once.
// shortcut: REPICKING roots are skipped (their shortages live on the repick order,
// which is APPROVED and counted); borrow holds and transfer requests do not look
// at these commitments - move to location-level reserved_qty if that matters.
const OPEN_OUTBOUND_STATUSES = ["APPROVED", "PICKING", "PARTIAL_PICKED"];
const OPEN_TRANSFER_STATUSES = ["APPROVED", "PICKING"];

function sumByVariant(rows, qtyOf) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.variant_id);
    map.set(key, (map.get(key) || 0) + Math.max(0, qtyOf(row)));
  }
  return map;
}

/**
 * requiredByVariant: Map<variant_id, qty>. Serializes on the warehouse for the
 * rest of the transaction, so concurrent approvals cannot both pass.
 * Returns [] when every variant fits, otherwise one entry per short variant.
 */
async function findOutboundShortages(tx, warehouseId, requiredByVariant, { excludeOrderId = null } = {}) {
  const variantIds = [...requiredByVariant.keys()];
  if (variantIds.length === 0) return [];

  await tx.$queryRawUnsafe("SELECT 1 FROM pg_advisory_xact_lock(hashtext($1))", `outbound-commit:${warehouseId}`);

  const [availableRows, outboundRows, transferRows] = await Promise.all([
    tx.stock_balances.groupBy({
      by: ["variant_id"],
      where: {
        warehouse_id: warehouseId,
        variant_id: { in: variantIds },
        available_qty: { gt: 0 },
        locations: { is_active: true, is_pickable: true },
      },
      _sum: { available_qty: true },
    }),
    tx.outbound_order_items.findMany({
      where: {
        variant_id: { in: variantIds },
        outbound_orders: {
          warehouse_id: warehouseId,
          status: { in: OPEN_OUTBOUND_STATUSES },
          ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
        },
      },
      select: { variant_id: true, quantity: true, processed_qty: true },
    }),
    tx.transfer_order_items.findMany({
      where: {
        variant_id: { in: variantIds },
        transfer_orders: { from_warehouse_id: warehouseId, status: { in: OPEN_TRANSFER_STATUSES } },
      },
      select: { variant_id: true, quantity: true, shipped_qty: true },
    }),
  ]);

  const available = new Map(availableRows.map((row) => [String(row.variant_id), Number(row._sum.available_qty || 0)]));
  const outbound = sumByVariant(outboundRows, (row) => Number(row.quantity || 0) - Number(row.processed_qty || 0));
  const transfer = sumByVariant(transferRows, (row) => Number(row.quantity || 0) - Number(row.shipped_qty || 0));

  const shortages = [];
  for (const [variantId, requiredQty] of requiredByVariant) {
    const availableQty = available.get(variantId) || 0;
    const committedQty = (outbound.get(variantId) || 0) + (transfer.get(variantId) || 0);
    const freeQty = Math.max(0, availableQty - committedQty);
    if (freeQty < requiredQty) {
      shortages.push({
        variant_id: variantId,
        required_qty: requiredQty,
        available_qty: availableQty,
        committed_qty: committedQty,
        free_qty: freeQty,
        shortage_qty: requiredQty - freeQty,
      });
    }
  }
  return shortages;
}

module.exports = { findOutboundShortages, OPEN_OUTBOUND_STATUSES, OPEN_TRANSFER_STATUSES };
