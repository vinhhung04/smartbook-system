// One sender per channel. Each resolves to { statusCode?, note? } on success and
// throws on failure (error.statusCode / error.permanent drive the retry decision).
const nodemailer = require('nodemailer');
const { emailContent, webhookPayload, inAppContent } = require('./templates');
const { validateWebhookUrl, postJson } = require('../lib/webhook-guard');
const secretBox = require('../lib/secret-box');

let transporter = null;
function getTransporter() {
  const host = process.env.SMTP_HOST || '';
  if (!host) return null;
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host, port, secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
    });
  }
  return transporter;
}
function setTransporter(next) { transporter = next; }

function permanent(message, extra = {}) {
  return Object.assign(new Error(message), { permanent: true, ...extra });
}

async function sendEmail(config, incident, kind) {
  const transport = getTransporter();
  if (!transport) throw permanent('SMTP_NOT_CONFIGURED');
  const recipients = (config.config?.recipients || []).filter(Boolean);
  if (!recipients.length) throw permanent('NO_RECIPIENTS');
  const content = emailContent(incident, kind);
  try {
    await transport.sendMail({ from: process.env.SMTP_FROM || 'SmartBook Monitoring <noreply@smartbook.io.vn>', to: recipients, subject: content.subject, html: content.html, text: content.text });
    return { note: `sent to ${recipients.length} recipient(s)` };
  } catch (error) {
    // SMTP 5xx (e.g. 550 mailbox unavailable) will not succeed on retry; 4xx and network errors may.
    const code = Number(error.responseCode);
    throw Object.assign(new Error(error.code || (code ? `SMTP_${code}` : 'SMTP_ERROR')), { permanent: code >= 500 && code < 600 });
  }
}

async function sendWebhook(config, incident, kind, options = {}) {
  if (!config.secret_ciphertext) throw permanent('WEBHOOK_URL_MISSING');
  const format = config.config?.format || 'generic';
  const url = validateWebhookUrl(secretBox.open(config.secret_ciphertext), format);
  const { statusCode } = await postJson(url, webhookPayload(format, incident, kind), options);
  if (statusCode >= 200 && statusCode < 300) return { statusCode };
  throw Object.assign(new Error(`HTTP_${statusCode}`), { statusCode });
}

/**
 * In-app: the notification is persisted first (unique per incident event, so a
 * retried delivery never duplicates it), then pushed to connected monitoring
 * users through the gateway. A failed push is not a failed delivery: the row is
 * already stored and the client loads it on reconnect.
 */
async function sendInApp(_config, incident, kind, { prisma, eventId, push = pushRealtime } = {}) {
  const content = inAppContent(incident, kind);
  const notification = await prisma.system_notifications.upsert({
    where: { event_id: eventId },
    create: { incident_id: incident.id, event_id: eventId, kind, severity: incident.severity, title: content.title, body: content.body },
    update: {},
  });
  const pushed = await push('incident:notification', {
    id: notification.id, incident_id: incident.id, kind, severity: incident.severity,
    title: notification.title, body: notification.body, created_at: notification.created_at,
  });
  return { note: pushed ? 'persisted+pushed' : 'persisted (realtime push failed)' };
}

async function pushRealtime(event, data) {
  const gateway = process.env.GATEWAY_URL;
  if (!gateway) return false;
  try {
    const response = await fetch(`${gateway.replace(/\/+$/, '')}/internal/push-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY || '', 'x-service-name': 'monitoring-service' },
      body: JSON.stringify({ room: 'monitoring', event, data }),
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const SENDERS = { EMAIL: sendEmail, WEBHOOK: sendWebhook, IN_APP: sendInApp };

module.exports = { SENDERS, sendEmail, sendWebhook, sendInApp, pushRealtime, setTransporter, getTransporter };
