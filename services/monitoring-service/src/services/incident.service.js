// Incident lifecycle: OPEN -> ACKNOWLEDGED -> RESOLVED, driven by alert signals
// (Grafana, healthcheck.sh) and by administrators.
//
// Dedup: one unresolved incident per fingerprint (partial unique index). A re-sent
// firing alert only refreshes last_seen_at. A fingerprint that fires again within
// the reopen window after resolving reopens the same incident (occurrence_count+1)
// instead of creating a new one. A signal whose episode (startsAt) is older than
// what the incident already recorded is a replay and is ignored.
const { resolvePolicy, channelsFor } = require('../domain/policy');

const REOPEN_WINDOW_MS = Number(process.env.MONITORING_REOPEN_WINDOW_MINUTES || 30) * 60_000;
const SEVERITY_RANK = { INFO: 0, WARNING: 1, HIGH: 2, CRITICAL: 3 };

class ConflictError extends Error {
  constructor(message, code = 'CONFLICT') { super(message); this.statusCode = 409; this.expose = true; this.code = code; }
}
class NotFoundError extends Error {
  constructor(message = 'Không tìm thấy sự cố') { super(message); this.statusCode = 404; this.expose = true; }
}

function isUniqueViolation(error) {
  return error?.code === 'P2002' || /uq_system_incidents_open_fingerprint/.test(String(error?.message));
}

async function addEvent(tx, incidentId, eventType, { actor, message, payload } = {}) {
  return tx.system_incident_events.create({
    data: { incident_id: incidentId, event_type: eventType, actor_id: actor?.id || null, actor_name: actor?.name || null, message: message || null, payload: payload || {} },
  });
}

/**
 * Creates the delivery rows for one incident event, inside the caller's
 * transaction (an event and its deliveries commit together: nothing is lost if
 * the process dies before the worker sends). Returns a short outcome code.
 */
async function enqueueNotifications(tx, incident, event, kind, { now = new Date() } = {}) {
  if (kind !== 'RESOLVED') {
    // Inhibition: while a service is unavailable, its dependent alerts are recorded but not sent.
    if (incident.alert_kind !== 'availability') {
      const outage = await tx.system_incidents.findFirst({
        where: { id: { not: incident.id }, service_name: incident.service_name, alert_kind: 'availability', status: { not: 'RESOLVED' } },
        select: { id: true, title: true },
      });
      if (outage) {
        await addEvent(tx, incident.id, 'NOTIFICATION_SUPPRESSED', { message: `Đang có sự cố mất kết nối của ${incident.service_name}`, payload: { reason: 'INHIBITED', by_incident_id: outage.id } });
        return 'INHIBITED';
      }
    }
  }
  const policies = await tx.alert_policies.findMany();
  const policy = resolvePolicy(policies, incident);
  if (!policy) {
    await addEvent(tx, incident.id, 'NOTIFICATION_SKIPPED', { payload: { reason: 'NO_POLICY' } });
    return 'NO_POLICY';
  }
  if (kind === 'RESOLVED' && (!policy.notify_on_resolve || !incident.last_notified_at)) return 'RESOLVE_NOT_NOTIFIED';
  if (kind !== 'RESOLVED' && incident.last_notified_at && policy.cooldown_minutes > 0
    && now - new Date(incident.last_notified_at) < policy.cooldown_minutes * 60_000) {
    await addEvent(tx, incident.id, 'NOTIFICATION_SUPPRESSED', { payload: { reason: 'COOLDOWN', policy_id: policy.id, cooldown_minutes: policy.cooldown_minutes } });
    return 'COOLDOWN';
  }
  const wanted = channelsFor(policy);
  const configs = wanted.length ? await tx.alert_channel_configs.findMany({ where: { enabled: true, channel_type: { in: wanted } } }) : [];
  const usable = configs.filter(config => config.channel_type !== 'EMAIL' || (config.config?.recipients || []).length > 0);
  if (!usable.length) {
    await addEvent(tx, incident.id, 'NOTIFICATION_SKIPPED', { payload: { reason: 'NO_ENABLED_CHANNEL', policy_id: policy.id, channels: wanted } });
    return 'NO_CHANNEL';
  }
  await tx.alert_deliveries.createMany({
    data: usable.map(config => ({
      incident_id: incident.id, event_id: event.id, channel_config_id: config.id, channel: config.channel_type,
      kind, max_attempts: config.max_attempts, next_attempt_at: now,
    })),
    skipDuplicates: true,
  });
  if (kind !== 'RESOLVED') await tx.system_incidents.update({ where: { id: incident.id }, data: { last_notified_at: now } });
  return 'QUEUED';
}

function incidentData(signal, now) {
  return {
    fingerprint: signal.fingerprint, source: signal.source, rule_uid: signal.ruleUid, title: signal.title,
    category: signal.category, severity: signal.severity, service_name: signal.serviceName, alert_kind: signal.alertKind,
    summary: signal.summary, description: signal.description, runbook_url: signal.runbookUrl, labels: signal.labels,
    source_started_at: signal.startsAt, first_seen_at: now, last_seen_at: now,
  };
}

async function handleFiring(tx, signal, now) {
  const open = await tx.system_incidents.findFirst({ where: { fingerprint: signal.fingerprint, status: { not: 'RESOLVED' } } });
  if (open) {
    const escalated = SEVERITY_RANK[signal.severity] > SEVERITY_RANK[open.severity];
    const updated = await tx.system_incidents.update({
      where: { id: open.id },
      data: { last_seen_at: now, ...(escalated ? { severity: signal.severity } : {}), summary: signal.summary ?? open.summary, updated_at: now },
    });
    if (escalated) {
      const event = await addEvent(tx, open.id, 'SEVERITY_ESCALATED', { payload: { from: open.severity, to: signal.severity } });
      // An escalation is news: notify regardless of the previous notification time.
      await enqueueNotifications(tx, { ...updated, last_notified_at: null }, event, 'OPEN', { now });
      return { action: 'escalated', incident: updated };
    }
    return { action: 'refreshed', incident: updated };
  }
  const previous = await tx.system_incidents.findFirst({ where: { fingerprint: signal.fingerprint, status: 'RESOLVED' }, orderBy: { resolved_at: 'desc' } });
  if (previous?.source_started_at && signal.startsAt <= previous.source_started_at) {
    return { action: 'ignored_replay', incident: previous };
  }
  if (previous && previous.resolved_at && now - previous.resolved_at < REOPEN_WINDOW_MS) {
    const reopened = await tx.system_incidents.update({
      where: { id: previous.id },
      data: {
        status: 'OPEN', occurrence_count: { increment: 1 }, last_seen_at: now, source_started_at: signal.startsAt,
        severity: signal.severity, summary: signal.summary ?? previous.summary,
        acknowledged_at: null, acknowledged_by: null, acknowledged_by_name: null,
        resolved_at: null, resolved_by: null, resolved_by_name: null, resolution_type: null, resolution_note: null,
        version: { increment: 1 }, updated_at: now,
      },
    });
    const event = await addEvent(tx, reopened.id, 'REOPENED', { payload: { occurrence: reopened.occurrence_count, source: signal.source } });
    const notification = await enqueueNotifications(tx, reopened, event, 'REOPENED', { now });
    return { action: 'reopened', incident: reopened, notification };
  }
  const created = await tx.system_incidents.create({ data: incidentData(signal, now) });
  const event = await addEvent(tx, created.id, 'DETECTED', { payload: { source: signal.source, starts_at: signal.startsAt } });
  // Flapping beyond the reopen window: the previous incident's notification time
  // still counts toward the cooldown of this fingerprint.
  const notification = await enqueueNotifications(tx, { ...created, last_notified_at: previous?.last_notified_at || null }, event, 'OPEN', { now });
  return { action: 'created', incident: created, notification };
}

async function resolveIncident(tx, incident, { now, endsAt, actor, note, type }) {
  // The source's endsAt is trusted only inside [first_seen_at, now]: a skewed or
  // bogus timestamp must not distort MTTR (or resolve "in the future").
  const resolvedAt = endsAt && endsAt <= now && endsAt >= new Date(incident.first_seen_at) ? endsAt : now;
  const resolved = await tx.system_incidents.update({
    where: { id: incident.id },
    data: {
      status: 'RESOLVED', resolved_at: resolvedAt, resolution_type: type,
      resolved_by: actor?.id || null, resolved_by_name: actor?.name || null,
      ...(note ? { resolution_note: note } : {}), version: { increment: 1 }, updated_at: now,
    },
  });
  const event = await addEvent(tx, incident.id, type === 'AUTO' ? 'AUTO_RESOLVED' : 'RESOLVED', { actor, message: note });
  const notification = await enqueueNotifications(tx, resolved, event, 'RESOLVED', { now });
  return { resolved, notification };
}

// The firing notification never reached the database (e.g. PostgreSQL itself was
// down, or this service was): record the episode from its resolved notification
// so the outage stays in the history, and tell the recipients it happened.
async function recordLateEpisode(tx, signal, now) {
  const startedAt = signal.startsAt <= now ? signal.startsAt : now;
  const endedAt = signal.endsAt && signal.endsAt <= now && signal.endsAt >= startedAt ? signal.endsAt : now;
  const created = await tx.system_incidents.create({
    data: {
      ...incidentData(signal, now), labels: { ...signal.labels, detected_late: 'true' },
      first_seen_at: startedAt, last_seen_at: endedAt, status: 'RESOLVED', resolved_at: endedAt, resolution_type: 'AUTO',
    },
  });
  await addEvent(tx, created.id, 'DETECTED_LATE', { message: 'Chỉ nhận được thông báo phục hồi: cảnh báo lúc phát sinh không được ghi nhận (dịch vụ giám sát hoặc cơ sở dữ liệu không khả dụng).', payload: { starts_at: signal.startsAt, ends_at: signal.endsAt } });
  const event = await addEvent(tx, created.id, 'AUTO_RESOLVED', {});
  // Nobody was told it opened: a recovery notice is the only notice, so it is not gated on last_notified_at.
  const notification = await enqueueNotifications(tx, { ...created, last_notified_at: now }, event, 'RESOLVED', { now });
  return { action: 'recorded_late', incident: created, notification };
}

async function handleResolved(tx, signal, now) {
  const open = await tx.system_incidents.findFirst({ where: { fingerprint: signal.fingerprint, status: { not: 'RESOLVED' } } });
  if (!open) {
    if (signal.source !== 'GRAFANA' || !signal.title) return { action: 'ignored_not_open' };
    const known = await tx.system_incidents.findFirst({ where: { fingerprint: signal.fingerprint, source_started_at: { gte: signal.startsAt } }, select: { id: true } });
    return known ? { action: 'ignored_replay' } : recordLateEpisode(tx, signal, now);
  }
  if (open.source_started_at && signal.startsAt < open.source_started_at) return { action: 'ignored_replay', incident: open };
  const { resolved, notification } = await resolveIncident(tx, open, { now, endsAt: signal.endsAt, type: 'AUTO' });
  return { action: 'auto_resolved', incident: resolved, notification };
}

async function ingestSignal(prisma, signal, { now = new Date() } = {}) {
  const run = () => prisma.$transaction(tx => (signal.status === 'resolved' ? handleResolved(tx, signal, now) : handleFiring(tx, signal, now)));
  try {
    return await run();
  } catch (error) {
    // Two deliveries of the same new alert raced; the other one created it.
    if (isUniqueViolation(error)) return run();
    throw error;
  }
}

/** healthcheck.sh reports the complete current problem list every run. */
async function ingestHealthcheck(prisma, { signals, observedAt }, { now = new Date() } = {}) {
  const results = [];
  for (const signal of signals) results.push(await ingestSignal(prisma, signal, { now }));
  const current = signals.map(signal => signal.fingerprint);
  const stale = await prisma.system_incidents.findMany({ where: { source: 'HEALTHCHECK', status: { not: 'RESOLVED' }, fingerprint: { notIn: current } } });
  for (const incident of stale) {
    results.push(await ingestSignal(prisma, { fingerprint: incident.fingerprint, status: 'resolved', startsAt: incident.source_started_at || observedAt, endsAt: observedAt }, { now }));
  }
  return results;
}

async function acknowledge(prisma, id, actor, { version, note } = {}) {
  return prisma.$transaction(async (tx) => {
    const incident = await tx.system_incidents.findUnique({ where: { id } });
    if (!incident) throw new NotFoundError();
    if (incident.status !== 'OPEN') throw new ConflictError(`Sự cố đang ở trạng thái ${incident.status}, không thể tiếp nhận.`, 'INVALID_STATE');
    const result = await tx.system_incidents.updateMany({
      where: { id, status: 'OPEN', ...(version !== undefined ? { version } : {}) },
      data: { status: 'ACKNOWLEDGED', acknowledged_at: new Date(), acknowledged_by: actor.id, acknowledged_by_name: actor.name, version: { increment: 1 }, updated_at: new Date() },
    });
    if (result.count !== 1) throw new ConflictError('Sự cố vừa được người khác cập nhật. Tải lại để xem trạng thái mới.', 'VERSION_CONFLICT');
    await addEvent(tx, id, 'ACKNOWLEDGED', { actor, message: note });
    return tx.system_incidents.findUnique({ where: { id } });
  });
}

async function resolveManually(prisma, id, actor, { version, note } = {}) {
  return prisma.$transaction(async (tx) => {
    const incident = await tx.system_incidents.findUnique({ where: { id } });
    if (!incident) throw new NotFoundError();
    if (incident.status === 'RESOLVED') throw new ConflictError('Sự cố đã được xử lý.', 'INVALID_STATE');
    if (version !== undefined && incident.version !== version) throw new ConflictError('Sự cố vừa được người khác cập nhật. Tải lại để xem trạng thái mới.', 'VERSION_CONFLICT');
    const { resolved } = await resolveIncident(tx, incident, { now: new Date(), actor, note, type: 'MANUAL' });
    return resolved;
  });
}

async function addNote(prisma, id, actor, note) {
  const incident = await prisma.system_incidents.findUnique({ where: { id }, select: { id: true } });
  if (!incident) throw new NotFoundError();
  return addEvent(prisma, id, 'NOTE', { actor, message: note });
}

module.exports = { ingestSignal, ingestHealthcheck, acknowledge, resolveManually, addNote, enqueueNotifications, ConflictError, NotFoundError, REOPEN_WINDOW_MS };
