// Incident statistics computed from recorded incidents and deliveries only.
// A metric without data is null ("chưa có dữ liệu"), never an invented zero.
//
// MTTD here is the alert pipeline latency (first_seen_at - the source's startsAt):
// Grafana's payload does not carry the moment the condition first became true,
// so true detection time is not measurable from it.
const { Prisma } = require('@prisma/client');

async function incidentAnalytics(prisma, { days = 30 } = {}) {
  const window = Math.min(Math.max(Number(days) || 30, 1), 365);
  const since = new Date(Date.now() - window * 86_400_000);
  const [timing] = await prisma.$queryRaw`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status <> 'RESOLVED')::int AS open,
      avg(EXTRACT(EPOCH FROM (first_seen_at - source_started_at))) FILTER (WHERE source_started_at IS NOT NULL AND first_seen_at >= source_started_at AND labels->>'detected_late' IS NULL) AS mttd_seconds,
      avg(EXTRACT(EPOCH FROM (acknowledged_at - first_seen_at))) FILTER (WHERE acknowledged_at IS NOT NULL) AS mtta_seconds,
      avg(EXTRACT(EPOCH FROM (resolved_at - first_seen_at))) FILTER (WHERE resolved_at IS NOT NULL) AS mttr_seconds,
      count(*) FILTER (WHERE acknowledged_at IS NOT NULL)::int AS acknowledged_samples,
      count(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved_samples
    FROM system_incidents WHERE first_seen_at >= ${since}`;
  const bySeverity = await prisma.$queryRaw`SELECT severity AS key, count(*)::int AS count FROM system_incidents WHERE first_seen_at >= ${since} GROUP BY severity ORDER BY count DESC`;
  const byService = await prisma.$queryRaw`SELECT service_name AS key, count(*)::int AS count FROM system_incidents WHERE first_seen_at >= ${since} GROUP BY service_name ORDER BY count DESC LIMIT 15`;
  const byCategory = await prisma.$queryRaw`SELECT category AS key, count(*)::int AS count FROM system_incidents WHERE first_seen_at >= ${since} GROUP BY category ORDER BY count DESC`;
  const trend = await prisma.$queryRaw`
    SELECT to_char(date_trunc('day', first_seen_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') AS day, severity, count(*)::int AS count
    FROM system_incidents WHERE first_seen_at >= ${since}
    GROUP BY 1, 2 ORDER BY 1`;
  const deliveries = await prisma.$queryRaw`
    SELECT channel, count(*) FILTER (WHERE status = 'SENT')::int AS sent, count(*) FILTER (WHERE status = 'DEAD')::int AS failed,
           count(*) FILTER (WHERE status IN ('PENDING', 'RETRY', 'SENDING'))::int AS pending
    FROM alert_deliveries WHERE created_at >= ${since} GROUP BY channel`;
  const num = value => (value === null || value === undefined ? null : Number(value instanceof Prisma.Decimal ? value.toString() : value));
  const delivered = deliveries.reduce((acc, row) => ({ sent: acc.sent + row.sent, failed: acc.failed + row.failed }), { sent: 0, failed: 0 });
  return {
    window_days: window,
    total: timing.total,
    open: timing.open,
    mttd_seconds: num(timing.mttd_seconds),
    mtta_seconds: num(timing.mtta_seconds),
    mttr_seconds: num(timing.mttr_seconds),
    acknowledged_samples: timing.acknowledged_samples,
    resolved_samples: timing.resolved_samples,
    by_severity: bySeverity, by_service: byService, by_category: byCategory, trend,
    deliveries: {
      by_channel: deliveries,
      success_rate: delivered.sent + delivered.failed > 0 ? delivered.sent / (delivered.sent + delivered.failed) : null,
    },
  };
}

module.exports = { incidentAnalytics };
