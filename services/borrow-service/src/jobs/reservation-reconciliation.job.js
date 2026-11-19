const { prisma } = require('../lib/prisma');
const { releaseReservation: defaultReleaseReservation } = require('../services/inventory-integration.service');
const { AUTO_EVENTS, getQueueState } = require('../services/reconciliation-queue.service');

// event_types this job knows how to safely retry automatically (a well-defined,
// idempotent undo). Anything else in the outbox has no safe automatic action
// (see reconciliation.service.js's queueReconciliation call sites) and is only
// surfaced for a human to review, never guessed at.
const AUTO_RETRYABLE_EVENT_TYPES = new Set(AUTO_EVENTS);

// After this many attempts, stop retrying silently and mark FAILED so it does
// not retry forever unattended; a human can requeue it (reset status to
// PENDING) once the underlying cause is understood.
const MAX_RETRY_COUNT = 10;

let timer = null;
let running = false;
let stopping = false;

async function runReconciliationSweep(prismaClient = prisma, options = {}) {
  // Injectable (like prismaClient above) so tests can exercise the retry/
  // give-up/manual-review branching without a real Inventory Service call or
  // a real service-to-service JWT.
  const releaseReservation = options.releaseReservationFn || defaultReleaseReservation;
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const now = options.now || new Date();
  // A dead worker's claim is recoverable. Remote handlers always reuse the
  // original idempotency key, including when the old response was lost.
  await prismaClient.integration_outbox.updateMany({
    where: { status: 'PROCESSING', event_type: { in: AUTO_EVENTS }, lease_until: { lte: now } },
    data: { status: 'PENDING', lease_until: null },
  });

  const pending = await prismaClient.integration_outbox.findMany({
    where: { status: 'PENDING', event_type: { in: AUTO_EVENTS }, next_attempt_at: { lte: now } },
    orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
    take: limit,
  });

  const queue = await getQueueState(prismaClient, now);
  options.onQueueState?.(queue);
  const result = { scanned: pending.length, resolved: 0, retried: 0, failed: 0, needsManualReview: queue.manualPending, ...queue };

  for (const record of pending) {
    if (!AUTO_RETRYABLE_EVENT_TYPES.has(record.event_type)) {
      continue;
    }

    // A return can contain up to 100 bounded per-item calls. Its approved-plan
    // lease matches the return request lease rather than expiring mid-flight.
    const leaseUntil = new Date(now.getTime() + (record.event_type === 'BORROW_OPERATION' ? 30 * 60_000 : 120_000));
    const claimed = await prismaClient.integration_outbox.updateMany({
      where: { id: record.id, status: 'PENDING', next_attempt_at: { lte: now } },
      data: { status: 'PROCESSING', lease_until: leaseUntil },
    });
    if (!claimed.count) continue;
    const claim = { id: record.id, status: 'PROCESSING', lease_until: leaseUntil };

    try {
      if (record.event_type === 'BORROW_OPERATION') {
        const recover = options.recoverBorrowOperationFn || require('../services/borrow-operation.service').recoverBorrowOperation;
        const outcome = await recover({ ...record, status: 'PROCESSING', lease_until: leaseUntil }, { prismaClient });
        if (outcome?.manual) {
          await prismaClient.integration_outbox.updateMany({ where: claim, data: { status: 'MANUAL_REVIEW', lease_until: null, last_error_code: 'OPERATION_REQUIRES_REVIEW' } });
          result.needsManualReview++;
          continue;
        }
        if (!outcome?.resolved) throw Object.assign(new Error('Operation not yet resolved'), { code: 'OPERATION_RETRY' });
      }
      if (record.event_type === 'RELEASE_RESERVATION') {
        await releaseReservation({
          reservation_id: record.payload?.reservation_id,
          reason: record.payload?.reason || 'RECONCILIATION_RETRY',
          idempotency_key: record.payload?.idempotency_key || `reconcile:${record.id}`,
          authHeader: options.authHeader,
        });
      }

      await prismaClient.integration_outbox.updateMany({
        where: claim,
        data: { status: 'PUBLISHED', published_at: new Date(), lease_until: null, last_error_code: null },
      });
      result.resolved += 1;
    } catch (error) {
      const nextRetryCount = Number(record.retry_count || 0) + 1;
      const giveUp = nextRetryCount >= MAX_RETRY_COUNT;
      await prismaClient.integration_outbox.updateMany({
        where: claim,
        data: {
          retry_count: nextRetryCount,
          status: giveUp ? 'FAILED' : 'PENDING',
          lease_until: null,
          next_attempt_at: new Date(now.getTime() + Math.min(3_600_000, 30_000 * (2 ** (nextRetryCount - 1)))),
          last_error_code: Number.isInteger(error?.status) ? `HTTP_${error.status}` : 'REMOTE_OR_LOCAL_FAILURE',
        },
      });
      if (giveUp) {
        result.failed += 1;
        console.error(`[borrow-service][job] reconciliation gave up after ${nextRetryCount} attempts for ${record.id}`);
      } else {
        result.retried += 1;
        console.error(`[borrow-service][job] reconciliation retry ${nextRetryCount}/${MAX_RETRY_COUNT} failed for ${record.id}`);
      }
    }
  }

  return result;
}

async function executeReconciliationSweep() {
  if (running || stopping) {
    return;
  }

  running = true;
  try {
    const result = await runReconciliationSweep(prisma, {
      limit: Number(process.env.RESERVATION_RECONCILIATION_BATCH_SIZE || 50),
      onQueueState: require('../lib/reconciliation-metrics').setReconciliationQueueState,
    });
    if (result.scanned > 0) {
      console.log('[borrow-service][job] reservation reconciliation sweep result', result);
    }
  } catch (error) {
    console.error('[borrow-service][job] reservation reconciliation sweep failed', error);
  } finally {
    running = false;
  }
}

function startReservationReconciliationJob() {
  if (timer || stopping) return;
  const enabled = String(process.env.ENABLE_RESERVATION_RECONCILIATION_JOB || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[borrow-service][job] reservation reconciliation disabled by env');
    return;
  }

  const intervalMs = Math.max(60_000, Number(process.env.RESERVATION_RECONCILIATION_INTERVAL_MS || 5 * 60_000));
  timer = setInterval(() => {
    void executeReconciliationSweep();
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log('[borrow-service][job] reservation reconciliation started', { intervalMs });
  void executeReconciliationSweep();
}

function stopReservationReconciliationJob() {
  stopping = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  return new Promise((resolve) => {
    const drained = () => running ? setTimeout(drained, 10) : resolve();
    drained();
  });
}

module.exports = {
  runReconciliationSweep,
  startReservationReconciliationJob,
  stopReservationReconciliationJob,
};
