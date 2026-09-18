const { PrismaClient } = require('@prisma/client');
const { getMeter } = require('@smartbook/shared/metrics');

const prisma = new PrismaClient();
const meter = getMeter('inventory-service');

let lastOutboxPending = 0;
meter.createObservableGauge('outbox_pending_total').addCallback((result) => {
  result.observe(lastOutboxPending);
});
function setOutboxPending(count) {
  lastOutboxPending = count;
}

const outboxFailedCounter = meter.createCounter('outbox_failed_total');
const rabbitmqPublishFailCounter = meter.createCounter('rabbitmq_publish_fail_total');
const reservationCreatedCounter = meter.createCounter('reservation_created_total');
const reservationConflictCounter = meter.createCounter('reservation_conflict_total');
const stockMutationCounter = meter.createCounter('stock_mutation_total');
function recordStockMutation(operation, result) {
  stockMutationCounter.add(1, { operation, result });
}

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 5);
meter.createObservableGauge('inventory_low_stock_variant_count').addCallback(async (result) => {
  try {
    const rows = await prisma.$queryRaw`
      SELECT COUNT(*) AS low_stock_variants
      FROM (
        SELECT
          sb.variant_id,
          SUM(sb.available_qty) AS available_qty,
          MAX(COALESCE(NULLIF(sb.reorder_point, 0), ${LOW_STOCK_THRESHOLD})) AS threshold
        FROM stock_balances sb
        JOIN book_variants bv ON bv.id = sb.variant_id
        WHERE bv.is_active = true
        GROUP BY sb.variant_id
        HAVING SUM(sb.available_qty) <= MAX(COALESCE(NULLIF(sb.reorder_point, 0), ${LOW_STOCK_THRESHOLD}))
      ) low_stock
    `;
    result.observe(Number(rows[0]?.low_stock_variants || 0));
  } catch (error) {
    console.error('[inventory-service][metrics] failed to compute inventory_low_stock_variant_count', error.message);
  }
});

// Separate from the /health liveness route (which intentionally does not
// touch the DB, so Docker's healthcheck / depends_on chain doesn't change
// behavior) — a real DB-connectivity signal for the "DB unavailable" alert,
// since neither /health nor Prometheus's own `up` (scrape-succeeded) metric
// reflect the database being reachable.
meter.createObservableGauge('db_up').addCallback(async (result) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    result.observe(1);
  } catch {
    result.observe(0);
  }
});

module.exports = {
  setOutboxPending,
  outboxFailedCounter,
  rabbitmqPublishFailCounter,
  reservationCreatedCounter,
  reservationConflictCounter,
  recordStockMutation,
};
