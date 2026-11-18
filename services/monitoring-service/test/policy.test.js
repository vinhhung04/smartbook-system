const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePolicy, channelsFor, policyWarnings, nextAttemptDelayMs, isRetryable } = require('../src/domain/policy');

const base = { enabled: true, email_enabled: false, in_app_enabled: true, webhook_enabled: false, match_rule_uid: null, match_category: null, match_severity: null };
const policies = [
  { ...base, id: 'catch-all', name: 'Mặc định', created_at: '2026-01-01' },
  { ...base, id: 'critical', name: 'Critical', match_severity: 'CRITICAL', email_enabled: true, webhook_enabled: true, created_at: '2026-01-02' },
  { ...base, id: 'tech-critical', name: 'Tech critical', match_category: 'TECHNICAL', match_severity: 'CRITICAL', email_enabled: true, created_at: '2026-01-03' },
  { ...base, id: 'business', name: 'Business', match_category: 'BUSINESS', created_at: '2026-01-04' },
  { ...base, id: 'low-stock', name: 'Low stock', match_rule_uid: 'smartbook-low-stock-critical', in_app_enabled: false, created_at: '2026-01-05' },
];

test('the most specific enabled policy wins', () => {
  assert.equal(resolvePolicy(policies, { rule_uid: 'smartbook-low-stock-critical', category: 'BUSINESS', severity: 'WARNING' }).id, 'low-stock');
  assert.equal(resolvePolicy(policies, { rule_uid: 'x', category: 'TECHNICAL', severity: 'CRITICAL' }).id, 'tech-critical');
  assert.equal(resolvePolicy(policies, { rule_uid: 'x', category: 'BUSINESS', severity: 'CRITICAL' }).id, 'critical');
  assert.equal(resolvePolicy(policies, { rule_uid: 'x', category: 'BUSINESS', severity: 'WARNING' }).id, 'business');
  assert.equal(resolvePolicy(policies, { rule_uid: 'x', category: 'TECHNICAL', severity: 'INFO' }).id, 'catch-all');
});

test('a disabled policy is skipped, falling back to the next match', () => {
  const disabled = policies.map(p => (p.id === 'tech-critical' ? { ...p, enabled: false } : p));
  assert.equal(resolvePolicy(disabled, { category: 'TECHNICAL', severity: 'CRITICAL' }).id, 'critical');
  assert.equal(resolvePolicy([], { category: 'TECHNICAL', severity: 'CRITICAL' }), null);
});

test('channelsFor lists enabled channels', () => {
  assert.deepEqual(channelsFor(policies[1]), ['EMAIL', 'IN_APP', 'WEBHOOK']);
  assert.deepEqual(channelsFor(null), []);
});

test('warns when a critical group has every channel off or is disabled', () => {
  const warnings = policyWarnings([
    { ...base, id: 'a', name: 'A', match_severity: 'CRITICAL', in_app_enabled: false },
    { ...base, id: 'b', name: 'B', match_severity: 'CRITICAL', enabled: false },
    { ...base, id: 'c', name: 'C', match_severity: 'WARNING', in_app_enabled: false },
  ]);
  assert.deepEqual(warnings.map(w => [w.policy_id, w.code]), [['a', 'CRITICAL_NO_CHANNEL'], ['b', 'CRITICAL_POLICY_DISABLED']]);
});

test('retry backoff grows exponentially with bounded jitter', () => {
  assert.equal(nextAttemptDelayMs(1, () => 0.5), 30_000);
  assert.equal(nextAttemptDelayMs(2, () => 0.5), 120_000);
  assert.equal(nextAttemptDelayMs(3, () => 0), 480_000, '-20% jitter');
  assert.equal(nextAttemptDelayMs(3, () => 1), 720_000, '+20% jitter');
  assert.equal(nextAttemptDelayMs(99, () => 0.5), 86_400_000, 'capped');
});

test('retry classification: network, 5xx, 408 and 429 retry; other 4xx and policy errors do not', () => {
  assert.equal(isRetryable({}), true);
  assert.equal(isRetryable({ statusCode: 503 }), true);
  assert.equal(isRetryable({ statusCode: 429 }), true);
  assert.equal(isRetryable({ statusCode: 408 }), true);
  assert.equal(isRetryable({ statusCode: 404 }), false);
  assert.equal(isRetryable({ statusCode: 400 }), false);
  assert.equal(isRetryable({ permanent: true }), false);
});
