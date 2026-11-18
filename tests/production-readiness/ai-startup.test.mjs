import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { startAi } from '../../scripts/testing/ai-startup.mjs';

test('QA AI builds then executes the explicit owner migration before starting runtime without rebuild', () => {
  const calls = [];
  startAi((...args) => calls.push(args));
  assert.deepEqual(calls, [
    ['--profile', 'ai', 'build', 'ai-service'],
    ['--profile', 'ai', 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'python', 'ai-service', 'migrate.py'],
    ['--profile', 'ai', 'up', '-d', '--no-build', '--wait', '--wait-timeout', '300', 'ai-service'],
  ]);
  const override = readFileSync(resolve(import.meta.dirname, '../../docker-compose.test.yml'), 'utf8');
  assert.match(override, /ai-service:\s*\r?\n\s+environment:\s*\r?\n\s+AI_SCHEMA_MANAGED_EXTERNALLY: "true"/);
});

test('QA AI migration failure cannot start an unmigrated runtime', () => {
  const calls = [];
  assert.throws(() => startAi((...args) => {
    calls.push(args);
    if (args.includes('migrate.py')) throw new Error('Owner job failed');
  }), /Owner job failed/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(args => !args.includes('up')));
});

test('QA AI build failure cannot run migrations or runtime', () => {
  let calls = 0;
  assert.throws(() => startAi(() => { calls++; throw new Error('Build failed'); }), /Build failed/);
  assert.equal(calls, 1);
});
