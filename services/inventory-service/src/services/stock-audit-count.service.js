class StockAuditCountError extends Error {
  constructor(code, message, statusCode = 409) { super(message); this.code = code; this.statusCode = statusCode; }
}

function countBaseline(balance) {
  const onHand = Number(balance?.on_hand_qty || 0);
  const borrowed = Number(balance?.borrowed_qty || 0);
  return { expected_qty: Math.max(0, onHand - borrowed), baseline_on_hand_qty: onHand, baseline_borrowed_qty: borrowed };
}

function countAdjustment(line, balance, locationType) {
  if (!line.counted_at) throw new StockAuditCountError('STOCK_AUDIT_RECOUNT_REQUIRED', 'Phiếu cũ chưa có mốc kiểm đếm; cần đếm lại trước khi duyệt');
  const delta = Number(line.counted_qty) - Number(line.expected_qty);
  const hold = ['RECEIVING', 'STAGING', 'QUARANTINE'].includes(String(locationType || '').toUpperCase());
  const availableDelta = hold ? 0 : delta;
  const protectedQty = Number(balance?.borrowed_qty || 0) + Number(balance?.reserved_qty || 0) + Number(balance?.damaged_qty || 0);
  if (Number(balance?.on_hand_qty || 0) + delta < protectedQty || Number(balance?.available_qty || 0) + availableDelta < 0) {
    throw new StockAuditCountError('STOCK_AUDIT_HELD_STOCK_CONFLICT', 'Chênh lệch ảnh hưởng sách đang mượn, giữ chỗ hoặc cách ly; xử lý các khoản giữ trước khi duyệt');
  }
  return { delta, availableDelta };
}

async function lockAuditLocations(tx, locationIds) {
  for (const id of [...new Set(locationIds)].sort()) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', `stock-audit-location:${id}`);
  }
}

async function startAuditCount(tx, auditId, warehouseId) {
  const lines = await tx.stock_audit_lines.findMany({ where: { stock_audit_id: auditId } });
  const locationIds = [...new Set(lines.map(line => line.location_id))];
  await lockAuditLocations(tx, locationIds);
  const conflicting = await tx.stock_audit_lines.findFirst({ where: {
    location_id: { in: locationIds }, stock_audit_id: { not: auditId },
    stock_audits: { status: { in: ['DRAFT', 'IN_PROGRESS', 'SUBMITTED'] } },
  } });
  if (conflicting) throw new StockAuditCountError('STOCK_AUDIT_LOCATION_BUSY', 'Vị trí đang được kiểm kê trong phiếu khác');
  const now = new Date();
  for (const locationId of locationIds) {
    const session = await tx.stock_audit_location_sessions.findFirst({ where: { stock_audit_id: auditId, location_id: locationId, released_at: null } });
    if (session) await tx.stock_audit_location_sessions.update({ where: { id: session.id }, data: { started_at: now, counting_completed_at: null } });
    else await tx.stock_audit_location_sessions.create({ data: { stock_audit_id: auditId, location_id: locationId, started_at: now } });
  }
  const balances = await tx.stock_balances.findMany({ where: { warehouse_id: warehouseId, location_id: { in: locationIds } } });
  const byKey = new Map(balances.map(b => [`${b.variant_id}:${b.location_id}`, b]));
  for (const line of lines) {
    const key = `${line.variant_id}:${line.location_id}`;
    await tx.stock_audit_lines.update({ where: { id: line.id }, data: { ...countBaseline(byKey.get(key)), counted_qty: null, variance_qty: null, counted_at: null } });
    byKey.delete(key);
  }
  if (byKey.size) await tx.stock_audit_lines.createMany({ data: [...byKey.values()].map(b => ({ stock_audit_id: auditId, variant_id: b.variant_id, location_id: b.location_id, ...countBaseline(b) })) });
}

async function confirmCountLocations(tx, auditId, locationIds) {
  await lockAuditLocations(tx, locationIds);
  for (const locationId of [...new Set(locationIds)].sort()) {
    const session = await tx.stock_audit_location_sessions.findFirst({ where: { stock_audit_id: auditId, location_id: locationId, released_at: null } });
    if (!session?.started_at) throw new StockAuditCountError('STOCK_AUDIT_RECOUNT_REQUIRED', 'Phiếu cũ cần bắt đầu đếm lại để xác lập mốc kiểm đếm');
    if (session.counting_completed_at) continue;
    const lines = await tx.stock_audit_lines.findMany({ where: { stock_audit_id: auditId, location_id: locationId } });
    if (!lines.length || lines.some(line => line.counted_qty === null)) throw new StockAuditCountError('STOCK_AUDIT_COUNT_INCOMPLETE', 'Cần nhập đủ số đếm tại vị trí trước khi chốt');
    const now = new Date();
    await tx.stock_audit_lines.updateMany({ where: { stock_audit_id: auditId, location_id: locationId }, data: { counted_at: now } });
    await tx.stock_audit_location_sessions.update({ where: { id: session.id }, data: { counting_completed_at: now } });
  }
}

module.exports = { StockAuditCountError, countBaseline, countAdjustment, lockAuditLocations, confirmCountLocations, startAuditCount };
