const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Ajv = require('ajv');

// POST /api/borrow-integration/reservations/release: every 200 carries
// `idempotent` (false = this call released the stock, true = nothing changed),
// validated against the shared contract schema. Runs without Docker, using the
// same fake-@prisma/client technique as borrow-integration-pickup.test.js.

let state;

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object' && 'gte' in cond) return row[key] >= cond.gte;
    return row[key] === cond;
  });
}

function model(name) {
  const rows = () => state[name];
  return {
    async findUnique({ where }) { return rows().find((row) => matches(row, where)) || null; },
    async findFirst({ where }) { return rows().find((row) => matches(row, where)) || null; },
    async create({ data }) {
      const row = { id: `${name}-${rows().length + 1}`, ...data };
      rows().push(row);
      return { ...row };
    },
    async update({ where, data }) {
      const row = rows().find((item) => matches(item, where));
      Object.assign(row, data);
      return { ...row };
    },
    async updateMany({ where, data }) {
      const hits = rows().filter((row) => matches(row, where));
      for (const row of hits) {
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in value) row[key] += value.increment;
          else if (value && typeof value === 'object' && 'decrement' in value) row[key] -= value.decrement;
          else row[key] = value;
        }
      }
      return { count: hits.length };
    },
  };
}

class FakePrismaClient {
  constructor() {
    for (const name of ['stock_reservations', 'stock_balances', 'stock_movements', 'integration_outbox']) this[name] = model(name);
  }

  async $transaction(fn) { return fn(this); }
}

require.cache[require.resolve('@prisma/client')] = {
  id: require.resolve('@prisma/client'),
  filename: require.resolve('@prisma/client'),
  loaded: true,
  exports: { PrismaClient: FakePrismaClient },
};

const { releaseBorrowReservation } = require('../src/controllers/borrow-integration.controller');
const schema = require(path.join('..', '..', '..', 'packages', 'shared', 'contracts', 'borrow-inventory', 'release-borrow-reservation.response.json'));

const validate = new Ajv().compile(schema);
const RESERVATION_ID = '11111111-1111-4111-8111-111111111111';

function resetState() {
  state = {
    stock_reservations: [{ id: 'sr-1', source_service: 'BORROW', source_reference_id: RESERVATION_ID, status: 'ACTIVE', variant_id: 'v-1', warehouse_id: 'wh-1', location_id: 'loc-1', quantity: 1, reservation_code: 'RSV-1' }],
    stock_balances: [{ variant_id: 'v-1', location_id: 'loc-1', available_qty: 0, reserved_qty: 1 }],
    stock_movements: [],
    integration_outbox: [],
  };
}

async function release(idempotencyKey) {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await releaseBorrowReservation({ body: { reservation_id: RESERVATION_ID, reason: 'CANCELLED', idempotency_key: idempotencyKey }, user: {}, requestId: 'req-1' }, res);
  return res;
}

test('the schema requires `idempotent` on every 200', () => {
  assert.deepEqual(schema.required.sort(), ['data', 'idempotent']);
  assert.doesNotMatch(schema.description, /TODO/);
  assert.equal(validate({ data: {} }), false);
});

test('first release: stock goes back, idempotent === false, matches the contract', async () => {
  resetState();
  const res = await release('key-1');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.idempotent, false);
  assert.equal(res.body.data.status, 'CANCELLED');
  assert.ok(validate(res.body), JSON.stringify(validate.errors));
  assert.equal(state.stock_balances[0].available_qty, 1);
});

test('replaying the same key: idempotent === true, nothing released twice', async () => {
  resetState();
  await release('key-1');
  const replay = await release('key-1');
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.idempotent, true);
  assert.ok(validate(replay.body), JSON.stringify(validate.errors));
  assert.equal(state.stock_balances[0].available_qty, 1);
});

test('nothing ACTIVE left to release (new key): idempotent === true, data null', async () => {
  resetState();
  await release('key-1');
  const again = await release('key-2');
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.body, { data: null, idempotent: true });
  assert.ok(validate(again.body), JSON.stringify(validate.errors));
});
