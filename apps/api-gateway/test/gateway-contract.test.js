const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const source = readFileSync(resolve(__dirname, '../src/index.js'), 'utf8');

test('gateway keeps all public service proxy prefixes', () => {
  for (const prefix of ['/auth', '/iam', '/api', '/borrow', '/analytics', '/ai']) {
    assert.match(source, new RegExp(`(?:pathFilter: |app\\.use\\(\\s*)["']${prefix}`));
  }
});

test('AI proxy fails in a documented degraded mode', () => {
  assert.match(source, /AI_UNAVAILABLE/);
  assert.match(source, /AI tạm thời không khả dụng/);
  assert.match(source, /on: \{ error: handleAiProxyError \}/);
});

test('per-service health breakdown is admin-only and readiness checks dependency /ready', () => {
  assert.match(source, /app\.get\("\/system\/health", requireAdminToken,/);
  assert.match(source, /path: "\/ready", critical: true/);
  assert.doesNotMatch(source, /app\.get\("\/ready"[\s\S]{0,200}\/health`/);
});

test('internal websocket pushes require a service key and allowlisted event', () => {
  assert.match(source, /x-internal-service-key/);
  assert.match(source, /ALLOWED_EVENTS/);
  assert.match(source, /ROOM_PATTERN/);
});

test('public website API is read-only, rate limited and limited to catalog + reviews', () => {
  assert.match(source, /const PUBLIC_READ_METHODS = new Set\(\["GET", "HEAD"\]\);/);
  assert.match(source, /app\.use\(\s*"\/public",\s*publicReadOnly,\s*createRateLimiter\(/);
  assert.match(source, /"\/public\/catalog",[\s\S]{0,120}target: inventoryTarget/);
  assert.match(source, /"\/public\/reviews",[\s\S]{0,120}target: borrowTarget/);
  // Anything else under /public is a 404, never proxied to a service.
  assert.match(source, /app\.use\("\/public", \(req, res\) => res\.status\(404\)/);
  // The read-only guard must run before any /public proxy.
  assert.ok(source.indexOf('publicReadOnly,') < source.indexOf('"/public/catalog"'));
});

test('public membership plans are proxied to borrow-service behind the same read-only guard', () => {
  assert.match(source, /"\/public\/membership",[\s\S]{0,120}target: borrowTarget/);
  assert.match(source, /"\/public\/membership"[\s\S]{0,200}pathRewrite: \(path\) => `\/public\/membership\$\{path\}`/);
  const guard = source.indexOf('publicReadOnly,');
  const proxy = source.indexOf('"/public/membership"');
  const notFound = source.indexOf('app.use("/public", (req, res) => res.status(404)');
  assert.ok(guard < proxy && proxy < notFound, 'membership proxy must sit between the GET/HEAD guard and the /public 404');
});

test('public AI discovery has its own per-IP budget and degrades like the other AI routes', () => {
  assert.match(source, /"\/public\/discover",\s*createRateLimiter\([\s\S]{0,200}createRateLimiter\([\s\S]{0,200}target: aiTarget/);
  assert.match(source, /"\/public\/discover"[\s\S]{0,700}on: \{ error: handleAiProxyError \}/);
  assert.ok(source.indexOf('"/public/discover"') < source.indexOf('app.use("/public", (req, res) => res.status(404)'));
});
