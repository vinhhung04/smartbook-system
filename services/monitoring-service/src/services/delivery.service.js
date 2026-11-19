// Database-backed delivery queue. No RabbitMQ on the critical alert path: a
// delivery row commits with its incident event, and this worker claims due rows
// with FOR UPDATE SKIP LOCKED (safe with more than one replica). A row whose
// worker died mid-send is reclaimed once its lease (locked_until) expires.
const { SENDERS } = require('../channels/senders');
const { nextAttemptDelayMs, isRetryable } = require('../domain/policy');
const metrics = require('../lib/metrics');

const BATCH_SIZE = 10;
const LEASE_SECONDS = 120;

function redact(message) {
  return String(message || 'ERROR')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .slice(0, 300);
}

async function claimDue(prisma, now = new Date()) {
  return prisma.$queryRaw`
    UPDATE alert_deliveries SET status = 'SENDING', locked_until = ${new Date(now.getTime() + LEASE_SECONDS * 1000)}, updated_at = ${now}
    WHERE id IN (
      SELECT id FROM alert_deliveries
      WHERE (status IN ('PENDING', 'RETRY') AND next_attempt_at <= ${now})
         OR (status = 'SENDING' AND locked_until < ${now})
      ORDER BY next_attempt_at
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
}

async function deliver(prisma, deliveryId, { now = () => new Date(), random = Math.random, senderOptions = {} } = {}) {
  const delivery = await prisma.alert_deliveries.findUnique({ where: { id: deliveryId }, include: { incident: true, channel_config: true } });
  if (!delivery || delivery.status !== 'SENDING') return null;
  // An administrator disabled the channel after this was queued: a deliberate
  // choice, not a delivery failure (no attempt, no "delivery failing" alert).
  if (!delivery.channel_config.enabled) {
    await prisma.alert_deliveries.update({ where: { id: delivery.id }, data: { status: 'SUPPRESSED', locked_until: null, last_error: 'CHANNEL_DISABLED', updated_at: now() } });
    return { outcome: 'SUPPRESSED', attemptNo: delivery.attempt_count, statusCode: null, errorCode: 'CHANNEL_DISABLED' };
  }
  const attemptNo = delivery.attempt_count + 1;
  const startedAt = Date.now();
  let outcome; let statusCode = null; let errorCode = null; let retry = false;
  try {
    const sender = SENDERS[delivery.channel];
    const result = await sender(delivery.channel_config, delivery.incident, delivery.kind, { prisma, eventId: delivery.event_id, ...senderOptions });
    statusCode = result?.statusCode ?? null;
    errorCode = result?.note && /failed/.test(result.note) ? result.note : null;
    outcome = 'SENT';
  } catch (error) {
    statusCode = error.statusCode ?? null;
    errorCode = redact(error.code || error.message);
    retry = isRetryable({ statusCode, permanent: error.permanent }) && attemptNo < delivery.max_attempts;
    outcome = retry ? 'RETRY' : 'DEAD';
  }
  const durationMs = Date.now() - startedAt;
  const at = now();
  await prisma.$transaction([
    prisma.alert_delivery_attempts.create({ data: { delivery_id: delivery.id, attempt_no: attemptNo, outcome, status_code: statusCode, error_code: errorCode, duration_ms: durationMs } }),
    prisma.alert_deliveries.update({
      where: { id: delivery.id },
      data: {
        status: outcome, attempt_count: attemptNo, locked_until: null, last_status_code: statusCode,
        last_error: outcome === 'SENT' ? null : errorCode, sent_at: outcome === 'SENT' ? at : null, updated_at: at,
        ...(retry ? { next_attempt_at: new Date(at.getTime() + nextAttemptDelayMs(attemptNo, random)) } : {}),
      },
    }),
    ...(outcome === 'DEAD' && delivery.incident_id ? [prisma.system_incident_events.create({
      data: { incident_id: delivery.incident_id, event_type: 'DELIVERY_FAILED', message: `${delivery.channel}: ${errorCode}`, payload: { delivery_id: delivery.id, attempts: attemptNo } },
    })] : []),
  ]);
  metrics.recordAttempt(delivery.channel, outcome);
  return { outcome, attemptNo, statusCode, errorCode };
}

async function runOnce(prisma, options = {}) {
  const claimed = await claimDue(prisma, options.now ? options.now() : new Date());
  const results = [];
  for (const { id } of claimed) results.push(await deliver(prisma, id, options));
  return results;
}

function startWorker(prisma, { intervalMs = Number(process.env.MONITORING_DELIVERY_INTERVAL_MS || 5000) } = {}) {
  let stopped = false;
  let running = null;
  const tick = async () => {
    if (stopped) return;
    running = runOnce(prisma).catch(error => console.error(JSON.stringify({ level: 'error', service: 'monitoring-service', msg: 'delivery worker failed', error: redact(error.message) })));
    await running;
    running = null;
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  let timer = setTimeout(tick, 1000);
  return async function stop() {
    stopped = true;
    clearTimeout(timer);
    if (running) await running;
  };
}

/** Admin "send a test notification" for one channel: synchronous, never queued. */
async function testChannel(prisma, config, { actor, senderOptions = {} } = {}) {
  const sample = {
    id: '00000000-0000-0000-0000-000000000000', title: 'Thông báo thử từ SmartBook', severity: 'INFO', category: 'INFO', status: 'OPEN',
    service_name: 'monitoring-service', summary: `Kiểm tra kênh "${config.name}" do ${actor?.name || 'quản trị viên'} yêu cầu.`,
    first_seen_at: new Date(), occurrence_count: 1, runbook_url: null,
  };
  let status = 'SENT'; let error = null;
  try {
    if (config.channel_type === 'IN_APP') {
      const { pushRealtime } = require('../channels/senders');
      const pushed = await pushRealtime('incident:notification', { id: null, incident_id: null, kind: 'TEST', severity: 'INFO', title: sample.title, body: sample.summary, created_at: new Date() });
      if (!pushed) throw new Error('REALTIME_PUSH_FAILED');
    } else {
      await SENDERS[config.channel_type](config, sample, 'TEST', senderOptions);
    }
  } catch (err) {
    status = 'FAILED';
    error = redact(err.code || err.message);
  }
  await prisma.alert_channel_configs.update({ where: { id: config.id }, data: { last_test_at: new Date(), last_test_status: status, last_test_error: error } });
  return { status, error };
}

module.exports = { claimDue, deliver, runOnce, startWorker, testChannel, redact };
