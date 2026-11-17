import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, delimiter } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { root, envFile, assertIsolated } from '../scripts/testing/environment.mjs';

const valid = {
  COMPOSE_PROJECT_NAME: 'smartbook-qa-aabbccdd', SMARTBOOK_TEST_ISOLATED: '1',
  COMPOSE_FILE: [resolve(root, 'docker-compose.yml'), resolve(root, 'docker-compose.test.yml')].join(delimiter),
  COMPOSE_ENV_FILES: envFile, DB_HOST: 'db', GATEWAY_URL: 'http://localhost:13000',
  OPENROUTER_API_KEY: '', GOOGLE_BOOKS_API_KEY: '',
};
test('the disposable QA project is allowed', () => assert.doesNotThrow(() => assertIsolated(valid)));
for (const [field, value] of [
  ['COMPOSE_PROJECT_NAME', 'smartbook-system'], ['SMARTBOOK_TEST_ISOLATED', '0'],
  ['COMPOSE_FILE', resolve(root, 'compose.prod.yml')], ['COMPOSE_ENV_FILES', resolve(root, '.env')],
  ['DB_HOST', 'production-db'], ['GATEWAY_URL', 'https://example.com'],
  ['OPENROUTER_API_KEY', 'unexpected-credential'],
]) test(`QA refuses an unsafe ${field}`, () => assert.throws(() => assertIsolated({ ...valid, [field]: value })));
test('CI retains all branch triggers and adds manual execution', () => {
  const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /push:\s*branches: \[main, hungg, khoa\]/);
  assert.match(ci, /pull_request:\s*branches: \[main, hungg, khoa\]/);
  assert.match(ci, /workflow_dispatch:/);
  assert.doesNotMatch(ci, /continue-on-error:\s*true/);
});
test('all offline integration flows are scheduled exactly once, with explicit AI-only exceptions', () => {
  const flows = JSON.parse(readFileSync(resolve(root, 'scripts/testing/integration-flows.json'), 'utf8'));
  assert.equal(new Set(flows).size, flows.length);
  const liveModelOnly = new Set(['ai-assistant-integration.mjs', 'cover-search-integration.mjs']);
  for (const name of readdirSync(resolve(root, 'scripts')).filter(n => n.endsWith('-integration.mjs'))) {
    if (!liveModelOnly.has(name)) assert.ok(flows.includes(name), `unscheduled offline integration flow: ${name}`);
  }
  for (const required of ['warehouse-transfer-lifecycle-integration.mjs', 'concurrent-goods-receipt-posting-integration.mjs', 'borrow-renewal-fine-concurrency-integration.mjs', 'return-loan-partial-failure-audit.mjs']) assert.ok(flows.includes(required));
  for (const flow of flows) assert.ok(readFileSync(resolve(root, 'scripts', flow), 'utf8').length > 0);
});
