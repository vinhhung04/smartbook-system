const { getMeter } = require('@smartbook/shared/metrics');

const { prisma } = require('./prisma');
const meter = getMeter('inventory-service');

// Query durable state at scrape time; worker batch size is not queue depth.
function observable(name, read) {
  meter.createObservableGauge(name).addCallback(async result => {
    try { result.observe(await read()); }
    catch { console.warn('[inventory-service][metrics] collection failed', name); }
  });
}
observable('outbox_pending_total', () => prisma.integration_outbox.count({ where: { status: 'PENDING' } }));
observable('outbox_oldest_pending_age_seconds', async () => {
  const row = await prisma.integration_outbox.aggregate({ where: { status: 'PENDING' }, _min: { occurred_at: true } });
  return row._min.occurred_at ? Math.max(0, (Date.now() - row._min.occurred_at) / 1000) : 0;
});
observable('outbox_failed_records', () => prisma.integration_outbox.count({ where: { status: 'FAILED' } }));
// Kept for worker API compatibility; the gauge no longer trusts sampled batches.
function setOutboxPending() {}

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

// Business anomaly signals for the operations alerts (read-only, computed at
// scrape time). task_type is folded into a fixed set so the label stays bounded.
const GOODS_RECEIPT_STUCK_HOURS = Number(process.env.GOODS_RECEIPT_STUCK_HOURS || 24);
const TASK_TYPES = ['RECEIVING', 'PUTAWAY', 'PICKING', 'PACKING', 'OUTBOUND', 'TRANSFER', 'AUDIT'];
observable('goods_receipt_stuck_total', () => prisma.goods_receipts.count({
  where: { status: 'DRAFT', created_at: { lt: new Date(Date.now() - GOODS_RECEIPT_STUCK_HOURS * 3_600_000) } },
}));
meter.createObservableGauge('warehouse_exceptions_recent').addCallback(async (result) => {
  try {
    const rows = await prisma.warehouse_exception_reports.groupBy({
      by: ['task_type'], _count: { _all: true }, where: { created_at: { gte: new Date(Date.now() - 86_400_000) } },
    });
    const counts = Object.fromEntries([...TASK_TYPES, 'OTHER'].map(type => [type, 0]));
    for (const row of rows) {
      const type = TASK_TYPES.includes(String(row.task_type).toUpperCase()) ? String(row.task_type).toUpperCase() : 'OTHER';
      counts[type] += row._count._all;
    }
    for (const [task_type, count] of Object.entries(counts)) result.observe(count, { task_type, window: '24h' });
  } catch { console.warn('[inventory-service][metrics] collection failed', 'warehouse_exceptions_recent'); }
});

module.exports = {
  setOutboxPending,
  outboxFailedCounter,
  rabbitmqPublishFailCounter,
  reservationCreatedCounter,
  reservationConflictCounter,
  recordStockMutation,
};
