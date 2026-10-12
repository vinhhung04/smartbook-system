const test = require('node:test');
const assert = require('node:assert/strict');

// A returned loan puts a copy back on the shelf. Availability alerts in
// borrow-service only hear about that through the outbox, so a good-condition
// return must write inventory.stock.changed in the same transaction as the
// stock update; lost/damaged returns (no new shelf copy) must not.
//
// Same fake-@prisma/client technique as borrow-integration-pickup.test.js.

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
      if (!row) throw new Error('not found');
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

const MODELS = ['stock_balances', 'stock_movements', 'integration_outbox', 'inventory_units'];

class FakePrismaClient {
  constructor() {
    for (const name of MODELS) this[name] = model(name);
  }

  async $transaction(fn) { return fn(this); }
}

require.cache[require.resolve('@prisma/client')] = {
  id: require.resolve('@prisma/client'),
  filename: require.resolve('@prisma/client'),
  loaded: true,
  exports: { PrismaClient: FakePrismaClient },
};

const { returnBorrowedLoan } = require('../src/controllers/borrow-integration.controller');

const LOAN_ID = '11111111-1111-4111-8111-111111111111';
const VARIANT_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';

function resetState() {
  state = {
    stock_balances: [{ variant_id: VARIANT_ID, warehouse_id: BRANCH_ID, location_id: LOCATION_ID, on_hand_qty: 1, available_qty: 0, borrowed_qty: 1, damaged_qty: 0 }],
    stock_movements: [],
    integration_outbox: [],
    inventory_units: [],
  };
}

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function returnLoan(extra = {}) {
  const res = createRes();
  await returnBorrowedLoan({
    body: { loan_id: LOAN_ID, variant_id: VARIANT_ID, warehouse_id: BRANCH_ID, quantity: 1, idempotency_key: `ret-${Math.random()}`, ...extra },
    requestId: 'req-1',
  }, res);
  return res;
}

test('a good-condition return publishes inventory.stock.changed with the shelf delta', async () => {
  resetState();
  const res = await returnLoan();
  assert.equal(res.statusCode, 201);
  assert.equal(state.stock_balances[0].available_qty, 1);
  assert.equal(state.integration_outbox.length, 1);
  const event = state.integration_outbox[0];
  assert.equal(event.event_type, 'inventory.stock.changed');
  assert.deepEqual(event.payload, {
    variant_id: VARIANT_ID,
    location_id: LOCATION_ID,
    warehouse_id: BRANCH_ID,
    delta_qty: 1,
    reason_code: 'LOAN_RETURNED',
    source_reference_type: 'LOAN_TRANSACTION',
    source_reference_id: LOAN_ID,
  });
});

test('damaged and lost returns do not announce new shelf stock', async () => {
  resetState();
  assert.equal((await returnLoan({ item_condition_on_return: 'DAMAGED' })).statusCode, 201);
  assert.equal(state.integration_outbox.length, 0);

  resetState();
  assert.equal((await returnLoan({ mark_lost: true })).statusCode, 201);
  assert.equal(state.integration_outbox.length, 0);
});

test('replaying the same idempotency key does not write a second event', async () => {
  resetState();
  await returnLoan({ idempotency_key: 'same-key' });
  state.stock_balances[0].borrowed_qty = 1; // even if more copies were out
  const replay = await returnLoan({ idempotency_key: 'same-key' });
  assert.equal(replay.statusCode, 200);
  assert.equal(state.integration_outbox.length, 1);
});
