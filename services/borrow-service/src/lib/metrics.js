const { getMeter } = require('@smartbook/shared/metrics');
const { prisma } = require('./prisma');
const { getQueueState } = require('../services/reconciliation-queue.service');
const meter = getMeter('borrow-service');
const callbacks = meter.createCounter('payment_callback_outcomes_total');
function recordPaymentCallback(req, res, next) {
  let code;
  const endpoint = String(req.path || '').startsWith('/ipn') ? 'ipn' : 'return';
  const json = res.json;
  res.json = function (body) {
    if (body && typeof body.RspCode === 'string') code = body.RspCode;
    return json.call(this, body);
  };
  res.once('finish', () => {
    const outcome = code === '00' ? 'accepted' : code === '02' ? 'replay'
      : code || res.statusCode >= 400 ? 'failed' : 'handled';
    callbacks.add(1, { endpoint, outcome });
  });
  next();
}
function observable(name, read) {
  meter.createObservableGauge(name).addCallback(async result => {
    try { result.observe(await read()); }
    catch { console.warn('[borrow-service][metrics] collection failed', name); }
  });
}
for (const [metric, field] of [
  ['reconciliation_automatic_pending', 'automaticPending'],
  ['reconciliation_manual_pending', 'manualPending'],
  ['reconciliation_failed_records', 'failed'],
  ['reconciliation_oldest_automatic_age_seconds', 'oldestAutomaticSeconds'],
  ['reconciliation_oldest_manual_age_seconds', 'oldestManualSeconds'],
]) observable(metric, async () => (await getQueueState(prisma))[field]);
observable('payment_unapplied_pending', () => prisma.integration_outbox.count({ where: {
  event_type: 'PAYMENT_UNAPPLIED', status: { notIn: ['PUBLISHED', 'RESOLVED'] },
} }));
observable('db_up', async () => { try { await prisma.$queryRaw`SELECT 1`; return 1; } catch { return 0; } });
module.exports = { recordPaymentCallback };
