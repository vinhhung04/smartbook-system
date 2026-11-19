const test = require('node:test');
const assert = require('node:assert/strict');
const { reserveStock, releaseReservation } = require('../src/services/inventory-integration.service');
const authHeader = `Bearer ${require('jsonwebtoken').sign({ is_superuser: true }, 'TEST_ONLY_TIMEOUT_FIXTURE')}`;
test('PRA07: reserve and release always carry a bounded abort signal', async () => {
  const original = global.fetch;
  const signals = [];
  global.fetch = async (_url, options) => {
    signals.push(options.signal);
    assert.ok(options.signal instanceof AbortSignal, 'Remote mutation must be bounded even without caller timeout');
    return { ok: true, json: async () => ({}) };
  };
  try {
    await reserveStock({ authHeader, reservation_id: 'test' });
    await releaseReservation({ authHeader, reservation_id: 'test' });
    assert.equal(signals.length, 2);
  } finally { global.fetch = original; }
});

test('PRA07: recovery token identifies the service issuer/audience without replacing the approved actor', async () => {
  const original = global.fetch, previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'TEST_ONLY_SERVICE_IDENTITY_FIXTURE';
  let observed = false;
  global.fetch = async (_url, options) => {
    const claims = require('jsonwebtoken').verify(options.headers.Authorization.slice(7), process.env.JWT_SECRET, { issuer: 'borrow-service', audience: 'inventory-service' });
    assert.equal(claims.service, 'borrow-service');
    assert.equal(claims.id, '00000000-0000-0000-0000-000000000001');
    assert.equal(JSON.parse(options.body).created_by_user_id, 'approved-original-actor');
    observed = true;
    return { ok: true, json: async () => ({}) };
  };
  try { await reserveStock({ reservation_id: 'test', created_by_user_id: 'approved-original-actor' }); assert.equal(observed, true); }
  finally { global.fetch = original; if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; }
});
