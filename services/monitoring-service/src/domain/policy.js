// Notification routing and retry rules. Pure functions (test/policy.test.js).

// Most specific enabled policy wins: rule uid > category+severity > severity >
// category > catch-all. Ties keep the oldest policy so routing is deterministic.
function policySpecificity(policy) {
  if (policy.match_rule_uid) return 4;
  if (policy.match_category && policy.match_severity) return 3;
  if (policy.match_severity) return 2;
  if (policy.match_category) return 1;
  return 0;
}

function policyMatches(policy, incident) {
  if (!policy.enabled) return false;
  if (policy.match_rule_uid && policy.match_rule_uid !== incident.rule_uid) return false;
  if (policy.match_category && policy.match_category !== incident.category) return false;
  if (policy.match_severity && policy.match_severity !== incident.severity) return false;
  return true;
}

function resolvePolicy(policies, incident) {
  const matches = policies.filter(policy => policyMatches(policy, incident));
  matches.sort((a, b) => policySpecificity(b) - policySpecificity(a)
    || new Date(a.created_at || 0) - new Date(b.created_at || 0));
  return matches[0] || null;
}

function channelsFor(policy) {
  if (!policy) return [];
  return [policy.email_enabled && 'EMAIL', policy.in_app_enabled && 'IN_APP', policy.webhook_enabled && 'WEBHOOK'].filter(Boolean);
}

/** Warnings shown next to the policy editor: a critical group nobody is told about. */
function policyWarnings(policies) {
  const warnings = [];
  for (const policy of policies) {
    const critical = policy.match_severity === 'CRITICAL' || (!policy.match_severity && !policy.match_category && !policy.match_rule_uid);
    if (!critical) continue;
    if (!policy.enabled) warnings.push({ policy_id: policy.id, code: 'CRITICAL_POLICY_DISABLED', message: `Chính sách "${policy.name}" cho cảnh báo nghiêm trọng đang tắt.` });
    else if (channelsFor(policy).length === 0) warnings.push({ policy_id: policy.id, code: 'CRITICAL_NO_CHANNEL', message: `Chính sách "${policy.name}" cho cảnh báo nghiêm trọng không bật kênh nào.` });
  }
  return warnings;
}

const BACKOFF_SECONDS = [30, 120, 600, 1800, 3600, 7200, 14400, 28800, 43200, 86400, 86400, 86400];

/** Delay before attempt `attempt + 1` with +/-20% jitter (random is injectable for tests). */
function nextAttemptDelayMs(attempt, random = Math.random) {
  const base = BACKOFF_SECONDS[Math.min(Math.max(attempt, 1), BACKOFF_SECONDS.length) - 1] * 1000;
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Failure classification for retry: a 4xx (other than 408/429) will not succeed on retry. */
function isRetryable({ statusCode, permanent }) {
  if (permanent) return false;
  if (!statusCode) return true;
  if (statusCode === 408 || statusCode === 429) return true;
  return statusCode >= 500;
}

module.exports = { resolvePolicy, channelsFor, policyWarnings, nextAttemptDelayMs, isRetryable, BACKOFF_SECONDS };
