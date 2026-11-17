const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { consumeReservation } = require('../src/services/inventory-integration.service');
const authHeader = `Bearer ${jwt.sign({ is_superuser: true }, 'isolated-test-signing-key')}`;

test('SB23: opt-in consume timeout aborts an unresponsive remote boundary', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    assert.ok(url.endsWith('/reservations/consume'));
    assert.ok(options.signal instanceof AbortSignal);
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  };
  // Keep the process alive: AbortSignal.timeout uses an unreferenced timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(consumeReservation({ authHeader, timeoutMs: 20 }), { name: 'TimeoutError' }); }
  finally { clearTimeout(keepAlive); global.fetch = original; }
});
test('legacy consume callers retain the existing payload without an opt-in timeout', async () => {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(options.signal, undefined);
    assert.equal(JSON.parse(options.body).reservation_id, 'reservation');
    return { ok: true, json: async () => ({ data: { reservation_id: 'reservation' } }) };
  };
  try { assert.deepEqual(await consumeReservation({ authHeader, reservation_id: 'reservation' }), { data: { reservation_id: 'reservation' } }); }
  finally { global.fetch = original; }
});
