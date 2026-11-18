const { ProcurementError } = require('./procurement-receipt.service');

// Only unwind putaway movements explicitly stamped with this receipt. Unlinked
// warehouse transfers cannot safely be attributed to a GRN.
async function reverseReceiptPutaway(tx, receiptId) {
  const movements = await tx.stock_movements.findMany({
    where: { reference_type: 'RECEIVING_SHELF_PUTAWAY', reference_id: receiptId, movement_status: 'POSTED', reverted: false },
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
  });
  for (const move of movements) {
    if (move.metadata?.movement_bucket !== 'PUTAWAY') continue;
    await tx.$queryRawUnsafe('SELECT id FROM stock_balances WHERE variant_id = $1::uuid AND location_id IN ($2::uuid, $3::uuid) ORDER BY id FOR UPDATE', move.variant_id, move.from_location_id, move.to_location_id);
    const target = await tx.stock_balances.findFirst({ where: { variant_id: move.variant_id, location_id: move.to_location_id } });
    if (!target || target.on_hand_qty < move.quantity || target.available_qty < move.quantity) {
      throw new ProcurementError('PUTAWAY_STOCK_UNAVAILABLE', 'Hàng đã cất không còn đủ khả dụng để hoàn nguyên phiếu nhập', 409);
    }
    await tx.stock_balances.update({ where: { id: target.id }, data: { on_hand_qty: { decrement: move.quantity }, available_qty: { decrement: move.quantity }, version: { increment: 1 }, last_movement_at: new Date() } });
    await tx.stock_balances.update({ where: { variant_id_location_id: { variant_id: move.variant_id, location_id: move.from_location_id } }, data: { on_hand_qty: { increment: move.quantity }, version: { increment: 1 }, last_movement_at: new Date() } });
    await tx.stock_movements.update({ where: { id: move.id }, data: { reverted: true } });
    for (const [locationId, delta] of [[move.to_location_id, -move.quantity], [move.from_location_id, move.quantity]]) {
      await tx.integration_outbox.create({ data: {
        aggregate_type: 'STOCK_BALANCE', aggregate_id: move.variant_id, event_type: 'inventory.stock.changed',
        payload: { warehouse_id: move.warehouse_id, variant_id: move.variant_id, location_id: locationId, delta_qty: delta, reason_code: 'GOODS_RECEIPT_CANCELLED', source_reference_type: 'GOODS_RECEIPT', source_reference_id: receiptId },
      } });
    }
  }
}
module.exports = { reverseReceiptPutaway };
