const test = require('node:test');
const assert = require('node:assert/strict');
test('PRA12: supplier controller database exceptions cannot print bearer values in error message/meta', async () => {
  const marker = 'FAKE_SUPPLIER_EXCEPTION_MARKER_c1a2';
  const p = require.resolve('../src/lib/prisma'), previous = require.cache[p];
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { prisma: { supplier_order_dispatches: { findFirst: async () => { throw Object.assign(new Error(`query equals ${marker}`), { code: 'P1001', meta: { query: marker } }); } } } } };
  const lines = [], original = console.error;
  console.error = (...args) => lines.push(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '));
  try {
    const controller = require('../src/controllers/supplier-portal.controller');
    const response = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
    await controller.getPortalOrder({ params: { token: marker }, requestId: 'SAFE-SUPPLIER-ERROR-REQUEST' }, response);
    assert.equal(response.statusCode, 500);
    assert.ok(lines.length > 0);
    assert.ok(!lines.join('\n').includes(marker));
    assert.ok(lines.join('\n').includes('SAFE-SUPPLIER-ERROR-REQUEST'));
    assert.ok(lines.join('\n').includes('P1001'));
  } finally { console.error = original; if (previous) require.cache[p] = previous; else delete require.cache[p]; }
});
