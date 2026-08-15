const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createCorsOptions,
  createRateLimiter,
  createRequestContext,
  requireEnv,
  securityHeaders,
} = require('../runtime/index.cjs');

test('required secrets reject missing and documented placeholder values', () => {
  assert.throws(() => requireEnv({}, ['JWT_SECRET']), /JWT_SECRET/);
  assert.throws(
    () => requireEnv({ JWT_SECRET: 'change-me' }, ['JWT_SECRET']),
    /unsafe placeholder/,
  );
  assert.deepEqual(requireEnv({ JWT_SECRET: 'local-test-secret-32-characters' }, ['JWT_SECRET']), {
    JWT_SECRET: 'local-test-secret-32-characters',
  });
});

test('CORS allows configured origins and rejects unknown browser origins', () => {
  const options = createCorsOptions('http://localhost:5173,https://demo.example');
  options.origin('http://localhost:5173', (error, allowed) => {
    assert.ifError(error);
    assert.equal(allowed, true);
  });
  options.origin('https://evil.example', (error) => {
    assert.match(error.message, /not allowed/);
  });
});

test('request context preserves a valid incoming request ID', () => {
  const middleware = createRequestContext('test-service');
  const req = { headers: { 'x-request-id': 'demo-request-001' }, method: 'GET', originalUrl: '/health' };
  const headers = {};
  const res = { setHeader(name, value) { headers[name] = value; } };
  middleware(req, res, () => {});
  assert.equal(req.requestId, 'demo-request-001');
  assert.equal(req.headers['x-request-id'], 'demo-request-001');
  assert.equal(headers['x-request-id'], 'demo-request-001');
});

test('request context replaces an invalid ID before proxying', () => {
  const middleware = createRequestContext('test-service');
  const req = { headers: { 'x-request-id': '<script>' }, method: 'GET', originalUrl: '/health' };
  const res = { setHeader() {} };
  middleware(req, res, () => {});
  assert.notEqual(req.requestId, '<script>');
  assert.equal(req.headers['x-request-id'], req.requestId);
});

test('security middleware sets baseline browser protections', () => {
  const headers = {};
  securityHeaders({}, { setHeader(name, value) { headers[name] = value; } }, () => {});
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
});

test('rate limiter rejects requests after the configured budget', () => {
  const limiter = createRateLimiter({ max: 2, windowMs: 60_000, now: () => 1_000 });
  const req = { ip: '127.0.0.1', headers: {} };
  const res = {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let allowed = 0;
  limiter(req, res, () => { allowed += 1; });
  limiter(req, res, () => { allowed += 1; });
  limiter(req, res, () => { allowed += 1; });
  assert.equal(allowed, 2);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, 'RATE_LIMITED');
});
