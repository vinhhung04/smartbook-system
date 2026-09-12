async function releaseReservedStock(tx, { variant_id, location_id, quantity }) {
  const result = await tx.stock_balances.updateMany({
    where: { variant_id, location_id, reserved_qty: { gte: quantity } },
    data: {
      available_qty: { increment: quantity },
      reserved_qty: { decrement: quantity },
      last_movement_at: new Date(),
    },
  });

  return result.count === 1;
}

async function consumeReservedStock(tx, { variant_id, location_id, quantity }) {
  const result = await tx.stock_balances.updateMany({
    where: { variant_id, location_id, reserved_qty: { gte: quantity } },
    data: {
      reserved_qty: { decrement: quantity },
      borrowed_qty: { increment: quantity },
      last_movement_at: new Date(),
    },
  });

  return result.count === 1;
}

module.exports = { releaseReservedStock, consumeReservedStock };
