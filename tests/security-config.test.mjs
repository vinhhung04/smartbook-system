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
    assert.match(source, /securityHeaders/, path);
    assert.doesNotMatch(source, /app\.use\(cors\(\)\)/, path);
  }
});

test('runtime source contains no fallback authentication secret', () => {
  for (const path of entrypoints) {
    const source = read(path);
    assert.doesNotMatch(source, /smartbook_shared_jwt_secret|smartbook_internal_key|your-secret-key/, path);
  }
});

test('compose requires secrets instead of supplying public defaults', () => {
  const compose = read('docker-compose.yml');
  assert.doesNotMatch(compose, /JWT_SECRET:-/);
  assert.doesNotMatch(compose, /INTERNAL_SERVICE_KEY:-/);
  assert.doesNotMatch(compose, /POSTGRES_PASSWORD:-password/);
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
