const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRequestLogger } = require('../runtime/index.cjs');
const marker = 'FAKE_SUPPLIER_BEARER_MARKER_7ed9';
for (const [description, request] of [
  ['matched route with token in mounted base URL', { baseUrl: `/supplier-portal/orders/${marker}`, route: { path: '/confirm' } }],
  ['unmatched error route', {}],
  ['percent encoded portal path', { originalUrl: `/api/supplier-portal/orders/${encodeURIComponent(marker)}/invoices?access_token=${marker}` }],
]) test(`PRA12: ${description} retains correlation without logging bearer/query/header secrets`, () => {
  const lines = [], res = new EventEmitter(); res.statusCode = 403;
  const req = { method: 'POST', originalUrl: `/api/supplier-portal/orders/${marker}/confirm?token=${marker}`, requestId: 'safe-request-123', headers: { authorization: `Bearer ${marker}`, cookie: `session=${marker}` }, ...request };
  createRequestLogger('inventory-service', { log: line => lines.push(line) })(req, res, () => {});
  res.emit('finish');
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes(marker), lines[0]);
  const line = JSON.parse(lines[0]);
  assert.equal(line.request_id, 'safe-request-123');
  assert.equal(line.method, 'POST');
  assert.equal(line.status, 403);
});
