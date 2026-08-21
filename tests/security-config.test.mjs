import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const entrypoints = [
  'apps/api-gateway/src/index.js',
  'services/auth-service/src/index.js',
  'services/inventory-service/src/index.js',
  'services/borrow-service/src/index.js',
  'services/analytics-service/src/index.js',
];

test('every Node HTTP service uses the shared security boundary', () => {
  for (const path of entrypoints) {
    const source = read(path);
    assert.match(source, /@smartbook\/shared\/runtime/, path);
    assert.match(source, /createCorsOptions/, path);
    assert.match(source, /createRequestContext/, path);
    assert.match(source, /createRequestLogger/, path);
    assert.match(source, /securityHeaders/, path);
    assert.doesNotMatch(source, /app\.use\(cors\(\)\)/, path);
  }
});

test('runtime source contains no fallback authentication secret', () => {
  for (const path of entrypoints) {
    const source = read(path);
    assert.doesNotMatch(source, /smartbook_shared_jwt_secret|smartbook_internal_key|your-secret-key/, path);
  }
  assert.doesNotMatch(read('services/auth-service/src/middlewares/redis-auth.middleware.js'), /JWT_SECRET\s*=.*\|\|/);
});

test('demo access tokens use a short default lifetime', () => {
  assert.match(read('.env.example'), /JWT_EXPIRES_IN=2h/);
  assert.doesNotMatch(read('services/auth-service/src/controllers/auth.controller.js'), /JWT_EXPIRES_IN \|\| '1d'/);
});

test('compose requires secrets instead of supplying public defaults', () => {
  const compose = read('docker-compose.yml');
  assert.doesNotMatch(compose, /JWT_SECRET:-/);
  assert.doesNotMatch(compose, /INTERNAL_SERVICE_KEY:-/);
  assert.doesNotMatch(compose, /POSTGRES_PASSWORD:-password/);
});

test('demo environment is generated instead of documenting reusable secrets', () => {
  const example = read('.env.example');
  assert.match(example, /JWT_SECRET=GENERATE_JWT_SECRET/);
  assert.match(example, /INTERNAL_SERVICE_KEY=GENERATE_INTERNAL_KEY/);
  assert.doesNotMatch(example, /POSTGRES_PASSWORD=password/);
  assert.match(read('scripts/init-demo-env.mjs'), /randomBytes/);
});

test('optional Docker capabilities use explicit profiles', () => {
  const compose = read('docker-compose.yml');
  assert.match(compose, /profiles: \["demo"\]/);
  assert.match(compose, /profiles: \["ai"\]/);
  assert.match(compose, /profiles: \["tools"\]/);
  assert.doesNotMatch(compose, /migrate deploy && .*db seed/);
});

test('new and changed passwords use at least twelve bcrypt rounds', () => {
  for (const path of [
    'services/auth-service/src/controllers/auth.controller.js',
    'services/auth-service/src/controllers/iam.controller.js',
    'services/auth-service/prisma/seed.js',
  ]) {
    assert.doesNotMatch(read(path), /bcrypt\.hash\([^\n]+,\s*(?:[0-9]|10|11)\)/, path);
  }
});

test('web export path does not ship the vulnerable SheetJS package', () => {
  const manifest = JSON.parse(read('apps/web/package.json'));
  assert.equal(manifest.dependencies.xlsx, undefined);
  assert.doesNotMatch(read('apps/web/src/lib/export-utils.ts'), /from ['"]xlsx['"]/);
});
