// monitoring-service's own health in Prometheus. Labels are bounded enums only.
const { getMeter } = require('@smartbook/shared/metrics');

const meter = getMeter('monitoring-service');
const attempts = meter.createCounter('monitoring_delivery_attempts_total');
const ingested = meter.createCounter('monitoring_alerts_ingested_total');
let prismaClient = null;

function recordAttempt(channel, outcome) { attempts.add(1, { channel, outcome }); }
function recordIngest(source, action) { ingested.add(1, { source, action }); }

// Durable state is read at scrape time; on a database error the series is simply
// absent for that scrape (Grafana's "metrics missing" rule covers it).
function registerStateGauges(prisma) {
  prismaClient = prisma;
  meter.createObservableGauge('monitoring_deliveries').addCallback(async (result) => {
    try {
      const rows = await prismaClient.alert_deliveries.groupBy({ by: ['status'], _count: { _all: true }, where: { status: { in: ['PENDING', 'RETRY', 'SENDING', 'DEAD'] } } });
      for (const status of ['PENDING', 'RETRY', 'SENDING', 'DEAD']) {
        result.observe(rows.find(row => row.status === status)?._count._all || 0, { status: status.toLowerCase() });
      }
    } catch { /* absent this scrape */ }
  });
  meter.createObservableGauge('monitoring_incidents_open').addCallback(async (result) => {
    try {
      const rows = await prismaClient.system_incidents.groupBy({ by: ['severity'], _count: { _all: true }, where: { status: { not: 'RESOLVED' } } });
      for (const severity of ['CRITICAL', 'HIGH', 'WARNING', 'INFO']) {
        result.observe(rows.find(row => row.severity === severity)?._count._all || 0, { severity: severity.toLowerCase() });
      }
    } catch { /* absent this scrape */ }
  });
}

module.exports = { recordAttempt, recordIngest, registerStateGauges };
