const assert = require('node:assert/strict');
const test = require('node:test');

// A reader's own reservation (/my/reservations) must reach inventory marked
// reservation_channel=CUSTOMER so inventory enforces the pickup-location rule
// (PUBLIC_PICKUP_WAREHOUSE_TYPES). The marker is set server-side, never from the body.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const prismaPath = require.resolve('../src/lib/prisma');
const customerControllerPath = require.resolve('../src/controllers/customer.controller');
const reservationControllerPath = require.resolve('../src/controllers/reservation.controller');

let capturedReq = null;

require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: {} } };
require.cache[customerControllerPath] = {
  id: customerControllerPath,
  filename: customerControllerPath,
  loaded: true,
  exports: { ensureCurrentCustomer: async () => ({ id: 'customer-1' }) },
};
require.cache[reservationControllerPath] = {
  id: reservationControllerPath,
  filename: reservationControllerPath,
  loaded: true,
  exports: {
    createReservation: async (req, res) => { capturedReq = req; return res.status(201).json({}); },
    cancelReservation: async () => undefined,
  },
};

const { createMyReservation } = require('../src/controllers/my.controller');
const { checkAvailability, reserveStock } = require('../src/services/inventory-integration.service');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('createMyReservation marks the reservation as CUSTOMER, ignoring any channel in the body', async () => {
  capturedReq = null;
  await createMyReservation({
    user: { id: 'auth-user-1' },
    headers: {},
    body: { variant_id: 'v', warehouse_id: 'w', reservation_channel: 'STAFF', customer_id: 'someone-else' },
  }, response());

  assert.equal(capturedReq.reservationChannel, 'CUSTOMER');
  assert.equal(capturedReq.body.customer_id, 'customer-1');
});

test('inventory calls forward reservation_channel only when set', async (t) => {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ data: {} }) };
  });

  await checkAvailability({ variant_id: 'v', warehouse_id: 'w', quantity: 1, reservation_channel: 'CUSTOMER' });
  await checkAvailability({ variant_id: 'v', warehouse_id: 'w', quantity: 1 });
  await reserveStock({ reservation_id: 'r', variant_id: 'v', warehouse_id: 'w', quantity: 1, reservation_channel: 'CUSTOMER' });
  await reserveStock({ reservation_id: 'r', variant_id: 'v', warehouse_id: 'w', quantity: 1 });

  assert.match(calls[0].url, /&reservation_channel=CUSTOMER$/);
  assert.doesNotMatch(calls[1].url, /reservation_channel/);
  assert.equal(JSON.parse(calls[2].options.body).reservation_channel, 'CUSTOMER');
  assert.equal(JSON.parse(calls[3].options.body).reservation_channel, undefined);
});
