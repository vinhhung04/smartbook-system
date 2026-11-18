const crypto = require('node:crypto');
const { deterministicUuid } = require('@smartbook/shared/runtime');
const { prisma } = require('../lib/prisma');

// Private, process-local capability. HTTP request JSON/headers cannot request a
// replay with the original authorization snapshot or override an approved plan.
const RECOVERY = Symbol('approved-borrow-operation-recovery');
const OPERATION_LEASE_MS = 30 * 60 * 1000;

function json(value) { return JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function operationId(kind, reference) { return deterministicUuid(`borrow-operation:${kind}:${reference}`); }
function boundedBorrowKey(prefix, key, maxLength = 100) {
  const candidate = `${prefix}${key}`;
  return candidate.length <= maxLength ? candidate : `sb:${crypto.createHash('sha256').update(candidate).digest('hex')}`;
}
function actorSnapshot(user = {}) {
  return { id: user.id || null, is_superuser: user.is_superuser === true,
    roles: Array.isArray(user.roles) ? user.roles.map(String) : [],
    permissions: Array.isArray(user.permissions) ? user.permissions.map(String) : [] };
}
function fingerprint(kind, actor, request) {
  // Conversion/cancel/return refer to an already scoped business object; another
  // authorized staff member may replay it. Direct-loan keys belong to their actor.
  return crypto.createHash('sha256').update(JSON.stringify(stable({ kind,
    actor_id: kind === 'DIRECT_LOAN' ? actor?.id : null, request }))).digest('hex');
}
function conflict(message = 'Yêu cầu đang được xử lý hoặc cần đối soát; vui lòng thử lại với cùng key') {
  return Object.assign(new Error(message), { status: 409, code: 'BORROW_OPERATION_CONFLICT' });
}
async function readBorrowOperation(db, kind, reference, { request, user } = {}) {
  const record = await db.integration_outbox.findUnique({ where: { id: operationId(kind, reference) } });
  if (record && request && record.payload.fingerprint !== fingerprint(kind, user, request)) {
    throw conflict('Idempotency-Key đã được dùng cho một yêu cầu có nội dung hoặc người thực hiện khác');
  }
  return record;
}
function approvedRecovery(req) { return req?.[RECOVERY] || null; }

async function prepareBorrowOperationInTransaction(tx, { kind, reference, aggregateId = reference, key, request, user, plan, ownedOperation }) {
  const id = operationId(kind, reference);
  const current = await readBorrowOperation(tx, kind, reference, { request, user });
  if (current && ['FAILED', 'MANUAL_REVIEW', 'RESOLVED'].includes(current.status)) throw conflict('Nghiệp vụ cần đối soát có phê duyệt');
  if (current?.status === 'PUBLISHED') return current;
  if (current?.status === 'PROCESSING' && current.lease_until && new Date(current.lease_until) > new Date()) {
    if (ownedOperation?.id === id && new Date(ownedOperation.lease_until).getTime() === new Date(current.lease_until).getTime()) return current;
    throw conflict();
  }
  if (current) {
    const claimed = await tx.integration_outbox.updateMany({ where: { id, status: current.status, lease_until: current.lease_until },
      data: { status: 'PROCESSING', lease_until: new Date(Date.now() + OPERATION_LEASE_MS) } });
    if (claimed.count !== 1) throw conflict();
    return tx.integration_outbox.findUnique({ where: { id } });
  }
  return tx.integration_outbox.create({ data: {
    id, aggregate_type: 'BORROW_OPERATION', aggregate_id: aggregateId, event_type: 'BORROW_OPERATION',
    status: 'PROCESSING', lease_until: new Date(Date.now() + OPERATION_LEASE_MS),
    payload: json({ version: 1, kind, key, actor: actorSnapshot(user), request, plan,
      fingerprint: fingerprint(kind, user, request), state: 'PREPARED', remote_started: false }),
  } });
}

async function prepareBorrowOperation(db, { kind, reference, aggregateId = reference, key, request, user, plan, req }) {
  const id = operationId(kind, reference);
  const recovering = approvedRecovery(req);
  if (recovering) {
    if (recovering.id !== id || recovering.payload.fingerprint !== fingerprint(kind, user, request)) throw conflict();
    return recovering;
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`borrow-operation:${id}`}, 0))`;
      const current = await readBorrowOperation(tx, kind, reference, { request, user });
      if (current?.status === 'PUBLISHED') return current;
      if (current && ['FAILED', 'MANUAL_REVIEW', 'RESOLVED'].includes(current.status)) throw conflict('Nghiệp vụ đang chờ xử lý đối soát; không tạo một lượt mượn/trả khác');
      if (current?.status === 'PROCESSING' && current.lease_until && new Date(current.lease_until) > new Date()) return null;
      if (current) {
        const claimed = await tx.integration_outbox.updateMany({ where: { id, status: current.status, lease_until: current.lease_until },
          data: { status: 'PROCESSING', lease_until: new Date(Date.now() + OPERATION_LEASE_MS) } });
        return claimed.count ? tx.integration_outbox.findUnique({ where: { id } }) : null;
      }
      return tx.integration_outbox.create({ data: {
        id, aggregate_type: 'BORROW_OPERATION', aggregate_id: aggregateId, event_type: 'BORROW_OPERATION',
        status: 'PROCESSING', lease_until: new Date(Date.now() + OPERATION_LEASE_MS),
        payload: json({ version: 1, kind, key, actor: actorSnapshot(user), request,
          plan, fingerprint: fingerprint(kind, user, request), state: 'PREPARED', remote_started: false }),
      } });
    });
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw conflict();
}
async function markBorrowRemoteStarted(db, operation) {
  // Persist this outside the business transaction, so a process/transaction
  // rollback cannot erase evidence that the remote call might have committed.
  const current = await db.integration_outbox.findUnique({ where: { id: operation.id } });
  if (!current || current.status !== 'PROCESSING') throw conflict();
  const result = await db.integration_outbox.updateMany({ where: { id: operation.id, status: 'PROCESSING', lease_until: operation.lease_until }, data: {
    payload: { ...current.payload, state: 'REMOTE_STARTED', remote_started: true },
  } });
  if (result.count !== 1) throw conflict('Quyền xử lý nghiệp vụ đã chuyển sang lượt đối soát khác');
}
async function recordBorrowCompletionContext(db, operation, context) {
  const current = await db.integration_outbox.findUnique({ where: { id: operation.id } });
  if (current?.payload.completion) return current.payload.completion;
  const result = await db.integration_outbox.updateMany({ where: { id: operation.id, status: 'PROCESSING', lease_until: operation.lease_until },
    data: { payload: json({ ...current.payload, completion: context }) } });
  if (result.count !== 1) throw conflict('Quyền xử lý nghiệp vụ đã chuyển sang lượt đối soát khác');
  return json(context);
}
async function completeBorrowOperation(tx, operation, response) {
  if (!operation) return;
  const current = await tx.integration_outbox.findUnique({ where: { id: operation.id } });
  if (current?.status === 'PUBLISHED') return;
  const result = await tx.integration_outbox.updateMany({ where: { id: operation.id, status: 'PROCESSING', lease_until: operation.lease_until }, data: {
    status: 'PUBLISHED', lease_until: null, published_at: new Date(), last_error_code: null,
    payload: json({ ...current.payload, state: response.status >= 400 ? 'ABORTED' : 'COMPLETED', response }),
  } });
  if (result.count !== 1) throw conflict('Quyền xử lý nghiệp vụ đã chuyển sang lượt đối soát khác');
  const legacyEvent = { DIRECT_LOAN: 'DIRECT_LOAN_CONSUME_UNRESOLVED', CONVERT_RESERVATION: 'RESERVATION_CONSUME_UNRESOLVED', RETURN_LOAN: 'LOAN_RETURN_UNRESOLVED' }[operation.payload.kind];
  if (legacyEvent) await tx.integration_outbox.updateMany({ where: {
    aggregate_id: operation.payload.plan.loanId, event_type: legacyEvent, status: 'PENDING',
    ...(operation.payload.kind === 'RETURN_LOAN' ? { payload: { path: ['idempotency_key'], equals: operation.payload.key } } : {}),
  }, data: { status: 'PUBLISHED', published_at: new Date() } });
}
async function deferBorrowOperation(db, operation, error, req) {
  if (!operation || approvedRecovery(req)) return;
  const code = String(error.code || (error.status ? `HTTP_${error.status}` : 'REMOTE_OR_LOCAL_FAILURE')).slice(0, 64);
  const manual = (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status))
    || error.name === 'AccountError' || error.code === 'MEMBERSHIP_LIMIT_EXCEEDED_ON_RECHECK';
  // Do not fabricate a queue success if this write fails: the already persisted
  // PROCESSING record remains recoverable after its lease expires.
  await db.integration_outbox.updateMany({ where: { id: operation.id, status: 'PROCESSING', lease_until: operation.lease_until }, data: {
    status: manual ? 'MANUAL_REVIEW' : 'PENDING', lease_until: null, next_attempt_at: new Date(Date.now() + 5000), last_error_code: code,
  } });
}
function sendBorrowReplay(res, record) {
  const saved = record?.payload?.response;
  if (!saved) throw conflict();
  return res.status(saved.status >= 400 ? saved.status : 200).json({ ...saved.body, idempotent: true });
}
function isBorrowOperationDue(record, now = new Date()) {
  return record.event_type === 'BORROW_OPERATION' && record.status !== 'PUBLISHED'
    && !['FAILED', 'MANUAL_REVIEW', 'RESOLVED'].includes(record.status) && (!record.lease_until || new Date(record.lease_until) <= now)
    && (!record.next_attempt_at || new Date(record.next_attempt_at) <= now);
}
async function recoverBorrowOperation(record, { prismaClient = prisma } = {}) {
  if (record.status === 'PUBLISHED') return { resolved: true };
  if (record.status !== 'PROCESSING') return { manual: true, code: 'OPERATION_NOT_CLAIMED' };
  const state = record.payload;
  if (state?.version !== 1 || !state.plan || !state.request || !state.actor) return { manual: true, code: 'INVALID_OPERATION_PLAN' };
  const req = { params: state.request.params || {}, body: state.request.body || {}, query: {},
    headers: { 'idempotency-key': state.key }, user: state.actor,
    reservationChannel: state.request.channel, [RECOVERY]: record };
  let status = 200, body;
  const res = { status(n) { status = n; return this; }, json(value) { body = value; return this; } };
  const loan = () => require('../controllers/loan.controller');
  const reservation = () => require('../controllers/reservation.controller');
  const handlers = { DIRECT_LOAN: () => loan().createDirectLoan,
    CONVERT_RESERVATION: () => loan().convertReservationToLoan, RETURN_LOAN: () => loan().returnLoan,
    CREATE_RESERVATION: () => reservation().createReservation, CANCEL_RESERVATION: () => reservation().cancelReservation };
  try {
    if (state.kind === 'EXPIRE_RESERVATION') {
      const result = await reservation().releaseExpiredReservation(state.plan.reservation, { operation: record });
      if (result.skipped) return { manual: true, code: 'EXPIRY_STATE_CHANGED' };
      return { resolved: true };
    }
    const handler = handlers[state.kind]?.();
    if (!handler) return { manual: true, code: 'UNSUPPORTED_OPERATION_KIND' };
    await handler(req, res);
    if (status < 400) {
      const current = await prismaClient.integration_outbox.findUnique({ where: { id: record.id } });
      if (current?.status !== 'PUBLISHED') await completeBorrowOperation(prismaClient, record, { status, body });
      return { resolved: true };
    }
    return status >= 500 ? { retryable: true, code: 'RECOVERY_TRANSIENT_FAILURE' }
      : { manual: true, code: `RECOVERY_HTTP_${status}` };
  } catch (error) { return { retryable: true, code: String(error.code || 'RECOVERY_FAILURE').slice(0, 64) }; }
}
module.exports = { readBorrowOperation, prepareBorrowOperation, approvedRecovery, markBorrowRemoteStarted,
  prepareBorrowOperationInTransaction, completeBorrowOperation, deferBorrowOperation, sendBorrowReplay,
  recoverBorrowOperation, isBorrowOperationDue, operationId, boundedBorrowKey, recordBorrowCompletionContext };
