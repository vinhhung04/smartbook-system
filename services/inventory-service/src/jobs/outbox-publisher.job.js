const { PrismaClient } = require('@prisma/client');
const rabbitmq = require('../lib/rabbitmq');

const prisma = new PrismaClient();

// event_types this job publishes to the broker. Deliberately separate from
// borrow-service's reservation-reconciliation.job.js, which polls the SAME
// shaped table for a different purpose (compensating-action retry, e.g.
// RELEASE_RESERVATION) — mixing "retry a saga action" and "publish a domain
// event" semantics in one job risks regressing the already-hardened
// reconciliation logic. Start with the one event this round wires end-to-end.
const PUBLISHABLE_EVENT_TYPES = new Set(['inventory.reservation.created']);

// After this many attempts, stop retrying silently and mark FAILED so a
// broker outage doesn't retry forever unattended; ops can reset status to
// PENDING once the underlying cause is understood.
const MAX_RETRY_COUNT = 10;

let timer = null;
let running = false;

async function runOutboxPublishSweep(prismaClient = prisma, options = {}) {
  // Injectable (like prismaClient above) so tests can exercise the retry/
  // give-up branching without a real broker connection.
  const publishEvent = options.publishEventFn || rabbitmq.publishEvent.bind(rabbitmq);
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));

  const pending = await prismaClient.integration_outbox.findMany({
    where: { status: 'PENDING', event_type: { in: [...PUBLISHABLE_EVENT_TYPES] } },
    orderBy: [{ occurred_at: 'asc' }],
    take: limit,
  });

  const result = { scanned: pending.length, published: 0, retried: 0, failed: 0 };

  for (const record of pending) {
    const envelope = {
      event_id: record.id,
      event_type: record.event_type,
      occurred_at: record.occurred_at,
      correlation_id: record.headers?.correlation_id ?? null,
      aggregate_type: record.aggregate_type,
      aggregate_id: record.aggregate_id,
      payload: record.payload,
    };

    try {
      const published = await publishEvent(record.event_type, envelope);
      if (!published) {
        throw new Error('publish returned false');
      }

      await prismaClient.integration_outbox.update({
        where: { id: record.id },
        data: { status: 'PUBLISHED', published_at: new Date() },
      });
      result.published += 1;
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
        console.error(`[inventory-service][job] outbox publish gave up after ${nextRetryCount} attempts for ${record.id}`, error.message);
      } else {
        result.retried += 1;
        console.error(`[inventory-service][job] outbox publish retry ${nextRetryCount}/${MAX_RETRY_COUNT} failed for ${record.id}`, error.message);
      }
    }
  }

  return result;
}

async function executeOutboxPublishSweep() {
  if (running) {
    return;
  }

  running = true;
  try {
    const result = await runOutboxPublishSweep(prisma, {
      limit: Number(process.env.OUTBOX_PUBLISHER_BATCH_SIZE || 50),
    });
    if (result.scanned > 0) {
      console.log('[inventory-service][job] outbox publish sweep result', result);
    }
  } catch (error) {
    console.error('[inventory-service][job] outbox publish sweep failed', error);
  } finally {
    running = false;
  }
}

function startOutboxPublisherJob() {
  const enabled = String(process.env.ENABLE_OUTBOX_PUBLISHER_JOB || 'true').toLowerCase() === 'true';
  if (!enabled) {
    console.log('[inventory-service][job] outbox publisher disabled by env');
    return;
  }

  const intervalMs = Math.max(1_000, Number(process.env.OUTBOX_PUBLISHER_INTERVAL_MS || 10_000));
  timer = setInterval(() => {
    void executeOutboxPublishSweep();
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  console.log('[inventory-service][job] outbox publisher started', { intervalMs });
  void executeOutboxPublishSweep();
}

function stopOutboxPublisherJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = {
  runOutboxPublishSweep,
  startOutboxPublisherJob,
  stopOutboxPublisherJob,
};
