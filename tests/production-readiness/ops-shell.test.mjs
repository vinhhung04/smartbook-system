import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { runShellSandbox } from './helpers/shell-sandbox.mjs';

// Intentional RED contracts until Phase 5. External commands are all sandbox
// boundaries. Passing these tests will not prove a real dump or restore works.
test('PRA-09 full recovery set includes procurement files and a recovery manifest', () => {
  const result = runShellSandbox('backup.sh');
  assert.equal(result.status, 0, result.stderr);
  const folders = readdirSync(resolve(result.directory, 'backups'));
  assert.equal(folders.length, 1);
  const names = readdirSync(resolve(result.directory, 'backups', folders[0]));
  assert.ok(names.some((name) => /procurement.*\.(?:tar\.gz|age|gpg)$/.test(name)), `procurement files absent: ${names.join(', ')}`);
  assert.ok(names.includes('manifest.json'), 'recovery boundary and artifact inventory must be persisted');
});

test('PRA-10 offsite copy failure fails the backup job', () => {
  const result = runShellSandbox('backup.sh', { scenario: 'offsite-copy-failure' });
  assert.match(result.trace, /RCLONE copy /, 'fixture must reach the failure being tested');
  assert.notEqual(result.status, 0, 'offsite upload failed but backup returned success');
});

test('PRA-09 failed restart/readiness after a quiesced backup fails the operation', () => {
  const result = runShellSandbox('backup.sh', { scenario: 'backup-restart-failure', args: ['--quiesce'] });
  assert.match(result.trace, /RCLONE check /, 'capture/offsite verification actually finished');
  assert.match(result.trace, /start --wait --wait-timeout 120 borrow-service/);
  assert.match(result.stdout, /restart after backup failed/);
  assert.notEqual(result.status, 0, 'failed recovery of service availability cannot report success');
});

test('PRA-10 offsite verification failure fails the job and cannot advance offsite freshness', () => {
  const result = runShellSandbox('backup.sh', { scenario: 'offsite-verify-failure' });
  assert.match(result.trace, /RCLONE check /, 'an upload alone is not remote integrity verification');
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(resolve(result.directory, 'state/last_offsite_backup')), false);
});

test('PRA-18 failed webhook delivery does not suppress the next alert', () => {
  const result = runShellSandbox('healthcheck.sh', { scenario: 'alert-delivery-failure', args: ['--verbose'] });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.trace, /CURL .*https:\/\/audit\.invalid\/never-contacted/);
  assert.equal(existsSync(resolve(result.directory, 'state/last_alert')), false, 'failed delivery was recorded as sent');
});

test('PRA-18 successful webhook delivery records a delivery stamp', () => {
  const result = runShellSandbox('healthcheck.sh', { args: ['--verbose'] });
  assert.equal(result.status, 1, 'the unhealthy service remains unhealthy after notification');
  assert.match(readFileSync(resolve(result.directory, 'state/last_alert'), 'utf8'), /^[a-f0-9]+ [0-9]+\n$/);
});

test('PRA-14 failed rollout does not launch an unverified previous image', () => {
  const nextTag = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const result = runShellSandbox('deploy.sh', { args: [nextTag] });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.trace, new RegExp(`DC IMAGE_TAG=${nextTag} up `), 'new release failure must be exercised');
  assert.doesNotMatch(result.trace, /DC IMAGE_TAG=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa up /,
    'no compatibility evidence was provided for the previous image');
});
