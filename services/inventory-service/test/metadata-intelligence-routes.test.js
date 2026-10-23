const test = require('node:test');
const assert = require('node:assert/strict');
const reconciliationRoutes = require('../src/routes/metadata-reconciliation.routes');
const duplicateRoutes = require('../src/routes/duplicate-intelligence.routes');
const { authorizeManagerDecision } = require('../src/middlewares/auth.middleware');

function endpoints(router) {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`)
    .sort();
}

test('reconciliation API exposes draft, per-field decision, and safe apply routes', () => {
  assert.deepEqual(endpoints(reconciliationRoutes), [
    'GET /:id',
    'GET /capabilities',
    'GET /capabilities/import',
    'PATCH /:id/fields/:field',
    'POST /',
    'POST /:id/apply',
  ]);
});

test('duplicate API exposes check, review read, and review decision routes', () => {
  assert.deepEqual(endpoints(duplicateRoutes), [
    'GET /reviews/:id',
    'PATCH /reviews/:id',
    'POST /check',
  ]);
});

test('catalog write decision rejects a staff user without manager role or permission', () => {
  const middleware = authorizeManagerDecision(['inventory.catalog.write']);
  const req = { user: { roles: ['WAREHOUSE_STAFF'], permissions: [] } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
  middleware(req, res, () => {});
  assert.equal(res.statusCode, 403);
});

test('catalog import capability (asked by ai-service before a paid OCR scan) needs manager role and catalog write', () => {
  const layer = reconciliationRoutes.stack.find((item) => item.route?.path === '/capabilities/import');
  const [guard, handler] = layer.route.stack.map((item) => item.handle);
  const run = (user) => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    guard({ user }, res, () => handler({ user }, res));
    return res;
  };
  assert.equal(run({ roles: ['WAREHOUSE_STAFF'], permissions: ['inventory.catalog.read'] }).statusCode, 403);
  assert.equal(run({ roles: ['WAREHOUSE_MANAGER'], permissions: ['inventory.catalog.read'] }).statusCode, 403);
  const allowed = run({ roles: ['WAREHOUSE_MANAGER'], permissions: ['inventory.catalog.write'] });
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.body, { catalogImport: true });
});
