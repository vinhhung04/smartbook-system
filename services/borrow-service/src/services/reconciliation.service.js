const { prisma } = require('../lib/prisma');

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Records that a compensating/undo action is still needed after a local
 * write failed following a call to Inventory Service that already succeeded,
 * so the failure is durable and retryable instead of living only in a server
 * log line nobody watches. Reuses integration_outbox — already modeled in
 * schema.prisma for exactly this "reliable eventual delivery" purpose, but
 * never actually written to or read from anywhere in this codebase. */
async function queueReconciliation({ aggregateId, eventType, payload, db = prisma }) {
  // Propagate persistence failure: a log message is not a durable queue.
  return db.integration_outbox.create({
      data: {
        aggregate_type: 'LOAN_RESERVATION',
        aggregate_id: aggregateId || null,
        event_type: eventType,
        payload: payload || {},
        status: 'PENDING',
      },
    });
}

/** Retries a compensating call a few times with backoff before giving up and
 * queuing it for reservation-reconciliation.job.js to keep retrying. Only fit
 * for actions with a well-defined, safe undo (e.g. releasing a reservation
 * that was never actually persisted locally) — not for flows where the
 * correct compensating call needs data (loan_item ids, inventory_unit ids)
 * that the failed local transaction never created; those should call
 * queueReconciliation directly instead so a human reviews them rather than
 * an automated retry guessing at an undo. */
async function compensateWithRetry(compensationFn, { aggregateId, eventType, payload, db = prisma, maxAttempts = DEFAULT_MAX_ATTEMPTS, backoffMs = DEFAULT_BACKOFF_MS } = {}) {
  // Persist before the first attempt, including when the process dies after
  // Inventory commits but before its response arrives.
  const record = await queueReconciliation({ aggregateId, eventType, payload, db });
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await compensationFn();
      await db.integration_outbox.update({ where: { id: record.id }, data: { status: 'PUBLISHED', published_at: new Date() } });
      return { ok: true };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(backoffMs * attempt);
      }
    }
  }

  console.error(`Compensation failed after ${maxAttempts} attempts; durable reconciliation remains pending (${eventType})`);
  return { ok: false, error: lastError };
}

module.exports = { queueReconciliation, compensateWithRetry };
