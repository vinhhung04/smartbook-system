const { createMovementNumber } = require('../utils/inventory');
const { resolveOrCreateReceivingLocation } = require('../utils/locations');

class TransferDiscrepancyError extends Error {
  constructor(message, statusCode = 409) { super(message); this.statusCode = statusCode; }
}
const fields = { MISSING: 'remaining_missing_qty', DAMAGED: 'remaining_damaged_qty', REJECTED: 'remaining_rejected_qty' };
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function buildDiscrepancyItems(lines, outcomes) {
  return lines.flatMap(line => {
    const outcome = outcomes.get(String(line.id));
    if (!outcome || !(outcome.missing || outcome.damaged || outcome.rejected)) return [];
    return [{ transfer_order_item_id: line.id, variant_id: line.variant_id, shipped_qty: Number(line.shipped_qty),
      delivered_qty: outcome.delivered, accepted_qty: outcome.accepted, damaged_qty: outcome.damaged,
      rejected_qty: outcome.rejected, missing_qty: outcome.missing, remaining_damaged_qty: outcome.damaged,
      remaining_rejected_qty: outcome.rejected, remaining_missing_qty: outcome.missing }];
  });
}
function validateResolution(item, body) {
  if (['bucket', 'action', 'reason', 'evidence_reference'].some(key => typeof body[key] !== 'string')) throw new TransferDiscrepancyError('Loại chênh lệch, phương án, lý do và bằng chứng phải là chuỗi', 400);
  const bucket = String(body.bucket || '').toUpperCase();
  const action = String(body.action || '').toUpperCase();
  const quantity = typeof body.quantity === 'number' || typeof body.quantity === 'string' ? Number(body.quantity) : NaN;
  const reason = String(body.reason || '').trim();
  const evidence = String(body.evidence_reference || '').trim();
  if (!fields[bucket] || !Number.isInteger(quantity) || quantity <= 0 || !reason || !evidence || reason.length > 2000 || evidence.length > 1000) {
    throw new TransferDiscrepancyError('Cần loại chênh lệch, số lượng nguyên dương, lý do và tham chiếu bằng chứng hợp lệ', 400);
  }
  const allowed = bucket === 'MISSING' ? ['FOUND', 'REDELIVERED', 'WRITE_OFF'] : ['RETURN_TO_SOURCE', 'WRITE_OFF'];
  if (!allowed.includes(action)) throw new TransferDiscrepancyError('Phương án không phù hợp với loại chênh lệch', 400);
  if (quantity > Number(item[fields[bucket]])) throw new TransferDiscrepancyError('Số lượng vượt phần chênh lệch chưa xử lý');
  const replacement = typeof body.redelivery_transfer_id === 'string' ? body.redelivery_transfer_id.toLowerCase() : null;
  if (action === 'REDELIVERED' && !isUuid(replacement)) throw new TransferDiscrepancyError('Cần phiếu chuyển giao bù đã nhận', 400);
  if (action !== 'REDELIVERED' && body.redelivery_transfer_id) throw new TransferDiscrepancyError('Tham chiếu giao bù chỉ dùng với phương án REDELIVERED', 400);
  return { bucket, action, quantity, reason, evidence_reference: evidence, redelivery_transfer_id: replacement };
}
async function quarantineLocation(tx, warehouseId) {
  const location = await tx.locations.upsert({ where: { warehouse_id_location_code: { warehouse_id: warehouseId, location_code: 'TRANSFER-QUARANTINE' } },
    create: { warehouse_id: warehouseId, location_code: 'TRANSFER-QUARANTINE', location_type: 'QUARANTINE', is_pickable: false },
    update: {}, select: { id: true, location_type: true, is_pickable: true, is_active: true } });
  if (location.location_type !== 'QUARANTINE' || location.is_pickable || !location.is_active) {
    throw new TransferDiscrepancyError('Vị trí TRANSFER-QUARANTINE phải là khu cách ly không lấy hàng và đang hoạt động');
  }
  return location;
}
async function stockEvent(tx, { warehouseId, locationId, variantId, quantity, caseId, actorId, direction, bucket }) {
  await tx.stock_movements.create({ data: { movement_number: createMovementNumber(Date.now(), 0, 'TD'),
    movement_type: quantity > 0 ? 'INBOUND' : 'OUTBOUND', warehouse_id: warehouseId, variant_id: variantId,
    ...(quantity > 0 ? { to_location_id: locationId } : { from_location_id: locationId }), quantity: Math.abs(quantity),
    source_service: 'INVENTORY_SERVICE', reference_type: 'TRANSFER_DISCREPANCY', reference_id: caseId,
    created_by_user_id: actorId, reason_code: direction, metadata: { discrepancy_bucket: bucket } } });
  await tx.integration_outbox.create({ data: { aggregate_type: 'STOCK_BALANCE', aggregate_id: variantId,
    event_type: 'inventory.stock.changed', payload: { warehouse_id: warehouseId, location_id: locationId, variant_id: variantId,
      delta_qty: quantity, reason_code: direction, source_reference_type: 'TRANSFER_DISCREPANCY', source_reference_id: caseId } } });
}
async function addCustody(tx, warehouseId, locationId, variantId, quantity, quarantined) {
  await tx.stock_balances.upsert({ where: { variant_id_location_id: { variant_id: variantId, location_id: locationId } },
    create: { warehouse_id: warehouseId, location_id: locationId, variant_id: variantId, on_hand_qty: quantity, available_qty: 0, damaged_qty: quarantined ? quantity : 0 },
    update: { on_hand_qty: { increment: quantity }, ...(quarantined ? { damaged_qty: { increment: quantity } } : {}), version: { increment: 1 }, last_movement_at: new Date() } });
}
async function takeQuarantine(tx, discrepancy, item, quantity) {
  const location = await quarantineLocation(tx, discrepancy.to_warehouse_id);
  const changed = await tx.stock_balances.updateMany({
    where: { warehouse_id: discrepancy.to_warehouse_id, location_id: location.id, variant_id: item.variant_id,
      on_hand_qty: { gte: quantity }, damaged_qty: { gte: quantity } },
    data: { on_hand_qty: { decrement: quantity }, damaged_qty: { decrement: quantity }, version: { increment: 1 }, last_movement_at: new Date() },
  });
  if (changed.count !== 1) throw new TransferDiscrepancyError('Không đủ hàng đang cách ly để xử lý');
  return location.id;
}
async function caseDetail(tx, transferId) {
  const discrepancy = await tx.transfer_discrepancies.findUnique({ where: { transfer_order_id: transferId } });
  if (!discrepancy) return null;
  const [items, resolutions] = await Promise.all([
    tx.transfer_discrepancy_items.findMany({ where: { discrepancy_id: discrepancy.id }, orderBy: { id: 'asc' } }),
    tx.transfer_discrepancy_resolutions.findMany({ where: { discrepancy_id: discrepancy.id }, orderBy: { created_at: 'asc' } }),
  ]);
  const variants = items.length ? await tx.book_variants.findMany({ where: { id: { in: items.map(item => item.variant_id) } }, select: { id: true, sku: true, books: { select: { title: true } } } }) : [];
  const titles = new Map(variants.map(row => [row.id, row]));
  return { ...discrepancy, items: items.map(item => ({ ...item, title: titles.get(item.variant_id)?.books?.title, sku: titles.get(item.variant_id)?.sku })), resolutions };
}
async function recordTransferDiscrepancy(tx, { order, receiptId, lines, outcomes, actorId }) {
  const items = buildDiscrepancyItems(lines, outcomes);
  if (!items.length) return null;
  // The caller holds the transfer-order row lock; unique transfer_order_id is
  // an independent database backstop against a repeated physical receipt.
  const discrepancy = await tx.transfer_discrepancies.create({ data: { transfer_order_id: order.id,
    goods_receipt_id: receiptId, from_warehouse_id: order.from_warehouse_id, to_warehouse_id: order.to_warehouse_id, created_by_user_id: actorId } });
  await tx.transfer_discrepancy_items.createMany({ data: items.map(item => ({ ...item, discrepancy_id: discrepancy.id })) });
  const quarantine = items.some(item => item.damaged_qty + item.rejected_qty > 0) ? await quarantineLocation(tx, order.to_warehouse_id) : null;
  for (const item of items) {
    const quantity = item.damaged_qty + item.rejected_qty;
    if (!quantity) continue;
    await addCustody(tx, order.to_warehouse_id, quarantine.id, item.variant_id, quantity, true);
    await stockEvent(tx, { warehouseId: order.to_warehouse_id, locationId: quarantine.id, variantId: item.variant_id,
      quantity, caseId: discrepancy.id, actorId, direction: 'TRANSFER_QUARANTINED', bucket: 'QUARANTINE' });
  }
  await tx.inventory_audit_logs.create({ data: { actor_user_id: actorId, action_name: 'TRANSFER_DISCREPANCY_OPENED',
    entity_type: 'TRANSFER_DISCREPANCY', entity_id: discrepancy.id, after_data: { transfer_id: order.id, items } } });
  return { ...discrepancy, items };
}
function replayMatches(saved, itemId, proposal) {
  return saved.discrepancy_item_id === itemId && ['bucket', 'action', 'quantity', 'reason', 'evidence_reference', 'redelivery_transfer_id'].every(key => saved[key] === proposal[key]);
}
async function resolveTransferDiscrepancy(tx, { transferId, body, key, actorId, canWriteSource }) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`transfer-resolution:${key}`}, 0))`;
  await tx.$queryRawUnsafe('SELECT id FROM transfer_orders WHERE id = $1::uuid FOR UPDATE', transferId);
  const discrepancy = await tx.transfer_discrepancies.findUnique({ where: { transfer_order_id: transferId } });
  if (!discrepancy) throw new TransferDiscrepancyError('Không tìm thấy hồ sơ chênh lệch', 404);
  const item = await tx.transfer_discrepancy_items.findFirst({ where: { id: body.discrepancy_item_id, discrepancy_id: discrepancy.id } });
  if (!item) throw new TransferDiscrepancyError('Dòng chênh lệch không thuộc hồ sơ', 400);
  const saved = await tx.transfer_discrepancy_resolutions.findUnique({ where: { idempotency_key: key } });
  // Validate identity against original quantity on replay, not the decreased remainder.
  const proposal = validateResolution(saved ? { ...item, [fields[String(body.bucket).toUpperCase()]]: saved.quantity } : item, body);
  if (saved) {
    if (saved.discrepancy_id !== discrepancy.id || !replayMatches(saved, item.id, proposal)) throw new TransferDiscrepancyError('Idempotency-Key đã dùng cho dữ liệu khác');
    return { data: await caseDetail(tx, transferId), idempotent: true };
  }
  if (proposal.action === 'RETURN_TO_SOURCE' && !canWriteSource) throw new TransferDiscrepancyError('Cần quyền WRITE tại kho nguồn để xác nhận hàng hoàn về', 403);
  if (proposal.action === 'REDELIVERED') {
    if (proposal.redelivery_transfer_id === transferId) throw new TransferDiscrepancyError('Không thể dùng chính chuyến thiếu hàng làm giao bù', 400);
    await tx.$queryRawUnsafe('SELECT id FROM transfer_orders WHERE id = $1::uuid FOR UPDATE', proposal.redelivery_transfer_id);
    const replacement = await tx.transfer_orders.findUnique({ where: { id: proposal.redelivery_transfer_id } });
    if (!replacement || replacement.status !== 'RECEIVED' || replacement.from_warehouse_id !== discrepancy.from_warehouse_id || replacement.to_warehouse_id !== discrepancy.to_warehouse_id) {
      throw new TransferDiscrepancyError('Phiếu giao bù phải đã nhận và cùng kho nguồn/đích');
    }
    const linked = String(replacement.note || '').match(/(?:^|[\s;|])(?:root_task_id|redelivery_for)=([0-9a-f-]{36})(?:$|[\s;|])/i);
    if (!linked || linked[1].toLowerCase() !== transferId.toLowerCase()) throw new TransferDiscrepancyError('Phiếu giao bù phải được liên kết với đúng chuyến gốc');
    const received = await tx.transfer_order_items.aggregate({ where: { transfer_order_id: replacement.id, variant_id: item.variant_id }, _sum: { received_qty: true } });
    const allocations = await tx.transfer_discrepancy_resolutions.findMany({ where: { redelivery_transfer_id: replacement.id } });
    const claimedIds = allocations.map(row => row.discrepancy_item_id);
    const claimedItems = claimedIds.length ? await tx.transfer_discrepancy_items.findMany({ where: { id: { in: claimedIds }, variant_id: item.variant_id } }) : [];
    const matching = new Set(claimedItems.map(row => row.id));
    const used = allocations.filter(row => matching.has(row.discrepancy_item_id)).reduce((sum, row) => sum + row.quantity, 0);
    if (used + proposal.quantity > Number(received._sum.received_qty || 0)) throw new TransferDiscrepancyError('Giao bù đã được phân bổ hoặc không đủ số lượng được chấp nhận');
    // Replacement receipt already posted actual stock. Link it, never post twice.
  } else if (proposal.action === 'FOUND') {
    const receiving = await resolveOrCreateReceivingLocation(tx, discrepancy.to_warehouse_id);
    await addCustody(tx, discrepancy.to_warehouse_id, receiving.id, item.variant_id, proposal.quantity, false);
    await stockEvent(tx, { warehouseId: discrepancy.to_warehouse_id, locationId: receiving.id, variantId: item.variant_id,
      quantity: proposal.quantity, caseId: discrepancy.id, actorId, direction: 'TRANSFER_MISSING_FOUND', bucket: proposal.bucket });
    await tx.transfer_order_items.update({ where: { id: item.transfer_order_item_id }, data: { received_qty: { increment: proposal.quantity } } });
  } else if (proposal.bucket !== 'MISSING') {
    const locationId = await takeQuarantine(tx, discrepancy, item, proposal.quantity);
    await stockEvent(tx, { warehouseId: discrepancy.to_warehouse_id, locationId, variantId: item.variant_id,
      quantity: -proposal.quantity, caseId: discrepancy.id, actorId, direction: proposal.action, bucket: proposal.bucket });
    if (proposal.action === 'RETURN_TO_SOURCE') {
      const source = await quarantineLocation(tx, discrepancy.from_warehouse_id);
      await addCustody(tx, discrepancy.from_warehouse_id, source.id, item.variant_id, proposal.quantity, true);
      await stockEvent(tx, { warehouseId: discrepancy.from_warehouse_id, locationId: source.id, variantId: item.variant_id,
        quantity: proposal.quantity, caseId: discrepancy.id, actorId, direction: 'TRANSFER_QUARANTINE_RETURNED', bucket: proposal.bucket });
    }
  }
  await tx.transfer_discrepancy_resolutions.create({ data: { discrepancy_id: discrepancy.id, discrepancy_item_id: item.id,
    ...proposal, idempotency_key: key, actor_user_id: actorId } });
  await tx.transfer_discrepancy_items.update({ where: { id: item.id }, data: { [fields[proposal.bucket]]: { decrement: proposal.quantity } } });
  const remaining = await tx.transfer_discrepancy_items.findMany({ where: { discrepancy_id: discrepancy.id } });
  const closed = remaining.every(row => row.remaining_missing_qty + row.remaining_damaged_qty + row.remaining_rejected_qty === 0);
  if (closed) await tx.transfer_discrepancies.update({ where: { id: discrepancy.id }, data: { status: 'RESOLVED', resolved_at: new Date(), resolved_by_user_id: actorId } });
  await tx.inventory_audit_logs.create({ data: { actor_user_id: actorId, action_name: 'TRANSFER_DISCREPANCY_RESOLVED_QUANTITY',
    entity_type: 'TRANSFER_DISCREPANCY', entity_id: discrepancy.id, after_data: { discrepancy_item_id: item.id, ...proposal, closed } } });
  return { data: await caseDetail(tx, transferId), idempotent: false };
}
module.exports = { TransferDiscrepancyError, buildDiscrepancyItems, validateResolution, recordTransferDiscrepancy, resolveTransferDiscrepancy, caseDetail, isUuid };
