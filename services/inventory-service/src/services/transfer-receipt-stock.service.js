const { resolveOrCreateReceivingLocation } = require('../utils/locations');

function createReceiptNumber(baseTimestamp) {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GR-TR-${baseTimestamp}-${suffix}`;
}

function createTransferMovementNumber(baseTimestamp, index) {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MV-TR-${baseTimestamp}-${index + 1}-${suffix}`;
}

async function postTransferReceiptToReceiving(tx, goodsReceipt, userId) {
  const existingMovementCount = await tx.stock_movements.count({
    where: {
      reference_type: "GOODS_RECEIPT",
      reference_id: goodsReceipt.id,
    },
  });

  if (existingMovementCount > 0) {
    return;
  }

  const receivingLocation = await resolveOrCreateReceivingLocation(
    tx,
    goodsReceipt.warehouse_id,
  );

  const items = (await tx.goods_receipt_items.findMany({
    where: { goods_receipt_id: goodsReceipt.id },
    select: {
      variant_id: true,
      quantity: true,
      unit_cost: true,
    },
  })).filter(item => Number(item.quantity) > 0);

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
    const existingRows = await tx.$queryRawUnsafe(
      `SELECT id, on_hand_qty FROM stock_balances
       WHERE variant_id::text = $1 AND location_id::text = $2
       FOR UPDATE`,
      item.variant_id,
      receivingLocation.id,
    );
    const existingList = Array.isArray(existingRows) ? existingRows : [];

    if (existingList.length > 0) {
      await tx.$queryRawUnsafe(
        `UPDATE stock_balances
         SET on_hand_qty = on_hand_qty + $1,
             available_qty = 0,
             version = version + 1,
             last_movement_at = NOW()
         WHERE variant_id::text = $2 AND location_id::text = $3`,
        item.quantity,
        item.variant_id,
        receivingLocation.id,
      );
    } else {
      await tx.$queryRawUnsafe(
        `INSERT INTO stock_balances
           (id, warehouse_id, variant_id, location_id, on_hand_qty, available_qty, version, last_movement_at)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4, 0, 1, NOW())`,
        goodsReceipt.warehouse_id,
        item.variant_id,
        receivingLocation.id,
        item.quantity,
      );
    }
  }

  const baseTimestamp = Date.now();
  await tx.stock_movements.createMany({
    data: items.map((item, index) => ({
      movement_number: createTransferMovementNumber(baseTimestamp, index),
      movement_type: "INBOUND",
      movement_status: "POSTED",
      warehouse_id: goodsReceipt.warehouse_id,
      variant_id: item.variant_id,
      to_location_id: receivingLocation.id,
      quantity: item.quantity,
      unit_cost: Number(item.unit_cost || 0),
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
  await tx.integration_outbox.createMany({
    data: aggregatedItems.map(item => ({
      aggregate_type: 'STOCK_BALANCE', aggregate_id: item.variant_id, event_type: 'inventory.stock.changed',
      payload: { variant_id: item.variant_id, location_id: receivingLocation.id, warehouse_id: goodsReceipt.warehouse_id,
        delta_qty: item.quantity, reason_code: 'TRANSFER_RECEIPT', source_reference_type: 'GOODS_RECEIPT', source_reference_id: goodsReceipt.id },
    })),
  });
}

module.exports = { postTransferReceiptToReceiving, createReceiptNumber };
