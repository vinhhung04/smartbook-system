import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/shell-boundaries.sh');

function bashPath() {
  if (process.platform !== 'win32') return '/bin/bash';
  const candidates = [process.env.SMARTBOOK_TEST_BASH, 'C:/Program Files/Git/bin/bash.exe'];
  const bash = candidates.find((candidate) => candidate && existsSync(candidate));
  assert.ok(bash, 'Git Bash is required for these sandbox tests; do not silently skip');
  return bash;
}

// Every generated file stays under .git. The production script is copied verbatim
// apart from newline normalization; only its external-command boundary is replaced.
// No real .env, credentials, Docker socket, provider, database, or backup is used.
// Fixtures intentionally remain for diagnosis; this helper contains no cleanup.
export function runShellSandbox(script, { scenario = 'success', args = [], prepare } = {}) {
  assert.ok(['backup.sh', 'healthcheck.sh', 'deploy.sh', 'restore.sh', 'prepare-volumes.sh'].includes(script));
  const parent = resolve(root, '.git/production-readiness-shell-tests');
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(resolve(parent, `${script.replace('.sh', '')}-`));
  const scripts = resolve(directory, 'deploy/scripts');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(resolve(directory, 'state'));
  mkdirSync(resolve(directory, 'state/images'));
  writeFileSync(resolve(directory, `state/images/${'b'.repeat(40)}.env`),
    ['inventory-service', 'auth-service', 'borrow-service', 'analytics-service', 'ai-service', 'api-gateway', 'web', 'caddy', 'monitoring-service']
      .map(service => `${service.toUpperCase().replaceAll('-', '_')}_IMAGE=ghcr.io/vinhhung04/smartbook-${service}@sha256:${'c'.repeat(64)}`).join('\n') + '\n');
  mkdirSync(resolve(directory, 'backups'));
  writeFileSync(resolve(directory, '.env'), '# Sandbox sentinel; contains no credentials.\n');
  writeFileSync(resolve(directory, 'compose.prod.yml'), '# Sandbox compose fixture\n');
  writeFileSync(resolve(directory, 'deploy/Caddyfile'), '# sandbox Caddy fixture\n');
  writeFileSync(resolve(scripts, script), readFileSync(resolve(root, 'deploy/scripts', script), 'utf8').replace(/\r\n/g, '\n'));
  writeFileSync(resolve(scripts, 'lib.sh'), readFileSync(fixtures, 'utf8').replace(/\r\n/g, '\n'));
  if (script === 'deploy.sh') {
    // Owner-job safety has its own real-script sandbox contracts. Deployment
    // rollback tests isolate that subprocess boundary without starting Docker.
    writeFileSync(resolve(scripts, 'prepare-volumes.sh'), '#!/usr/bin/env bash\nprintf "OWNER_PREP_CALLED\\n" >> "$(dirname "${BASH_SOURCE[0]}")/../../calls.log"\n');
  }
  prepare?.(directory);
  const result = spawnSync(bashPath(), [`deploy/scripts/${script}`, ...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
    env: {
      PATH: process.platform === 'win32' ? `${resolve(root, '.git/ops-tools')};${process.env.PATH}` : process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: directory,
      TMPDIR: directory,
      MSYS_NO_PATHCONV: '1',
      OPS_TEST_SCENARIO: scenario,
    },
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, null, `sandbox aborted: ${result.stderr}`);
  const trace = readFileSync(resolve(directory, 'calls.log'), 'utf8');
  assert.doesNotMatch(trace, /^UNEXPECTED |^DELETION_DENIED /m, `sandbox boundary rejected an unexpected command:\n${trace}`);
  return { ...result, directory, trace };
}
