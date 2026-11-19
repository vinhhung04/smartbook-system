const { writeAuditLog } = require('../lib/audit');
const AUTO_EVENTS = ['RELEASE_RESERVATION', 'BORROW_OPERATION'];

async function getQueueState(db, now = new Date()) {
  const manualWhere = { OR: [
    { status: 'PENDING', event_type: { notIn: AUTO_EVENTS } },
    { status: { in: ['FAILED', 'MANUAL_REVIEW'] } },
  ] };
  const automaticWhere = { status: { in: ['PENDING', 'PROCESSING'] }, event_type: { in: AUTO_EVENTS } };
  const [automaticPending, manualPending, oldestAutomatic, oldestManual, failed] = await Promise.all([
    db.integration_outbox.count({ where: automaticWhere }),
    db.integration_outbox.count({ where: manualWhere }),
    db.integration_outbox.findFirst({ where: automaticWhere, orderBy: { occurred_at: 'asc' }, select: { occurred_at: true } }),
    db.integration_outbox.findFirst({ where: manualWhere, orderBy: { occurred_at: 'asc' }, select: { occurred_at: true } }),
    db.integration_outbox.count({ where: { status: { in: ['FAILED', 'MANUAL_REVIEW'] } } }),
  ]);
  const age = row => row ? Math.max(0, (now - row.occurred_at) / 1000) : 0;
  return { automaticPending, manualPending, failed, oldestAutomaticSeconds: age(oldestAutomatic), oldestManualSeconds: age(oldestManual) };
}

async function reviewReconciliation(db, { id, actorId, action, note, evidence }) {
  if (!/^[0-9a-f-]{36}$/i.test(id || '') || !/^[0-9a-f-]{36}$/i.test(actorId || '')) throw new Error('Valid record and operator UUID required');
  if (!['requeue', 'resolve'].includes(action) || !note?.trim() || !evidence?.trim()) throw new Error('Action, reason and evidence reference required');
  if (note.length > 2000 || evidence.length > 500) throw new Error('Review text too long');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM integration_outbox WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.integration_outbox.findUnique({ where: { id } });
    if (!row) throw new Error('Reconciliation record not found');
    if (['PUBLISHED', 'RESOLVED', 'PROCESSING'].includes(row.status)) throw new Error('Record is terminal or currently claimed');
    if (action === 'requeue' && !AUTO_EVENTS.includes(row.event_type)) throw new Error('No safe automatic handler for this event');
    const status = action === 'requeue' ? 'PENDING' : 'RESOLVED';
    const updated = await tx.integration_outbox.update({ where: { id }, data: {
      status, lease_until: null,
      ...(action === 'requeue' ? { retry_count: 0, next_attempt_at: new Date(), last_error_code: null } : {}),
    } });
    await writeAuditLog(tx, { actor_user_id: actorId, action_name: `RECONCILIATION_${action.toUpperCase()}`, entity_type: 'INTEGRATION_OUTBOX', entity_id: id,
      before_data: { status: row.status, retry_count: row.retry_count }, after_data: { status, note: note.trim(), evidence: evidence.trim() } });
    // Payload/evidence of the original operation are retained unchanged.
    return { id: updated.id, status: updated.status };
  });
}
module.exports = { AUTO_EVENTS, getQueueState, reviewReconciliation };
