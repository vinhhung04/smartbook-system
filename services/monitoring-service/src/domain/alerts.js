// Turns an inbound alert source payload into normalized alert signals. Pure: no
// database or network, so validation, severity mapping and fingerprints are unit
// tested directly (test/alerts.test.js).
const crypto = require('node:crypto');

const SEVERITIES = ['CRITICAL', 'HIGH', 'WARNING', 'INFO'];
const CATEGORIES = ['TECHNICAL', 'BUSINESS', 'INFO'];
const SEVERITY_ALIASES = { critical: 'CRITICAL', page: 'CRITICAL', high: 'HIGH', error: 'HIGH', major: 'HIGH', warning: 'WARNING', warn: 'WARNING', minor: 'WARNING', info: 'INFO', informational: 'INFO', none: 'INFO' };
const MAX_ALERTS = 100;
// Only these label keys are kept: they are bounded categories, never payload data.
const KEPT_LABELS = ['alertname', 'severity', 'category', 'service_name', 'owner_role', 'alert_kind', 'grafana_folder', 'job', 'instance', 'queue', 'reason', 'feature', 'endpoint'];

class ValidationError extends Error {
  constructor(message) { super(message); this.statusCode = 400; this.expose = true; }
}

function normalizeSeverity(value) {
  return SEVERITY_ALIASES[String(value || '').trim().toLowerCase()] || 'WARNING';
}

function normalizeCategory(value, severity) {
  const upper = String(value || '').trim().toUpperCase();
  if (CATEGORIES.includes(upper)) return upper;
  return severity === 'INFO' ? 'INFO' : 'TECHNICAL';
}

function text(value, max) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function safeUrl(value) {
  const raw = text(value, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

function timestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  // Grafana sends 0001-01-01T00:00:00Z for "no end time".
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() < 2000 ? null : date;
}

function pickLabels(labels) {
  const kept = {};
  for (const key of KEPT_LABELS) {
    const value = text(labels?.[key], 120);
    if (value) kept[key] = value;
  }
  return kept;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 40);
}

/**
 * Grafana unified-alerting webhook (version "1"). Returns one signal per alert.
 * Grafana's own fingerprint is a stable hash of the alert's label set, so the same
 * rule + labels always map to the same incident.
 */
function parseGrafanaPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('payload must be an object');
  if (!Array.isArray(body.alerts)) throw new ValidationError('alerts must be an array');
  if (body.alerts.length === 0) throw new ValidationError('alerts must not be empty');
  if (body.alerts.length > MAX_ALERTS) throw new ValidationError(`at most ${MAX_ALERTS} alerts per payload`);
  return body.alerts.map((alert, index) => {
    if (!alert || typeof alert !== 'object') throw new ValidationError(`alerts[${index}] must be an object`);
    const status = alert.status === 'resolved' ? 'resolved' : alert.status === 'firing' ? 'firing' : null;
    if (!status) throw new ValidationError(`alerts[${index}].status must be firing or resolved`);
    const labels = alert.labels && typeof alert.labels === 'object' ? alert.labels : {};
    const alertname = text(labels.alertname, 200);
    if (!alertname) throw new ValidationError(`alerts[${index}].labels.alertname is required`);
    const startsAt = timestamp(alert.startsAt);
    if (!startsAt) throw new ValidationError(`alerts[${index}].startsAt is invalid`);
    const grafanaFingerprint = text(alert.fingerprint, 64);
    const severity = normalizeSeverity(labels.severity);
    const annotations = alert.annotations && typeof alert.annotations === 'object' ? alert.annotations : {};
    const kept = pickLabels(labels);
    return {
      source: 'GRAFANA',
      status,
      fingerprint: `grafana:${grafanaFingerprint || hash(JSON.stringify(Object.entries(kept).sort()))}`,
      // Grafana strips internal labels; the rule uid is in generatorURL (/alerting/grafana/<uid>/view).
      ruleUid: text(labels.__alert_rule_uid__ || labels.rule_uid
        || /\/alerting\/grafana\/([A-Za-z0-9_-]+)\/view/.exec(String(alert.generatorURL || ''))?.[1], 100),
      title: alertname,
      severity,
      category: normalizeCategory(labels.category, severity),
      serviceName: text(labels.service_name || labels.service || labels.job, 80) || 'system',
      alertKind: text(labels.alert_kind, 40),
      summary: text(annotations.summary, 1000),
      description: text(annotations.description, 4000),
      runbookUrl: safeUrl(annotations.runbook_url),
      labels: kept,
      startsAt,
      endsAt: status === 'resolved' ? timestamp(alert.endsAt) || new Date() : null,
    };
  });
}

// healthcheck.sh problems are free text such as "root disk 91% full". Numbers are
// stripped from the fingerprint so the same problem keeps one incident while its
// value changes between 5-minute runs.
const HEALTHCHECK_RULES = [
  { pattern: /^container .* is |OOM\/restart|answered \d+/, severity: 'CRITICAL', kind: 'availability' },
  { pattern: /root disk|memory .* used|backup|TLS certificate|no TLS/, severity: 'HIGH', kind: 'capacity' },
  { pattern: /outbox|reconciliation|settlement|dead-letter/, severity: 'HIGH', kind: 'business', category: 'BUSINESS' },
  { pattern: /database (connection|active)/, severity: 'HIGH', kind: 'database' },
];

function classifyHealthcheckProblem(message) {
  const rule = HEALTHCHECK_RULES.find(candidate => candidate.pattern.test(message));
  return { severity: rule?.severity || 'WARNING', alertKind: rule?.kind || 'healthcheck', category: rule?.category || 'TECHNICAL' };
}

function parseHealthcheckPayload(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.problems)) throw new ValidationError('problems must be an array');
  if (body.problems.length > MAX_ALERTS) throw new ValidationError(`at most ${MAX_ALERTS} problems per payload`);
  const observedAt = timestamp(body.observed_at) || new Date();
  const seen = new Set();
  const signals = [];
  for (const raw of body.problems) {
    const message = text(raw, 500);
    if (!message) continue;
    const key = message.replace(/\d+(?:\.\d+)?/g, '#');
    const fingerprint = `healthcheck:${hash(key)}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const container = /^container (\S+)/.exec(message)?.[1];
    const { severity, alertKind, category } = classifyHealthcheckProblem(message);
    signals.push({
      source: 'HEALTHCHECK', status: 'firing', fingerprint, ruleUid: null,
      title: message.slice(0, 200), severity, category,
      serviceName: container || 'vps', alertKind,
      summary: message, description: null, runbookUrl: null,
      labels: { alertname: 'healthcheck', severity: severity.toLowerCase(), alert_kind: alertKind },
      startsAt: observedAt, endsAt: null,
    });
  }
  return { signals, observedAt };
}

module.exports = {
  SEVERITIES, CATEGORIES, ValidationError,
  normalizeSeverity, normalizeCategory, parseGrafanaPayload, parseHealthcheckPayload, classifyHealthcheckProblem,
};
