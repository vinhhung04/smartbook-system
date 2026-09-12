const { prisma } = require('../lib/prisma');
const { releaseReservation: defaultReleaseReservation } = require('../services/inventory-integration.service');

// event_types this job knows how to safely retry automatically (a well-defined,
// idempotent undo). Anything else in the outbox has no safe automatic action
// (see reconciliation.service.js's queueReconciliation call sites) and is only
// surfaced for a human to review, never guessed at.
const AUTO_RETRYABLE_EVENT_TYPES = new Set(['RELEASE_RESERVATION']);

// After this many attempts, stop retrying silently and mark FAILED so it does
// not retry forever unattended; a human can requeue it (reset status to
// PENDING) once the underlying cause is understood.
const MAX_RETRY_COUNT = 10;

let timer = null;
let running = false;

async function runReconciliationSweep(prismaClient = prisma, options = {}) {
  // Injectable (like prismaClient above) so tests can exercise the retry/
  // give-up/manual-review branching without a real Inventory Service call or
  // a real service-to-service JWT.
  const releaseReservation = options.releaseReservationFn || defaultReleaseReservation;
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));

  const pending = await prismaClient.integration_outbox.findMany({
    where: { status: 'PENDING' },
    orderBy: [{ occurred_at: 'asc' }],
    take: limit,
  });

  const result = { scanned: pending.length, resolved: 0, retried: 0, failed: 0, needsManualReview: 0 };

  for (const record of pending) {
    if (!AUTO_RETRYABLE_EVENT_TYPES.has(record.event_type)) {
      result.needsManualReview += 1;
      console.warn(
        `[borrow-service][job] reconciliation item needs manual review: ${record.event_type} (${record.id})`,
        record.payload,
      );
      continue;
    }

    try {
      if (record.event_type === 'RELEASE_RESERVATION') {
        await releaseReservation({
          reservation_id: record.payload?.reservation_id,
          reason: record.payload?.reason || 'RECONCILIATION_RETRY',
          idempotency_key: `reconcile:${record.id}`,
          authHeader: options.authHeader,
        });
      }

      await prismaClient.integration_outbox.update({
        where: { id: record.id },
        data: { status: 'PUBLISHED', published_at: new Date() },
      });
      result.resolved += 1;
    } catch (error) {
      const nextRetryCount = record.retry_count + 1;
      const giveUp = nextRetryCount >= MAX_RETRY_COUNT;
      await prismaClient.integration_outbox.update({
        where: { id: record.id },
        data: {
          retry_count: nextRetryCount,
          ...(giveUp ? { status: 'FAILED' } : {}),
        },
      });
      if (giveUp) {
        result.failed += 1;
        console.error(`[borrow-service][job] reconciliation gave up after ${nextRetryCount} attempts for ${record.id}`, error);
      } else {
        result.retried += 1;
        console.error(`[borrow-service][job] reconciliation retry ${nextRetryCount}/${MAX_RETRY_COUNT} failed for ${record.id}`, error);
      }
    }
  }

  return result;
}

async function executeReconciliationSweep() {
  if (running) {
    return;
  }

  running = true;
  try {
    const result = await runReconciliationSweep(prisma, {
      limit: Number(process.env.RESERVATION_RECONCILIATION_BATCH_SIZE || 50),
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
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  runReconciliationSweep,
  startReservationReconciliationJob,
  stopReservationReconciliationJob,
};
