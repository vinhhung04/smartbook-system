// Administrator API (through the gateway at /monitoring/*). Every route needs a
// valid, non-revoked JWT; reads need monitoring read rights, incident actions
// need manage rights, channel/policy changes need settings rights.
const express = require('express');
const prisma = require('../lib/prisma');
const { authenticateToken, authorize, can } = require('../middlewares/auth.middleware');
const { acknowledge, resolveManually, addNote, NotFoundError } = require('../services/incident.service');
const { incidentAnalytics } = require('../services/analytics.service');
const { prometheusOverview } = require('../services/overview.service');
const { testChannel } = require('../services/delivery.service');
const { policyWarnings } = require('../domain/policy');
const { SEVERITIES, CATEGORIES } = require('../domain/alerts');
const { validateWebhookUrl, webhookHint, FORMATS } = require('../lib/webhook-guard');
const secretBox = require('../lib/secret-box');

const router = express.Router();
router.use(authenticateToken);
router.use(express.json({ limit: '32kb' }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

function badRequest(message) { return Object.assign(new Error(message), { statusCode: 400, expose: true }); }
function actorOf(req) { return { id: req.user.id, name: req.user.name }; }
function idParam(req) {
  if (!UUID.test(req.params.id)) throw new NotFoundError('Không tìm thấy');
  return req.params.id;
}
function list(value, allowed) {
  if (!value) return undefined;
  const items = String(value).split(',').map(v => v.trim().toUpperCase()).filter(Boolean);
  if (items.some(item => !allowed.includes(item))) throw badRequest(`Giá trị lọc không hợp lệ: ${value}`);
  return items.length ? items : undefined;
}
function paging(query, max = 100) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(max, Math.max(1, Number.parseInt(query.page_size, 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}
function note(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('Ghi chú phải là chuỗi');
  const trimmed = value.trim();
  if (trimmed.length > 2000) throw badRequest('Ghi chú tối đa 2000 ký tự');
  return trimmed || null;
}
function version(value) {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw badRequest('version không hợp lệ');
  return number;
}
async function audit(req, action, entityType, entityId, changes = {}) {
  await prisma.monitoring_audit_logs.create({ data: { actor_id: req.user.id, actor_name: req.user.name, action, entity_type: entityType, entity_id: entityId, changes, request_id: req.requestId || null } });
}
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/me', (req, res) => res.json({ can: { read: can(req.user, 'read'), manage: can(req.user, 'manage'), settings: can(req.user, 'settings') } }));

// ---- overview, incidents -------------------------------------------------------
router.get('/overview', authorize('read'), wrap(async (_req, res) => {
  const [prometheus, openRows, recent] = await Promise.all([
    prometheusOverview(),
    prisma.system_incidents.groupBy({ by: ['severity', 'service_name'], _count: { _all: true }, where: { status: { not: 'RESOLVED' } } }),
    prisma.system_incident_events.findMany({
      orderBy: { created_at: 'desc' }, take: 10,
      select: { id: true, event_type: true, created_at: true, actor_name: true, incident: { select: { id: true, title: true, severity: true, service_name: true } } },
    }),
  ]);
  const bySeverity = Object.fromEntries(SEVERITIES.map(s => [s, 0]));
  const byService = {};
  for (const row of openRows) {
    bySeverity[row.severity] += row._count._all;
    byService[row.service_name] = (byService[row.service_name] || 0) + row._count._all;
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    incidents: { open: Object.values(bySeverity).reduce((a, b) => a + b, 0), by_severity: bySeverity, open_by_service: byService },
    recent_activity: recent, prometheus,
  });
}));

router.get('/incidents', authorize('read'), wrap(async (req, res) => {
  const { page, pageSize, skip } = paging(req.query);
  const where = {};
  const status = list(req.query.status, STATUSES); if (status) where.status = { in: status };
  const severity = list(req.query.severity, SEVERITIES); if (severity) where.severity = { in: severity };
  const category = list(req.query.category, CATEGORIES); if (category) where.category = { in: category };
  if (req.query.service) where.service_name = String(req.query.service).slice(0, 80);
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) where.OR = [{ title: { contains: q, mode: 'insensitive' } }, { summary: { contains: q, mode: 'insensitive' } }, { service_name: { contains: q, mode: 'insensitive' } }];
  const [items, total, services] = await Promise.all([
    prisma.system_incidents.findMany({ where, orderBy: [{ first_seen_at: 'desc' }], skip, take: pageSize }),
    prisma.system_incidents.count({ where }),
    prisma.system_incidents.findMany({ distinct: ['service_name'], select: { service_name: true }, orderBy: { service_name: 'asc' } }),
  ]);
  res.json({ items, total, page, page_size: pageSize, services: services.map(s => s.service_name) });
}));

router.get('/incidents/:id', authorize('read'), wrap(async (req, res) => {
  const incident = await prisma.system_incidents.findUnique({
    where: { id: idParam(req) },
    include: {
      events: { orderBy: { created_at: 'asc' } },
      deliveries: { orderBy: { created_at: 'asc' }, include: { attempts: { orderBy: { attempt_no: 'asc' } }, channel_config: { select: { name: true, channel_type: true, secret_hint: true } } } },
    },
  });
  if (!incident) throw new NotFoundError();
  res.set('Cache-Control', 'no-store');
  res.json(incident);
}));

router.post('/incidents/:id/acknowledge', authorize('manage'), wrap(async (req, res) => {
  const incident = await acknowledge(prisma, idParam(req), actorOf(req), { version: version(req.body?.version), note: note(req.body?.note) });
  res.json(incident);
}));

router.post('/incidents/:id/resolve', authorize('manage'), wrap(async (req, res) => {
  const incident = await resolveManually(prisma, idParam(req), actorOf(req), { version: version(req.body?.version), note: note(req.body?.note) });
  res.json(incident);
}));

router.post('/incidents/:id/notes', authorize('manage'), wrap(async (req, res) => {
  const text = note(req.body?.note);
  if (!text) throw badRequest('Ghi chú không được để trống');
  res.status(201).json(await addNote(prisma, idParam(req), actorOf(req), text));
}));

router.get('/analytics', authorize('read'), wrap(async (req, res) => {
  res.json(await incidentAnalytics(prisma, { days: req.query.days }));
}));

router.get('/deliveries', authorize('read'), wrap(async (req, res) => {
  const { page, pageSize, skip } = paging(req.query);
  const where = {};
  if (req.query.incident_id) { if (!UUID.test(req.query.incident_id)) throw badRequest('incident_id không hợp lệ'); where.incident_id = req.query.incident_id; }
  const status = list(req.query.status, ['PENDING', 'SENDING', 'RETRY', 'SENT', 'DEAD', 'SUPPRESSED']); if (status) where.status = { in: status };
  const [items, total] = await Promise.all([
    prisma.alert_deliveries.findMany({ where, orderBy: { created_at: 'desc' }, skip, take: pageSize, include: { incident: { select: { id: true, title: true, severity: true } }, channel_config: { select: { name: true, channel_type: true } } } }),
    prisma.alert_deliveries.count({ where }),
  ]);
  res.json({ items, total, page, page_size: pageSize });
}));

// ---- in-app notifications (monitoring audience only) ---------------------------
router.get('/notifications', authorize('read'), wrap(async (req, res) => {
  const { page, pageSize, skip } = paging(req.query, 50);
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  const userId = req.user.id;
  const where = unreadOnly ? { reads: { none: { user_id: userId } } } : {};
  const [rows, total, unread] = await Promise.all([
    prisma.system_notifications.findMany({ where, orderBy: { created_at: 'desc' }, skip, take: pageSize, include: { reads: { where: { user_id: userId }, select: { read_at: true } } } }),
    prisma.system_notifications.count({ where }),
    prisma.system_notifications.count({ where: { reads: { none: { user_id: userId } } } }),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({
    items: rows.map(({ reads, ...row }) => ({ ...row, read_at: reads[0]?.read_at || null })),
    total, unread_count: unread, page, page_size: pageSize,
  });
}));

router.post('/notifications/read-all', authorize('read'), wrap(async (req, res) => {
  const unread = await prisma.system_notifications.findMany({ where: { reads: { none: { user_id: req.user.id } } }, select: { id: true } });
  await prisma.system_notification_reads.createMany({ data: unread.map(({ id }) => ({ notification_id: id, user_id: req.user.id })), skipDuplicates: true });
  res.json({ marked: unread.length, unread_count: 0 });
}));

router.post('/notifications/:id/read', authorize('read'), wrap(async (req, res) => {
  const id = idParam(req);
  const exists = await prisma.system_notifications.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new NotFoundError('Không tìm thấy thông báo');
  await prisma.system_notification_reads.createMany({ data: [{ notification_id: id, user_id: req.user.id }], skipDuplicates: true });
  const unread = await prisma.system_notifications.count({ where: { reads: { none: { user_id: req.user.id } } } });
  res.json({ id, unread_count: unread });
}));

// ---- policies ------------------------------------------------------------------
function policyInput(body, { partial = false } = {}) {
  const data = {};
  const bool = key => { if (body[key] !== undefined) { if (typeof body[key] !== 'boolean') throw badRequest(`${key} phải là true/false`); data[key] = body[key]; } };
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name || name.length > 120) throw badRequest('Tên chính sách bắt buộc, tối đa 120 ký tự');
    data.name = name;
  }
  if (body.description !== undefined) data.description = body.description ? String(body.description).slice(0, 500) : null;
  for (const [key, allowed] of [['match_category', CATEGORIES], ['match_severity', SEVERITIES]]) {
    if (body[key] !== undefined) {
      if (body[key] !== null && !allowed.includes(body[key])) throw badRequest(`${key} không hợp lệ`);
      data[key] = body[key];
    }
  }
  if (body.match_rule_uid !== undefined) data.match_rule_uid = body.match_rule_uid ? String(body.match_rule_uid).slice(0, 100) : null;
  ['email_enabled', 'in_app_enabled', 'webhook_enabled', 'notify_on_resolve', 'enabled'].forEach(bool);
  if (body.cooldown_minutes !== undefined) {
    const value = Number(body.cooldown_minutes);
    if (!Number.isInteger(value) || value < 0 || value > 1440) throw badRequest('cooldown_minutes phải từ 0 đến 1440');
    data.cooldown_minutes = value;
  }
  return data;
}

async function policiesResponse() {
  const policies = await prisma.alert_policies.findMany({ orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }] });
  return { items: policies, warnings: policyWarnings(policies) };
}

router.get('/policies', authorize('read'), wrap(async (_req, res) => res.json(await policiesResponse())));

router.post('/policies', authorize('settings'), wrap(async (req, res) => {
  const data = policyInput(req.body || {});
  const policy = await prisma.alert_policies.create({ data: { ...data, updated_by: req.user.id } });
  await audit(req, 'POLICY_CREATED', 'alert_policy', policy.id, data);
  res.status(201).json({ policy, ...(await policiesResponse()) });
}));

router.patch('/policies/:id', authorize('settings'), wrap(async (req, res) => {
  const id = idParam(req);
  const data = policyInput(req.body || {}, { partial: true });
  const existing = await prisma.alert_policies.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Không tìm thấy chính sách');
  const policy = await prisma.alert_policies.update({ where: { id }, data: { ...data, updated_by: req.user.id, updated_at: new Date() } });
  await audit(req, 'POLICY_UPDATED', 'alert_policy', id, data);
  res.json({ policy, ...(await policiesResponse()) });
}));

router.delete('/policies/:id', authorize('settings'), wrap(async (req, res) => {
  const id = idParam(req);
  const existing = await prisma.alert_policies.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Không tìm thấy chính sách');
  if (existing.is_default) throw Object.assign(new Error('Không xóa chính sách mặc định; hãy tắt hoặc chỉnh sửa.'), { statusCode: 409, expose: true });
  await prisma.alert_policies.delete({ where: { id } });
  await audit(req, 'POLICY_DELETED', 'alert_policy', id, { name: existing.name });
  res.json(await policiesResponse());
}));

// ---- channels ------------------------------------------------------------------
function publicChannel(config) {
  const { secret_ciphertext: _secret, ...rest } = config;
  return { ...rest, has_secret: Boolean(config.secret_ciphertext) };
}

function recipientsInput(value) {
  if (!Array.isArray(value)) throw badRequest('recipients phải là danh sách email');
  const cleaned = [...new Set(value.map(v => String(v).trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length > 20) throw badRequest('Tối đa 20 người nhận');
  const invalid = cleaned.find(email => !EMAIL.test(email) || email.length > 150);
  if (invalid) throw badRequest(`Email không hợp lệ: ${invalid}`);
  return cleaned;
}

function channelInput(body, existing) {
  const type = existing?.channel_type || body.channel_type;
  if (!['EMAIL', 'WEBHOOK'].includes(type) && !existing) throw badRequest('Chỉ tạo được kênh EMAIL hoặc WEBHOOK');
  const data = {};
  if (body.name !== undefined || !existing) {
    const name = String(body.name || '').trim();
    if (!name || name.length > 120) throw badRequest('Tên kênh bắt buộc, tối đa 120 ký tự');
    data.name = name;
  }
  if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') throw badRequest('enabled phải là true/false'); data.enabled = body.enabled; }
  if (body.max_attempts !== undefined) {
    const value = Number(body.max_attempts);
    if (!Number.isInteger(value) || value < 1 || value > 12) throw badRequest('Số lần thử tối đa từ 1 đến 12');
    data.max_attempts = value;
  }
  if (type === 'EMAIL' && (body.recipients !== undefined || !existing)) data.config = { recipients: recipientsInput(body.recipients || []) };
  if (type === 'WEBHOOK') {
    const format = body.format ?? existing?.config?.format;
    if (!FORMATS[format]) throw badRequest('format phải là slack, discord hoặc generic');
    if (body.url !== undefined || !existing) {
      const url = validateWebhookUrl(body.url, format);
      data.secret_ciphertext = secretBox.seal(url.toString());
      data.secret_hint = webhookHint(url);
    } else if (body.format !== undefined && existing?.secret_ciphertext) {
      // Re-validate the stored URL against the new format's allowlist.
      validateWebhookUrl(secretBox.open(existing.secret_ciphertext), format);
    }
    data.config = { format };
  }
  return { type, data };
}

router.get('/channels', authorize('read'), wrap(async (_req, res) => {
  const configs = await prisma.alert_channel_configs.findMany({ orderBy: [{ channel_type: 'asc' }, { created_at: 'asc' }] });
  res.json({
    items: configs.map(publicChannel),
    smtp_configured: Boolean(process.env.SMTP_HOST),
    secret_key_configured: Boolean(secretBox.loadKey()),
    webhook_formats: Object.keys(FORMATS).filter(format => format !== 'generic' || process.env.MONITORING_WEBHOOK_ALLOW_PUBLIC === 'true'),
  });
}));

router.post('/channels', authorize('settings'), wrap(async (req, res) => {
  const { type, data } = channelInput(req.body || {});
  const config = await prisma.alert_channel_configs.create({ data: { ...data, channel_type: type, updated_by: req.user.id } });
  await audit(req, 'CHANNEL_CREATED', 'alert_channel', config.id, { channel_type: type, name: data.name, enabled: config.enabled, recipients: data.config?.recipients?.length, format: data.config?.format, secret_hint: data.secret_hint });
  res.status(201).json(publicChannel(config));
}));

router.patch('/channels/:id', authorize('settings'), wrap(async (req, res) => {
  const id = idParam(req);
  const existing = await prisma.alert_channel_configs.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Không tìm thấy kênh');
  const { data } = channelInput(req.body || {}, existing);
  const config = await prisma.alert_channel_configs.update({ where: { id }, data: { ...data, updated_by: req.user.id, updated_at: new Date() } });
  await audit(req, 'CHANNEL_UPDATED', 'alert_channel', id, { name: data.name, enabled: data.enabled, max_attempts: data.max_attempts, recipients: data.config?.recipients?.length, format: data.config?.format, secret_replaced: Boolean(data.secret_ciphertext) });
  res.json(publicChannel(config));
}));

router.delete('/channels/:id', authorize('settings'), wrap(async (req, res) => {
  const id = idParam(req);
  const existing = await prisma.alert_channel_configs.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Không tìm thấy kênh');
  if (existing.channel_type === 'IN_APP') throw Object.assign(new Error('Không xóa kênh trong ứng dụng; có thể tắt.'), { statusCode: 409, expose: true });
  await prisma.alert_channel_configs.delete({ where: { id } });
  await audit(req, 'CHANNEL_DELETED', 'alert_channel', id, { name: existing.name, channel_type: existing.channel_type });
  res.json({ deleted: id });
}));

router.post('/channels/:id/test', authorize('settings'), wrap(async (req, res) => {
  const id = idParam(req);
  const config = await prisma.alert_channel_configs.findUnique({ where: { id } });
  if (!config) throw new NotFoundError('Không tìm thấy kênh');
  const result = await testChannel(prisma, config, { actor: actorOf(req) });
  await audit(req, 'CHANNEL_TESTED', 'alert_channel', id, { status: result.status });
  res.status(result.status === 'SENT' ? 200 : 502).json(result);
}));

module.exports = router;
