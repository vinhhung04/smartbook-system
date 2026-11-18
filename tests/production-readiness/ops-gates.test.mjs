import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { root } from './helpers/shell-sandbox.mjs';
import { discoverDatabaseTests } from '../../scripts/testing/mandatory-db.mjs';

const read = (file) => readFileSync(resolve(root, file), 'utf8');
function jobs(source) {
  const section = source.split(/^jobs:\s*\r?$/m)[1] || '';
  const entries = [...section.matchAll(/^  ([a-zA-Z0-9_-]+):\r?$/gm)];
  return new Map(entries.map((match, index) => [match[1], section.slice(match.index, entries[index + 1]?.index)]));
}
function gateSource(workflow, jobName, seen = new Set()) {
  const key = `${workflow}:${jobName}`;
  if (seen.has(key)) return '';
  seen.add(key);
  const block = jobs(read(workflow)).get(jobName);
  assert.ok(block, `missing required job ${key}`);
  const dependencies = block.match(/^    needs:\s*(.+)$/m)?.[1]?.replace(/[\[\]]/g, '').split(/[, ]+/).filter(Boolean) || [];
  const reusable = block.match(/^    uses:\s*\.\/(\.github\/workflows\/[\w.-]+)$/m)?.[1];
  const called = reusable ? [...jobs(read(reusable)).keys()].map((name) => gateSource(reusable, name, seen)).join('\n') : '';
  return [block, called, ...dependencies.map((name) => gateSource(workflow, name, seen))].join('\n');
}

test('PRA-13 image build transitively requires DB, integration, and E2E verification', () => {
  const workflow = '.github/workflows/deploy-production.yml';
  const build = jobs(read(workflow)).get('build');
  assert.ok(build);
  const prerequisites = build.match(/^    needs:\s*(.+)$/m)?.[1]?.replace(/[\[\]]/g, '').split(/[, ]+/).filter(Boolean) || [];
  const gate = prerequisites.map((name) => gateSource(workflow, name)).join('\n');
  for (const action of ['db', 'integration', 'e2e']) {
    assert.match(gate, new RegExp(`(?:pnpm test:stack ${action}\\b|mandatory[^\\n]*${action})`), `image build has no dependency on mandatory ${action}`);
  }
  assert.doesNotMatch(gate, /continue-on-error:\s*true/);
});

test('PRA-13 mandatory DB runner discovers every database regression instead of listing three legacy files', () => {
  const runner = read('scripts/testing/stack.mjs');
  const dbBranch = runner.split("action === 'db'")[1]?.split("action === 'e2e'")[0] || '';
  assert.ok(dbBranch, 'mandatory DB action is missing');
  assert.match(dbBranch, /runMandatoryDatabaseTests\(env\)/, 'DB action must execute the mandatory runner');
  assert.ok(discoverDatabaseTests('borrow').includes('business-logic-audit.db.test.js'));
  assert.ok(discoverDatabaseTests('inventory').includes('audit-24.db.test.js'));
  assert.ok(discoverDatabaseTests('auth').includes('schema-drift.db.test.js'));
  assert.doesNotMatch(dbBranch, /test\/deposit\.db\.test\.js', 'test\/vnpay-topup\.db\.test\.js', 'test\/reservation-idempotency\.db\.test\.js'/);
});

test('PRA-19 backend final stages run as explicit non-root users', () => {
  for (const file of [
    'apps/api-gateway/Dockerfile',
    ...['auth', 'inventory', 'borrow', 'analytics', 'ai'].map((name) => `services/${name}-service/Dockerfile`),
  ]) {
    const lastStage = read(file).split(/^FROM\s+/m).at(-1);
    const users = [...lastStage.matchAll(/^USER\s+([^\r\n#]+)/gm)];
    assert.ok(users.length, `${file}: final stage inherits root`);
    assert.doesNotMatch(users.at(-1)[1].trim(), /^(?:root|0)(?::|$)/, file);
  }
});

test('PRA-19 production application credentials are separate from cluster bootstrap credentials', () => {
  const compose = read('compose.prod.yml');
  for (const service of ['auth-service', 'inventory-service', 'borrow-service', 'ai-service']) {
    const block = compose.split(new RegExp(`^  ${service}:\\r?$`, 'm'))[1]?.split(/^  [a-z-]+:\r?$/m)[0] || '';
    assert.ok(block, service);
    assert.doesNotMatch(block, /DATABASE_URL=.*\$\{POSTGRES_USER\}/, `${service} authenticates as the cluster bootstrap user`);
  }
});

test('PRA-14 runtime startup does not perform Prisma DDL migrations', () => {
  const compose = read('compose.prod.yml');
  for (const service of ['auth-service', 'inventory-service', 'borrow-service']) {
    const block = compose.split(new RegExp(`^  ${service}:\\r?$`, 'm'))[1]?.split(/^  [a-z-]+:\r?$/m)[0] || '';
    assert.doesNotMatch(block, /command:.*prisma migrate deploy/, `${service}: DDL is coupled to runtime restart`);
  }
});
