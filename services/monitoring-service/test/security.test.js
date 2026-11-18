const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { isPublicAddress, validateWebhookUrl, resolvePublicAddress, postJson, webhookHint } = require('../src/lib/webhook-guard');
const secretBox = require('../src/lib/secret-box');
const { emailContent, webhookPayload, escapeHtml } = require('../src/channels/templates');
const { requireIngestToken, can } = require('../src/middlewares/auth.middleware');

test('private, loopback, link-local, metadata and mapped addresses are not public', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  for (const address of ['8.8.8.8', '162.159.135.232', '2606:4700::6810:84e5']) assert.equal(isPublicAddress(address), true, address);
});

test('webhook URL policy: https, allowlisted host, no IPs/ports/credentials, no internal names', () => {
  assert.ok(validateWebhookUrl('https://hooks.slack.com/services/T0/B0/xyz', 'slack'));
  assert.ok(validateWebhookUrl('https://discord.com/api/webhooks/1/abc', 'discord'));
  const rejected = [
    ['http://hooks.slack.com/services/T0/B0/x', 'slack'],
    ['https://evil.example.com/services/x', 'slack'],
    ['https://hooks.slack.com.evil.com/services/x', 'slack'],
    ['https://discord.com/not-webhooks/x', 'discord'],
    ['https://user:pw@hooks.slack.com/services/x', 'slack'],
    ['https://hooks.slack.com:8443/services/x', 'slack'],
    ['https://127.0.0.1/hook', 'generic'],
    ['https://[::1]/hook', 'generic'],
    ['https://example.com/hook', 'generic'],
    ['https://hooks.slack.com/services/x', 'teams'],
    ['not a url', 'slack'],
  ];
  for (const [url, format] of rejected) assert.throws(() => validateWebhookUrl(url, format), (e) => e.statusCode === 400 && e.permanent, url);
  assert.ok(validateWebhookUrl('https://example.com/hook', 'generic', { allowPublic: true }));
  assert.throws(() => validateWebhookUrl('https://grafana.internal/hook', 'generic', { allowPublic: true }), /nội bộ/);
  assert.throws(() => validateWebhookUrl('https://localhost/hook', 'generic', { allowPublic: true }), /nội bộ/);
});

test('DNS that resolves to an internal address is refused (rebinding defence)', async () => {
  await assert.rejects(resolvePublicAddress('hooks.slack.com', async () => [{ address: '10.0.0.5', family: 4 }]), /nội bộ/);
  await assert.rejects(resolvePublicAddress('hooks.slack.com', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), /nội bộ/);
  assert.equal((await resolvePublicAddress('hooks.slack.com', async () => [{ address: '8.8.8.8', family: 4 }])).address, '8.8.8.8');
});

test('postJson connects to the checked address, keeps SNI on the hostname and reports the status', async () => {
  let captured;
  const request = (options, onResponse) => {
    captured = options;
    const req = new EventEmitter();
    req.end = () => {
      const res = new EventEmitter();
      res.statusCode = 204;
      onResponse(res);
      res.emit('close');
    };
    req.destroy = () => {};
    return req;
  };
  const url = validateWebhookUrl('https://hooks.slack.com/services/T0/B0/secret', 'slack');
  const result = await postJson(url, { text: 'x' }, { lookup: async () => [{ address: '8.8.4.4', family: 4 }], request });
  assert.equal(result.statusCode, 204);
  assert.equal(captured.servername, 'hooks.slack.com');
  await new Promise((resolve) => captured.lookup('hooks.slack.com', {}, (err, address) => { assert.equal(address, '8.8.4.4'); resolve(); }));
});

test('webhook hint never exposes the token part of the URL', () => {
  const hint = webhookHint(new URL('https://hooks.slack.com/services/T000/B000/abcdefSECRET1234'));
  assert.equal(hint, 'hooks.slack.com/…1234');
});

test('secrets are sealed with AES-256-GCM and tampering is detected', () => {
  const key = crypto.randomBytes(32);
  const sealed = secretBox.seal('https://hooks.slack.com/services/a/b/c', key);
  assert.doesNotMatch(sealed, /hooks\.slack/);
  assert.equal(secretBox.open(sealed, key), 'https://hooks.slack.com/services/a/b/c');
  const parts = sealed.split(':'); parts[3] = Buffer.from('tampered').toString('base64');
  assert.throws(() => secretBox.open(parts.join(':'), key));
  assert.throws(() => secretBox.seal('x', null), /MONITORING_SECRET_KEY/);
  assert.equal(secretBox.loadKey('short'), null);
});

const incident = { id: '11111111-1111-1111-1111-111111111111', title: '<img src=x onerror=alert(1)>', severity: 'CRITICAL', category: 'TECHNICAL', status: 'OPEN', service_name: 'inventory-service', summary: 'a & b <script>', first_seen_at: new Date('2026-11-19T01:00:00Z'), occurrence_count: 2, runbook_url: 'https://github.com/x/runbook' };

test('email content escapes alert text and carries severity, service and admin link', () => {
  const email = emailContent(incident, 'OPEN');
  assert.match(email.subject, /^\[SmartBook\]\[CRITICAL\]/);
  assert.doesNotMatch(email.html, /<img src=x|<script>/);
  assert.match(email.html, /&lt;img src=x/);
  assert.match(email.html, /\/admin\/monitor\/incidents\/11111111-1111-1111-1111-111111111111/);
  assert.match(email.text, /inventory-service/);
  const recovery = emailContent({ ...incident, status: 'RESOLVED', resolved_at: new Date() }, 'RESOLVED');
  assert.match(recovery.subject, /ĐÃ PHỤC HỒI/);
  assert.equal(escapeHtml(`"'`), '&quot;&#39;');
});

test('Slack and Discord payloads use each provider\'s format; Discord mentions are disabled', () => {
  assert.ok(typeof webhookPayload('slack', incident, 'OPEN').text === 'string');
  const discord = webhookPayload('discord', incident, 'OPEN');
  assert.ok(discord.content && discord.embeds[0].fields.length === 3);
  assert.deepEqual(discord.allowed_mentions, { parse: [] });
  assert.equal(webhookPayload('generic', incident, 'RESOLVED').event, 'incident.resolved');
});

function run(middleware, headers) {
  let status = 200; let nextCalled = false;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  middleware({ headers }, res, () => { nextCalled = true; });
  return { status, nextCalled };
}

test('ingest endpoint requires the exact bearer token and refuses a weak configured token', () => {
  const previous = process.env.MONITORING_INGEST_TOKEN;
  try {
    process.env.MONITORING_INGEST_TOKEN = 'x'.repeat(40);
    assert.equal(run(requireIngestToken, { authorization: `Bearer ${'x'.repeat(40)}` }).nextCalled, true);
    assert.equal(run(requireIngestToken, { authorization: `Bearer ${'x'.repeat(39)}y` }).status, 401);
    assert.equal(run(requireIngestToken, {}).status, 401);
    process.env.MONITORING_INGEST_TOKEN = 'short';
    assert.equal(run(requireIngestToken, { authorization: 'Bearer short' }).status, 401);
  } finally {
    if (previous === undefined) delete process.env.MONITORING_INGEST_TOKEN; else process.env.MONITORING_INGEST_TOKEN = previous;
  }
});

test('authorization: ADMIN and superuser may do everything; permissions grant exactly their level', () => {
  const user = (over) => ({ roles: [], permissions: [], isSuperuser: false, ...over });
  assert.equal(can(user({ roles: ['ADMIN'] }), 'settings'), true);
  assert.equal(can(user({ isSuperuser: true }), 'manage'), true);
  assert.equal(can(user({ permissions: ['monitoring.incidents.read'] }), 'read'), true);
  assert.equal(can(user({ permissions: ['monitoring.incidents.read'] }), 'manage'), false);
  assert.equal(can(user({ permissions: ['monitoring.incidents.manage'] }), 'settings'), false);
  assert.equal(can(user({ roles: ['WAREHOUSE_MANAGER'], permissions: ['audit.read'] }), 'read'), false, 'audit.read no longer opens monitoring');
  assert.equal(can(user({ roles: ['CUSTOMER'] }), 'read'), false);
  assert.equal(can(null, 'read'), false);
});
