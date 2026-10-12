import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
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

function listSource(dir, extensions) {
  const found = [];
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !['node_modules', '__pycache__', 'eval', 'tests', 'test'].includes(entry.name)) {
        found.push(...listSource(path, extensions));
      }
    } else if (extensions.some((ext) => entry.name.endsWith(ext)) && !entry.name.startsWith('test_')) {
      found.push(path);
    }
  }
  return found;
}

test('no service module falls back to a public internal-service key', () => {
  // Entry points refuse to start without INTERNAL_SERVICE_KEY, but a module-level
  // `|| 'smartbook_internal_key'` still documents a reusable secret and becomes
  // live the moment that module is used from a script or a different entry point.
  const files = [
    ...['apps/api-gateway/src', 'services/auth-service/src', 'services/inventory-service/src',
      'services/borrow-service/src', 'services/analytics-service/src'].flatMap((dir) => listSource(dir, ['.js'])),
    ...listSource('services/ai-service', ['.py']),
  ];
  assert.ok(files.length > 50, `expected to scan the service sources, got ${files.length}`);
  for (const path of files) {
    assert.doesNotMatch(read(path), /smartbook_internal_key|smartbook-internal-dev-key/, relative(root, resolve(root, path)));
  }
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
  assert.doesNotMatch(compose, /GRAFANA_ADMIN_PASSWORD:-/);
});

test('observability and broker consoles are bound to loopback, not the LAN', () => {
  const compose = read('docker-compose.yml');
  for (const port of ['9090:9090', '3100:3000', '5672:5672', '15672:15672']) {
    assert.match(compose, new RegExp(`"127\\.0\\.0\\.1:${port}"`), port);
    assert.doesNotMatch(compose, new RegExp(`- "${port}"`), port);
  }
});

test('the web CSP takes its API origin from the environment and allows Google Fonts', () => {
  const nginx = read('apps/web/nginx.conf');
  assert.match(nginx, /connect-src 'self' \$\{API_ORIGIN\} \$\{API_WS_ORIGIN\}/);
  assert.doesNotMatch(nginx, /connect-src[^;]*localhost/);
  assert.match(nginx, /style-src[^;]*https:\/\/fonts\.googleapis\.com/);
  assert.match(nginx, /font-src[^;]*https:\/\/fonts\.gstatic\.com/);
  assert.match(read('apps/web/Dockerfile'), /NGINX_ENVSUBST_FILTER=\^API_/);
});

test('long-lived infrastructure restarts itself after a crash or a Docker restart', () => {
  const compose = read('docker-compose.yml');
  for (const service of ['db', 'redis', 'rabbitmq', 'api-gateway']) {
    const block = compose.split(new RegExp(`^  ${service}:\\r?$`, 'm'))[1]?.split(/^  [a-z-]+:\r?$/m)[0] ?? '';
    assert.match(block, /restart: unless-stopped/, service);
  }
});

test('the generated demo environment covers the Grafana password', () => {
  assert.match(read('.env.example'), /GRAFANA_ADMIN_PASSWORD=GENERATE_GRAFANA_PASSWORD/);
  assert.match(read('scripts/init-demo-env.mjs'), /GENERATE_GRAFANA_PASSWORD/);
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
