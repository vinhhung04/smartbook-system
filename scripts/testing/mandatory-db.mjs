import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, stateDir, assertIsolated } from './environment.mjs';
import { sanitizeText, qaSecretValues } from './sanitize-artifacts.mjs';
import { sanitizeCapturedStreams } from './redacted-command.mjs';

const services = ['auth', 'inventory', 'borrow', 'analytics'];
const secretKeys = ['DATABASE_URL', 'BORROW_TEST_DATABASE_URL', 'BORROW_POLICY_DATABASE_URL', 'DEPOSIT_TEST_DATABASE_URL',
  'INVENTORY_AUDIT_TEST_DATABASE_URL', 'AUTH_AUDIT_DATABASE_URL', 'ANALYTICS_TEST_PG_URL', 'TEST_PG_DSN',
  'BORROW_AUDIT_PRISMA_CLIENT', 'INVENTORY_AUDIT_PRISMA_CLIENT', 'AUTH_AUDIT_PRISMA_CLIENT'];

export function mandatoryTestEnvironment(environment, target) {
  const parsed = new URL(target);
  assert.equal(parsed.hostname, '127.0.0.1', 'Mandatory DB target must be verified loopback');
  assert.match(parsed.pathname, /^\/(?:auth_audit|inventory_audit_verified|borrow_audit|analytics_audit|ai_pg_audit_[a-f0-9]{8})$/);
  assert.ok(parsed.port === '5432' || (parsed.protocol === 'postgresql+asyncpg:' && parsed.port === '15432'));
  const safe = { ...environment };
  for (const key of secretKeys) delete safe[key];
  safe.OPENROUTER_API_KEY = '';
  safe.GOOGLE_BOOKS_API_KEY = '';
  safe.ENABLE_NIGHTLY_BRIEFING = 'false';
  safe.DATABASE_URL = target;
  return safe;
}

export function assertMandatoryTap(output) {
  const totals = [...output.matchAll(/^# (tests|pass|fail|cancelled|skipped) (\d+)\s*$/gm)];
  const value = (name) => Number(totals.findLast((match) => match[1] === name)?.[2] ?? -1);
  assert.ok(value('tests') > 0, 'Mandatory test report missing or empty');
  for (const name of ['fail', 'cancelled', 'skipped']) assert.equal(value(name), 0, `Mandatory ${name} must be zero`);
  assert.equal(value('pass'), value('tests'), 'Mandatory suite did not execute every test');
  return { tests: value('tests'), pass: value('pass'), skipped: 0 };
}

export function discoverDatabaseTests(service) {
  return readdirSync(resolve(root, `services/${service}-service/test`)).filter(name => name.endsWith('.db.test.js')).sort();
}

export function runMandatoryDatabaseTests(environment) {
  assertIsolated(environment);
  assert.match(environment.DB_USER, /^[A-Za-z_][A-Za-z0-9_]*$/);
  assert.ok(typeof environment.DB_PASSWORD === 'string' && environment.DB_PASSWORD.length >= 20, 'Generated QA credentials required');
  const reports = resolve(root, 'test-results/qa/mandatory-db');
  mkdirSync(reports, { recursive: true });
  const composeArgs = ['compose', ...environment.COMPOSE_FILE.split(process.platform === 'win32' ? ';' : ':').flatMap(file => ['-f', file]),
    '--env-file', resolve(stateDir, 'test.env'), '-p', environment.COMPOSE_PROJECT_NAME];
  const redact = value => sanitizeText(value, qaSecretValues(environment));
  const capturedOutput = result => {
    const safe = sanitizeCapturedStreams(result, qaSecretValues(environment));
    return safe.stdout + safe.stderr;
  };
  const command = (program, args, options = {}) => {
    const result = spawnSync(program, args, { cwd: root, env: environment, encoding: 'utf8', windowsHide: true,
      timeout: 300_000, maxBuffer: 24 * 1024 * 1024, ...options });
    if (result.error || result.status !== 0) throw new Error(capturedOutput(result) || 'Mandatory command failed');
    return redact(result.stdout);
  };
  const container = command('docker', [...composeArgs, 'ps', '-q', 'db']).trim();
  assert.ok(container, 'Verified QA DB must already be running');
  const identity = JSON.parse(command('docker', ['inspect', container]))[0];
  assert.equal(identity.Config.Labels['com.docker.compose.project'], environment.COMPOSE_PROJECT_NAME);
  assert.equal(identity.Config.Labels['com.docker.compose.service'], 'db');
  assert.ok(identity.HostConfig.PortBindings['5432/tcp'].every(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === '15432'));
  const aiDatabase = `ai_pg_audit_${randomBytes(4).toString('hex')}`;
  const databaseNames = ['auth_audit', 'inventory_audit_verified', 'borrow_audit', 'analytics_audit', aiDatabase];
  for (const database of databaseNames) {
    // Additive provisioning only; never reset/clean/drop an existing database.
    const sql = `SELECT 'CREATE DATABASE ${database}' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='${database}')\n\\gexec\n`;
    command('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', environment.DB_USER, '-d', 'postgres'], { input: sql });
    command('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', environment.DB_USER, '-d', database], {
      input: `CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;\n`,
    });
  }
  const manifest = { sourceSha: environment.GITHUB_SHA || null, runtime: 'Node test images', suites: [] };
  for (const service of services) {
    const image = `${environment.COMPOSE_PROJECT_NAME}-${service}-mandatory-test`;
    const build = spawnSync('docker', ['build', '-f', 'deploy/Dockerfile.test', '--build-arg', `SERVICE=${service}-service`, '-t', image, '.'], {
      cwd: root, env: environment, encoding: 'utf8', windowsHide: true, timeout: 600_000, maxBuffer: 16 * 1024 * 1024,
    });
    writeFileSync(resolve(reports, `${service}-build.log`), capturedOutput(build));
    assert.equal(build.status, 0, `Test-only ${service} image build failed; see redacted build log`);
    const runtime = command('docker', ['run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', image, '--version']).trim();
    assert.equal(runtime, 'v24.16.0', 'Mandatory tests must use the supported pinned Node runtime');
    const database = service === 'inventory' ? 'inventory_audit_verified' : `${service}_audit`;
    const url = new URL(`postgresql://127.0.0.1:5432/${database}?schema=public`);
    url.username = environment.DB_USER; url.password = environment.DB_PASSWORD;
    const variables = mandatoryTestEnvironment({}, url.href);
    if (service === 'borrow') Object.assign(variables, { BORROW_TEST_DATABASE_URL: url.href, BORROW_POLICY_DATABASE_URL: url.href, DEPOSIT_TEST_DATABASE_URL: url.href });
    if (service === 'inventory') variables.INVENTORY_AUDIT_TEST_DATABASE_URL = url.href;
    if (service === 'auth') variables.AUTH_AUDIT_DATABASE_URL = url.href;
    if (service === 'analytics') Object.assign(variables, { ANALYTICS_TEST_PG_URL: url.href, INVENTORY_DATABASE_URL: url.href, BORROW_DATABASE_URL: url.href });
    const envFile = resolve(stateDir, `mandatory-${service}.env`);
    writeFileSync(envFile, Object.entries(variables).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
    const files = readdirSync(resolve(root, `services/${service}-service/test`)).filter(name => name.endsWith('.test.js')).sort();
    assert.ok(discoverDatabaseTests(service).length, `${service} DB suite missing`);
    assert.ok(files.every(name => /^[A-Za-z0-9_.-]+\.test\.js$/.test(name)), 'Unexpected test filename');
    const script = `${service === 'analytics' ? '' : 'pnpm exec prisma migrate deploy && '}node --test --test-reporter=tap --test-concurrency=1 ${files.map(name => `test/${name}`).join(' ')}`;
    const result = spawnSync('docker', ['run', '--rm', '--network', `container:${container}`, '--env-file', envFile, image, 'sh', '-c', script], {
      cwd: root, env: environment, encoding: 'utf8', windowsHide: true, timeout: 600_000, maxBuffer: 24 * 1024 * 1024,
    });
    const output = capturedOutput(result);
    writeFileSync(resolve(reports, `${service}.tap`), output);
    assert.equal(result.status, 0, `${service} mandatory test failed; inspect redacted TAP artifact`);
    const totals = assertMandatoryTap(output);
    manifest.suites.push({ service, runtime, files, databaseFiles: discoverDatabaseTests(service), ...totals,
      schemaSha256: service === 'analytics' ? null : createHash('sha256').update(readFileSync(resolve(root, `services/${service}-service/prisma/schema.prisma`))).digest('hex') });
  }
  const aiUrl = new URL(`postgresql+asyncpg://127.0.0.1:5432/${aiDatabase}`);
  aiUrl.username = environment.DB_USER; aiUrl.password = environment.DB_PASSWORD;
  const aiEnv = mandatoryTestEnvironment({}, aiUrl.href);
  Object.assign(aiEnv, { TEST_PG_DSN: aiUrl.href, AI_SCHEMA_MANAGED_EXTERNALLY: 'true', PYTHONDONTWRITEBYTECODE: '1',
    INTERNAL_SERVICE_KEY: environment.INTERNAL_SERVICE_KEY });
  const aiEnvFile = resolve(stateDir, 'mandatory-ai.env');
  writeFileSync(aiEnvFile, Object.entries(aiEnv).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  // The AI image supplies the production Python runtime/dependencies. Current
  // source is read-only; unittest requires no extra runtime test dependency.
  const ai = spawnSync('docker', ['run', '--rm', '--network', `container:${container}`, '--env-file', aiEnvFile,
    '--mount', `type=bind,source=${resolve(root, 'services/ai-service')},target=/app,readonly`,
    '--workdir', '/app', '--entrypoint', 'sh', `${environment.COMPOSE_PROJECT_NAME}-ai-service`,
    '-c', 'python --version && python migrate.py && python -m unittest test_pgvector_store test_agent_store_pg -v'], {
    cwd: root, env: environment, encoding: 'utf8', windowsHide: true, timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
  });
  const aiOutput = capturedOutput(ai);
  writeFileSync(resolve(reports, 'ai.log'), aiOutput);
  assert.equal(ai.status, 0, 'AI mandatory PostgreSQL suite failed');
  assert.match(aiOutput, /Ran 12 tests/);
  assert.match(aiOutput, /Python 3\.12\.16\b/);
  assert.match(aiOutput, /^OK\s*$/m);
  assert.doesNotMatch(aiOutput, /skipped|FAILED \(|ERROR:/i);
  manifest.aiPostgres = { result: 'PASS_NO_SKIPS', runtime: aiOutput.match(/Python [0-9.]+/)?.[0] };
  writeFileSync(resolve(reports, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
