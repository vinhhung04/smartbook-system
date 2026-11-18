import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { root, runShellSandbox } from './helpers/shell-sandbox.mjs';

const read = (file) => readFileSync(resolve(root, file), 'utf8');

test('healthcheck reports its full state to monitoring-service and keeps the independent direct webhook', () => {
  const result = runShellSandbox('healthcheck.sh', { args: ['--verbose'] });
  assert.equal(result.status, 1, 'the unhealthy fixture service stays unhealthy');
  assert.match(result.trace, /^DC IMAGE_TAG=\S+ exec -T monitoring-service node src\/cli\/ingest-healthcheck\.js$/m);
  assert.match(result.trace, /CURL .*https:\/\/audit\.invalid\/never-contacted/, 'direct webhook remains the fallback path');
  assert.ok(result.trace.indexOf('ingest-healthcheck') < result.trace.lastIndexOf('audit.invalid'), 'incident state is recorded before the fallback alert');
});

test('monitoring is outside the release gate: never in rollout, started after a healthy release, failure tolerated', () => {
  const deploy = read('deploy/scripts/deploy.sh');
  const rollout = deploy.match(/^rollout\(\) \{(.*)\}$/m)?.[1] || '';
  assert.ok(rollout, 'rollout() must exist');
  assert.doesNotMatch(rollout, /prometheus|grafana|monitoring|MONITORING_SERVICES/);
  assert.match(deploy, /log "release healthy"\r?\n\s+start_monitoring \|\| log "WARNING:/);
  // Unconfigured .env (as on an existing VPS before the upgrade): monitoring is skipped, not failed.
  assert.match(deploy, /MONITORING_DB_PASSWORD[^\n]*MONITORING_INGEST_TOKEN[^\n]*\r?\n\s+log "monitoring not configured/);
});

test('a failed rollout never starts the monitoring stack with the unverified release', () => {
  const result = runShellSandbox('deploy.sh', { args: ['b'.repeat(40)] });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.trace, /05-monitoring-db\.sh|migrate-monitoring|up -d --wait --wait-timeout 300 monitoring-service/);
});

test('backup captures monitoring_db only when it exists, as an optional database', () => {
  const backup = read('deploy/scripts/backup.sh');
  assert.match(backup, /datname='monitoring_db'/);
  assert.match(backup, /"optional_databases":%s/);
  const result = runShellSandbox('backup.sh');
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.trace, /pg_dump -U \S+ -Fc monitoring_db/, 'the fixture cluster has no monitoring_db');
});
