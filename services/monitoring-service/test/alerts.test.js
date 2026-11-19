const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGrafanaPayload, parseHealthcheckPayload, normalizeSeverity, normalizeCategory } = require('../src/domain/alerts');

function grafana(overrides = {}, alert = {}) {
  return {
    receiver: 'smartbook-monitoring', status: 'firing', version: '1', groupKey: '{}:{alertname="X"}',
    alerts: [{
      status: 'firing', fingerprint: 'abc123', startsAt: '2026-11-19T01:00:00Z', endsAt: '0001-01-01T00:00:00Z',
      generatorURL: 'http://grafana:3000/alerting/grafana/smartbook-db-unavailable/view?orgId=1',
      labels: { alertname: 'Database unavailable', severity: 'critical', category: 'technical', service_name: 'inventory-service', grafana_folder: 'SmartBook', customer_email: 'leak@example.com' },
      annotations: { summary: 'DB down', runbook_url: 'https://github.com/x/y#db', description: 'details' },
      ...alert,
    }],
    ...overrides,
  };
}

test('Grafana firing alert becomes a normalized signal with a stable fingerprint and rule uid', () => {
  const [signal] = parseGrafanaPayload(grafana());
  assert.equal(signal.status, 'firing');
  assert.equal(signal.fingerprint, 'grafana:abc123');
  assert.equal(signal.ruleUid, 'smartbook-db-unavailable');
  assert.equal(signal.severity, 'CRITICAL');
  assert.equal(signal.category, 'TECHNICAL');
  assert.equal(signal.serviceName, 'inventory-service');
  assert.equal(signal.endsAt, null, 'Grafana zero time means "no end"');
  assert.equal(signal.runbookUrl, 'https://github.com/x/y#db');
});

test('only bounded label keys are stored, never arbitrary label values such as personal data', () => {
  const [signal] = parseGrafanaPayload(grafana());
  assert.equal(signal.labels.customer_email, undefined);
  assert.deepEqual(Object.keys(signal.labels).sort(), ['alertname', 'category', 'grafana_folder', 'service_name', 'severity']);
});

test('resolved alert carries its end time', () => {
  const [signal] = parseGrafanaPayload(grafana({}, { status: 'resolved', endsAt: '2026-11-19T01:05:00Z' }));
  assert.equal(signal.status, 'resolved');
  assert.equal(signal.endsAt.toISOString(), '2026-11-19T01:05:00.000Z');
});

test('invalid payloads are rejected with 400, not partially ingested', () => {
  for (const bad of [null, [], {}, { alerts: [] }, { alerts: 'x' }, grafana({}, { status: 'pending' }), grafana({}, { labels: {} }), grafana({}, { startsAt: 'nope' })]) {
    assert.throws(() => parseGrafanaPayload(bad), (error) => error.statusCode === 400, JSON.stringify(bad));
  }
  assert.throws(() => parseGrafanaPayload({ alerts: Array.from({ length: 101 }, () => grafana().alerts[0]) }), /at most 100/);
});

test('javascript: runbook URLs are dropped', () => {
  const [signal] = parseGrafanaPayload(grafana({}, { annotations: { runbook_url: 'javascript:alert(1)' } }));
  assert.equal(signal.runbookUrl, null);
});

test('severity and category mapping', () => {
  assert.equal(normalizeSeverity('critical'), 'CRITICAL');
  assert.equal(normalizeSeverity('error'), 'HIGH');
  assert.equal(normalizeSeverity('High'), 'HIGH');
  assert.equal(normalizeSeverity('warning'), 'WARNING');
  assert.equal(normalizeSeverity('info'), 'INFO');
  assert.equal(normalizeSeverity(undefined), 'WARNING', 'unknown severity is never silently promoted to critical');
  assert.equal(normalizeCategory('business', 'WARNING'), 'BUSINESS');
  assert.equal(normalizeCategory(undefined, 'INFO'), 'INFO');
  assert.equal(normalizeCategory('nonsense', 'CRITICAL'), 'TECHNICAL');
});

test('healthcheck problems: numbers do not change the fingerprint, duplicates collapse, severity by problem type', () => {
  const first = parseHealthcheckPayload({ problems: ['root disk 86% full', 'container borrow-service is exited', 'container borrow-service is exited'] });
  const second = parseHealthcheckPayload({ problems: ['root disk 91% full'] });
  assert.equal(first.signals.length, 2);
  assert.equal(first.signals[0].fingerprint, second.signals[0].fingerprint);
  assert.equal(first.signals[0].severity, 'HIGH');
  assert.equal(first.signals[1].severity, 'CRITICAL');
  assert.equal(first.signals[1].serviceName, 'borrow-service');
  assert.equal(first.signals[1].alertKind, 'availability');
  const business = parseHealthcheckPayload({ problems: ['inventory outbox FAILED (3)'] }).signals[0];
  assert.equal(business.category, 'BUSINESS');
  assert.throws(() => parseHealthcheckPayload({}), /problems must be an array/);
});
