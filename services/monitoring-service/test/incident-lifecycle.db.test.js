// Runs against a disposable PostgreSQL database migrated with this service's
// migrations: MONITORING_TEST_DATABASE_URL=postgresql://...@127.0.0.1:<port>/monitoring_test
// The database is truncated between tests; never point it at a real database.
const test = require('node:test');
const assert = require('node:assert/strict');

const url = process.env.MONITORING_TEST_DATABASE_URL;
const skip = !url && 'MONITORING_TEST_DATABASE_URL not set';
let prisma; let incidents; let delivery; let senders;

function signal(overrides = {}) {
  return {
    source: 'GRAFANA', status: 'firing', fingerprint: 'grafana:fp-1', ruleUid: 'smartbook-db-unavailable', title: 'Database unavailable',
    severity: 'CRITICAL', category: 'TECHNICAL', serviceName: 'inventory-service', alertKind: null, summary: 'db down', description: null,
    runbookUrl: null, labels: { alertname: 'Database unavailable' }, startsAt: new Date('2026-11-19T01:00:00Z'), endsAt: null, ...overrides,
  };
}

test.before(async () => {
  if (skip) return;
  const target = new URL(url);
  assert.equal(target.hostname, '127.0.0.1', 'test database must be local');
  assert.match(target.pathname, /test/, 'test database name must contain "test"');
  process.env.DATABASE_URL = url;
  prisma = new (require('@prisma/client').PrismaClient)({ datasources: { db: { url } } });
  incidents = require('../src/services/incident.service');
  delivery = require('../src/services/delivery.service');
  senders = require('../src/channels/senders');
});
test.after(async () => { if (prisma) await prisma.$disconnect(); });
test.beforeEach(async () => {
  if (skip) return;
  await prisma.$executeRawUnsafe('TRUNCATE system_incidents, alert_deliveries, alert_delivery_attempts, system_notifications, system_notification_reads, monitoring_audit_logs CASCADE');
  await prisma.alert_channel_configs.deleteMany({ where: { channel_type: { not: 'IN_APP' } } });
  await prisma.alert_channel_configs.updateMany({ data: { enabled: true, max_attempts: 3 } });
  await prisma.alert_channel_configs.create({ data: { channel_type: 'EMAIL', name: 'ops', enabled: true, max_attempts: 3, config: { recipients: ['ops@example.com'] } } });
  await prisma.alert_policies.updateMany({ data: { enabled: true, cooldown_minutes: 15 } });
});

async function deliveriesOf(incidentId) {
  return prisma.alert_deliveries.findMany({ where: { incident_id: incidentId }, orderBy: [{ created_at: 'asc' }, { channel: 'asc' }] });
}

test('a firing alert creates one OPEN incident and queues email + in-app per the critical policy', { skip }, async () => {
  const result = await incidents.ingestSignal(prisma, signal());
  assert.equal(result.action, 'created');
  assert.equal(result.notification, 'QUEUED');
  const incident = await prisma.system_incidents.findUnique({ where: { id: result.incident.id } });
  assert.equal(incident.status, 'OPEN');
  assert.ok(incident.last_notified_at);
  const rows = await deliveriesOf(incident.id);
  assert.deepEqual(rows.map(r => r.channel).sort(), ['EMAIL', 'IN_APP']);
  assert.ok(rows.every(r => r.kind === 'OPEN' && r.status === 'PENDING'));
});

test('Grafana re-sending the same firing alert never creates a second incident or new notifications', { skip }, async () => {
  const first = await incidents.ingestSignal(prisma, signal());
  for (let i = 0; i < 3; i += 1) assert.equal((await incidents.ingestSignal(prisma, signal())).action, 'refreshed');
  assert.equal(await prisma.system_incidents.count(), 1);
  assert.equal((await deliveriesOf(first.incident.id)).length, 2);
});

test('concurrent deliveries of a brand new alert still produce exactly one incident', { skip }, async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:race' }))));
  assert.equal(await prisma.system_incidents.count({ where: { fingerprint: 'grafana:race' } }), 1);
  assert.equal(results.filter(r => r.action === 'created').length, 1);
});

test('resolved alert auto-resolves and sends a recovery notification; a late replay of the old episode is ignored', { skip }, async () => {
  const created = await incidents.ingestSignal(prisma, signal());
  const resolved = await incidents.ingestSignal(prisma, signal({ status: 'resolved', endsAt: new Date('2026-11-19T01:10:00Z') }));
  assert.equal(resolved.action, 'auto_resolved');
  const incident = await prisma.system_incidents.findUnique({ where: { id: created.incident.id } });
  assert.equal(incident.status, 'RESOLVED');
  assert.equal(incident.resolution_type, 'AUTO');
  const kinds = (await deliveriesOf(incident.id)).map(r => r.kind);
  assert.equal(kinds.filter(k => k === 'RESOLVED').length, 2, 'recovery goes to the same channels');
  const replay = await incidents.ingestSignal(prisma, signal());
  assert.equal(replay.action, 'ignored_replay', 'same startsAt as the resolved episode');
  assert.equal(await prisma.system_incidents.count(), 1);
});

test('a new episode within the reopen window reopens the incident (occurrence_count) and respects the cooldown', { skip }, async () => {
  const created = await incidents.ingestSignal(prisma, signal());
  await incidents.ingestSignal(prisma, signal({ status: 'resolved', endsAt: new Date() }));
  const reopened = await incidents.ingestSignal(prisma, signal({ startsAt: new Date('2026-11-19T02:00:00Z') }));
  assert.equal(reopened.action, 'reopened');
  assert.equal(reopened.incident.id, created.incident.id);
  assert.equal(reopened.incident.occurrence_count, 2);
  assert.equal(reopened.incident.status, 'OPEN');
  assert.equal(reopened.notification, 'COOLDOWN', 'flapping inside 15 min is recorded, not re-sent');
  const events = await prisma.system_incident_events.findMany({ where: { incident_id: created.incident.id }, orderBy: { created_at: 'asc' } });
  assert.deepEqual(events.map(e => e.event_type), ['DETECTED', 'AUTO_RESOLVED', 'REOPENED', 'NOTIFICATION_SUPPRESSED']);
});

test('severity escalation on an open incident notifies again', { skip }, async () => {
  const created = await incidents.ingestSignal(prisma, signal({ severity: 'WARNING' }));
  const escalated = await incidents.ingestSignal(prisma, signal({ severity: 'CRITICAL' }));
  assert.equal(escalated.action, 'escalated');
  assert.equal(escalated.incident.severity, 'CRITICAL');
  assert.ok((await deliveriesOf(created.incident.id)).length > 2);
});

test('acknowledge and resolve: state machine, actor recorded, stale version refused', { skip }, async () => {
  const { incident } = await incidents.ingestSignal(prisma, signal());
  const actor = { id: 'user-1', name: 'admin01' };
  await assert.rejects(incidents.acknowledge(prisma, incident.id, actor, { version: incident.version + 5 }), (e) => e.code === 'VERSION_CONFLICT');
  const acked = await incidents.acknowledge(prisma, incident.id, actor, { version: incident.version, note: 'đang kiểm tra' });
  assert.equal(acked.status, 'ACKNOWLEDGED');
  assert.equal(acked.acknowledged_by_name, 'admin01');
  await assert.rejects(incidents.acknowledge(prisma, incident.id, actor), (e) => e.code === 'INVALID_STATE');
  const resolved = await incidents.resolveManually(prisma, incident.id, actor, { version: acked.version, note: 'khởi động lại DB' });
  assert.equal(resolved.status, 'RESOLVED');
  assert.equal(resolved.resolution_type, 'MANUAL');
  assert.equal(resolved.resolution_note, 'khởi động lại DB');
  await assert.rejects(incidents.resolveManually(prisma, incident.id, actor), (e) => e.code === 'INVALID_STATE');
  await assert.rejects(incidents.acknowledge(prisma, '00000000-0000-0000-0000-000000000000', actor), (e) => e.statusCode === 404);
});

test('inhibition: while a service is unavailable its other alerts are recorded but not sent', { skip }, async () => {
  await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:down', alertKind: 'availability', title: 'Service metrics unavailable' }));
  const dependent = await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:latency', title: 'Error rate high', severity: 'HIGH' }));
  assert.equal(dependent.notification, 'INHIBITED');
  assert.equal((await deliveriesOf(dependent.incident.id)).length, 0);
});

test('business alerts go in-app only by default; no enabled channel is recorded instead of silently dropped', { skip }, async () => {
  const business = await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:low-stock', ruleUid: 'smartbook-low-stock-critical', category: 'BUSINESS', severity: 'WARNING' }));
  assert.deepEqual((await deliveriesOf(business.incident.id)).map(r => r.channel), ['IN_APP']);
  await prisma.alert_channel_configs.updateMany({ data: { enabled: false } });
  const none = await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:nochannel' }));
  assert.equal(none.notification, 'NO_CHANNEL');
  const events = await prisma.system_incident_events.findMany({ where: { incident_id: none.incident.id } });
  assert.ok(events.some(e => e.event_type === 'NOTIFICATION_SKIPPED'));
});

test('healthcheck reports the full state: a problem that disappears is auto-resolved', { skip }, async () => {
  const { parseHealthcheckPayload } = require('../src/domain/alerts');
  await incidents.ingestHealthcheck(prisma, parseHealthcheckPayload({ problems: ['container borrow-service is exited', 'root disk 90% full'] }));
  assert.equal(await prisma.system_incidents.count({ where: { status: 'OPEN' } }), 2);
  await incidents.ingestHealthcheck(prisma, parseHealthcheckPayload({ problems: ['root disk 91% full'] }));
  assert.equal(await prisma.system_incidents.count({ where: { status: 'OPEN' } }), 1, 'same disk problem keeps its incident');
  const borrow = await prisma.system_incidents.findFirst({ where: { service_name: 'borrow-service' } });
  assert.equal(borrow.status, 'RESOLVED');
  await incidents.ingestHealthcheck(prisma, parseHealthcheckPayload({ problems: [] }));
  assert.equal(await prisma.system_incidents.count({ where: { status: { not: 'RESOLVED' } } }), 0);
});

test('delivery worker: SMTP failure retries with backoff, then succeeds; attempt history is kept', { skip }, async () => {
  const { incident } = await incidents.ingestSignal(prisma, signal());
  let calls = 0;
  senders.setTransporter({ sendMail: async () => { calls += 1; if (calls === 1) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); return {}; } });
  const originalPush = senders.SENDERS.IN_APP;
  senders.SENDERS.IN_APP = (config, inc, kind, options) => originalPush(config, inc, kind, { ...options, push: async () => false });
  process.env.SMTP_HOST = 'smtp.test';
  try {
    let clock = new Date();
    const now = () => clock;
    const first = await delivery.runOnce(prisma, { now, random: () => 0.5 });
    const email = (await deliveriesOf(incident.id)).find(r => r.channel === 'EMAIL');
    assert.equal(email.status, 'RETRY');
    assert.equal(email.attempt_count, 1);
    assert.equal(email.last_error, 'ECONNREFUSED');
    assert.equal(Math.round((email.next_attempt_at - clock) / 1000), 30, 'first retry after ~30s');
    assert.equal(first.length, 2);
    assert.equal(await delivery.runOnce(prisma, { now, random: () => 0.5 }).then(r => r.length), 0, 'not due yet');
    clock = new Date(clock.getTime() + 31_000);
    await delivery.runOnce(prisma, { now, random: () => 0.5 });
    const sent = (await deliveriesOf(incident.id)).find(r => r.channel === 'EMAIL');
    assert.equal(sent.status, 'SENT');
    const attempts = await prisma.alert_delivery_attempts.findMany({ where: { delivery_id: sent.id }, orderBy: { attempt_no: 'asc' } });
    assert.deepEqual(attempts.map(a => a.outcome), ['RETRY', 'SENT']);
  } finally {
    senders.SENDERS.IN_APP = originalPush;
    senders.setTransporter(null);
    delete process.env.SMTP_HOST;
  }
});

test('delivery worker: in-app is persisted once even when realtime push fails or the delivery is retried', { skip }, async () => {
  const { incident } = await incidents.ingestSignal(prisma, signal());
  const results = await delivery.runOnce(prisma, { senderOptions: { push: async () => false } });
  const inApp = (await deliveriesOf(incident.id)).find(r => r.channel === 'IN_APP');
  assert.equal(inApp.status, 'SENT', 'a stored notification is delivered; the client loads it on reconnect');
  assert.ok(results.some(r => r.errorCode === 'persisted (realtime push failed)'));
  await prisma.alert_deliveries.update({ where: { id: inApp.id }, data: { status: 'RETRY', next_attempt_at: new Date(0) } });
  await delivery.runOnce(prisma, { senderOptions: { push: async () => true } });
  assert.equal(await prisma.system_notifications.count({ where: { incident_id: incident.id } }), 1);
});

test('delivery worker: permanent failures and exhausted retries end DEAD with an incident event', { skip }, async () => {
  const { incident } = await incidents.ingestSignal(prisma, signal());
  delete process.env.SMTP_HOST;
  await delivery.runOnce(prisma, { senderOptions: { push: async () => true } });
  const email = (await deliveriesOf(incident.id)).find(r => r.channel === 'EMAIL');
  assert.equal(email.status, 'DEAD', 'SMTP not configured cannot succeed on retry');
  assert.equal(email.last_error, 'SMTP_NOT_CONFIGURED');
  const events = await prisma.system_incident_events.findMany({ where: { incident_id: incident.id, event_type: 'DELIVERY_FAILED' } });
  assert.equal(events.length, 1);
});

test('a delivery whose worker died mid-send is reclaimed after its lease expires', { skip }, async () => {
  const { incident } = await incidents.ingestSignal(prisma, signal());
  await prisma.alert_deliveries.updateMany({ where: { incident_id: incident.id }, data: { status: 'SENDING', locked_until: new Date(Date.now() - 1000) } });
  const claimed = await delivery.claimDue(prisma);
  assert.equal(claimed.length, 2);
});

test('analytics returns null timings without data and real averages with data', { skip }, async () => {
  const { incidentAnalytics } = require('../src/services/analytics.service');
  const empty = await incidentAnalytics(prisma, { days: 7 });
  assert.equal(empty.total, 0);
  assert.equal(empty.mtta_seconds, null);
  assert.equal(empty.mttr_seconds, null);
  assert.equal(empty.deliveries.success_rate, null);
  const { incident } = await incidents.ingestSignal(prisma, signal({ startsAt: new Date(Date.now() - 60_000) }));
  await prisma.system_incidents.update({ where: { id: incident.id }, data: { first_seen_at: new Date(Date.now() - 600_000) } });
  await incidents.acknowledge(prisma, incident.id, { id: 'u', name: 'u' });
  const stats = await incidentAnalytics(prisma, { days: 7 });
  assert.equal(stats.total, 1);
  assert.ok(stats.mtta_seconds > 590 && stats.mtta_seconds < 700, String(stats.mtta_seconds));
  assert.equal(stats.by_severity[0].key, 'CRITICAL');
});

test('resolved_at never lies outside [first_seen_at, now], whatever endsAt the source sends', { skip }, async () => {
  const future = await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:future' }));
  await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:future', status: 'resolved', endsAt: new Date(Date.now() + 4 * 3_600_000) }));
  const past = await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:past' }));
  await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:past', status: 'resolved', endsAt: new Date('2020-01-01T00:00:00Z') }));
  for (const id of [future.incident.id, past.incident.id]) {
    const row = await prisma.system_incidents.findUnique({ where: { id } });
    assert.ok(row.resolved_at >= row.first_seen_at && row.resolved_at <= new Date(), `${row.fingerprint}: ${row.resolved_at.toISOString()}`);
  }
});

test('an outage whose firing alert was never recorded is kept from its resolved notification (once)', { skip }, async () => {
  const startsAt = new Date(Date.now() - 10 * 60_000);
  const endsAt = new Date(Date.now() - 2 * 60_000);
  const late = await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:db-outage', status: 'resolved', startsAt, endsAt }));
  assert.equal(late.action, 'recorded_late');
  const row = await prisma.system_incidents.findUnique({ where: { id: late.incident.id } });
  assert.equal(row.status, 'RESOLVED');
  assert.equal(row.first_seen_at.toISOString(), startsAt.toISOString());
  assert.equal(row.resolved_at.toISOString(), endsAt.toISOString(), 'real outage duration is kept for MTTR');
  assert.equal(row.labels.detected_late, 'true');
  const kinds = (await deliveriesOf(row.id)).map(d => d.kind);
  assert.ok(kinds.length > 0 && kinds.every(k => k === 'RESOLVED'), 'recipients learn the outage happened');
  assert.equal((await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:db-outage', status: 'resolved', startsAt, endsAt }))).action, 'ignored_replay');
  assert.equal((await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:db-outage', startsAt }))).action, 'ignored_replay');
  assert.equal(await prisma.system_incidents.count({ where: { fingerprint: 'grafana:db-outage' } }), 1);
});

test('a channel disabled after queuing suppresses its pending deliveries instead of failing them', { skip }, async () => {
  const { incident } = await incidents.ingestSignal(prisma, signal({ fingerprint: 'grafana:disabled-channel' }));
  await prisma.alert_channel_configs.updateMany({ where: { channel_type: 'EMAIL' }, data: { enabled: false } });
  await delivery.runOnce(prisma, { senderOptions: { push: async () => true } });
  const email = (await deliveriesOf(incident.id)).find(r => r.channel === 'EMAIL');
  assert.equal(email.status, 'SUPPRESSED');
  assert.equal(await prisma.alert_delivery_attempts.count({ where: { delivery_id: email.id } }), 0);
  assert.equal(await prisma.system_incident_events.count({ where: { incident_id: incident.id, event_type: 'DELIVERY_FAILED' } }), 0);
});
