const inventory = require('./inventory-integration.service');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = ['CANCELLED', 'EXPIRED', 'CONVERTED_TO_LOAN'];
const STOCK_EVENTS = ['BORROW_OPERATION', 'DIRECT_LOAN_CONSUME_UNRESOLVED', 'RESERVATION_CONSUME_UNRESOLVED', 'LOAN_RETURN_UNRESOLVED'];

// Advisory, read-only cross-service observation. A distributed snapshot is not
// atomic: recheck a mismatch after in-flight approved work finishes. Never infer
// an automatic refund, release or stock correction from this detector alone.
async function auditBorrowInventoryState(db, options = {}) {
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(options.limit) || 25)));
  const cursor = options.cursor || {};
  for (const value of Object.values(cursor)) if (value !== 'done' && value != null && !UUID.test(value)) throw new TypeError('Cursor must contain UUIDs or done');
  const getState = options.getInventoryState || inventory.getBorrowReconciliationState;
  const getCandidates = options.getInventoryCandidates || inventory.getBorrowReconciliationCandidates;
  const next = { reservations: 'done', operations: 'done', inventory: 'done' };
  const issues = [], errors = [], checked = new Map();
  const add = (code, reservationId, extra = {}) => {
    const item = { code, reservation_id: reservationId, ...extra };
    if (!issues.some(x => x.code === code && x.reservation_id === reservationId && x.loan_id === item.loan_id && x.loan_item_id === item.loan_item_id)) issues.push(item);
  };
  async function observe(reservationId, loanId, local, operation) {
    if (!UUID.test(reservationId || '') || (loanId && !UUID.test(loanId))) {
      errors.push({ code: 'INVALID_RECONCILIATION_REFERENCE', operation_id: operation?.id || null }); return;
    }
    const cacheKey = `${reservationId}:${loanId || ''}`;
    if (checked.has(cacheKey)) return;
    checked.set(cacheKey, true);
    let remote;
    try {
      remote = await getState({ reservationId, loanId });
      if (!remote || !Array.isArray(remote.consume_movements) || !Array.isArray(remote.return_movements)) throw new Error('Incomplete evidence');
    } catch (_error) { errors.push({ code: 'INVENTORY_EVIDENCE_UNAVAILABLE', reservation_id: reservationId, operation_id: operation?.id || null }); return; }
    local = local || await db.loan_reservations.findUnique({ where: { id: reservationId }, select: { id: true, status: true, quantity: true } });
    const transient = operation?.status === 'PROCESSING' && new Date(operation.lease_until || 0) > new Date();
    const detail = { local_status: local?.status || null, remote_status: remote.reservation?.status || null, transient_possible: Boolean(transient) };
    if (remote.truncated) add('INCOMPLETE_REMOTE_EVIDENCE', reservationId, detail);
    if (remote.reservation?.status === 'ACTIVE') {
      if (!local) add('REMOTE_HOLD_WITHOUT_LOCAL_RESERVATION', reservationId, detail);
      else if (['CANCELLED', 'EXPIRED'].includes(local.status)) add('ACTIVE_HOLD_AFTER_LOCAL_TERMINAL', reservationId, detail);
      else if (local.status === 'CONVERTED_TO_LOAN') add('ACTIVE_HOLD_AFTER_LOCAL_CONVERSION', reservationId, detail);
    }
    const linked = await db.loan_transactions.findMany({ where: { source_reservation_id: reservationId }, select: { id: true, total_items: true } });
    if (local?.status === 'CONVERTED_TO_LOAN' && !linked.length) add('LOCAL_CONVERTED_WITHOUT_LOAN', reservationId, detail);
    const remoteLoanIds = [...new Set(remote.consume_movements.map(m => m.reference_id).filter(id => UUID.test(id || '')))];
    const loanIds = [...new Set([...remoteLoanIds, ...(loanId ? [loanId] : [])])];
    const loans = loanIds.length ? await db.loan_transactions.findMany({ where: { id: { in: loanIds } }, select: { id: true, total_items: true } }) : [];
    for (const id of remoteLoanIds) {
      const loan = loans.find(row => row.id === id);
      if (!loan) add('REMOTE_CONSUMED_WITHOUT_LOCAL_LOAN', reservationId, { ...detail, loan_id: id });
      else if (!remote.truncated && remote.consume_movements.filter(m => m.reference_id === id).reduce((sum, m) => sum + Number(m.quantity), 0) !== loan.total_items) add('CONSUME_QUANTITY_MISMATCH', reservationId, { ...detail, loan_id: id });
    }
    const returnedIds = [...new Set(remote.return_movements.map(m => m.loan_item_id).filter(id => UUID.test(id || '')))];
    const items = returnedIds.length ? await db.loan_items.findMany({ where: { id: { in: returnedIds } }, select: { id: true, loan_id: true, status: true } }) : [];
    for (const id of returnedIds) {
      const item = items.find(row => row.id === id);
      if (!item || ['BORROWED', 'OVERDUE'].includes(item.status)) add('REMOTE_RETURN_WITHOUT_LOCAL_COMPLETION', reservationId, { ...detail, loan_item_id: id, loan_id: item?.loan_id || null });
    }
  }
  if (cursor.reservations !== 'done') {
    const rows = await db.loan_reservations.findMany({ where: { status: { in: TERMINAL }, ...(cursor.reservations ? { id: { gt: cursor.reservations } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1, select: { id: true, status: true, quantity: true } });
    for (const row of rows.slice(0, limit)) await observe(row.id, null, row);
    if (rows.length > limit) next.reservations = rows[limit - 1].id;
  }
  if (cursor.operations !== 'done') {
    // Include operator-resolved and completed records: a queue acknowledgement
    // cannot hide physical custody drift or replace evidence of compensation.
    const rows = await db.integration_outbox.findMany({ where: { event_type: { in: STOCK_EVENTS }, ...(cursor.operations ? { id: { gt: cursor.operations } } : {}) }, orderBy: { id: 'asc' }, take: limit + 1, select: { id: true, event_type: true, status: true, payload: true, lease_until: true } });
    for (const row of rows.slice(0, limit)) {
      const plan = row.payload?.plan || row.payload || {};
      const reservationId = plan.reservationId || plan.reservation_id || plan.reservation?.id;
      const loanId = plan.loanId || plan.loan_id;
      if (reservationId) await observe(reservationId, loanId, null, row);
    }
    if (rows.length > limit) next.operations = rows[limit - 1].id;
  }
  if (cursor.inventory !== 'done') {
    try {
      const page = await getCandidates({ after: cursor.inventory, limit });
      if (!Array.isArray(page?.data) || (page.next_cursor && !UUID.test(page.next_cursor))) throw new Error('Invalid candidate page');
      for (const row of page.data) await observe(row.source_reference_id);
      next.inventory = page.next_cursor || 'done';
    } catch (_error) {
      errors.push({ code: 'INVENTORY_CANDIDATES_UNAVAILABLE' });
      // Keep this stream's previous cursor so an outage never counts as done.
      next.inventory = cursor.inventory || null;
    }
  }
  return { observed_at: new Date().toISOString(), checked_count: checked.size, issues, errors, next_cursor: next,
    complete: Object.values(next).every(value => value === 'done') };
}
module.exports = { auditBorrowInventoryState };
