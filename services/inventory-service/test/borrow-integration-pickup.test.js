const test = require('node:test');
const assert = require('node:assert/strict');

// Regression: a reader's own reservation (borrow-service /my/reservations sends
// reservation_channel=CUSTOMER) may only be picked up at a reader-facing location
// (PUBLIC_PICKUP_WAREHOUSE_TYPES). Before, reserveFromBorrow accepted any
// warehouse_id with stock, so a direct API call could hold stock in an internal
// WAREHOUSE.
//
// borrow-integration.controller.js does `new PrismaClient()` at module scope, so
// (as in receiving-putaway.controller.test.js) a fake `@prisma/client` is put in
// require.cache before the controller loads. Every PrismaClient sees `state`,
// which each test resets.

let state;

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object' && 'gte' in cond) return row[key] >= cond.gte;
    return row[key] === cond;
  });
}

function pick(row, select) {
  if (!row) return null;
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

function model(name) {
  const rows = () => state[name];
  return {
    async findUnique({ where, select }) { return pick(rows().find((row) => matches(row, where)), select); },
    async findFirst({ where, select }) { return pick(rows().find((row) => matches(row, where)), select); },
    async findMany({ where, select }) { return rows().filter((row) => matches(row, where)).map((row) => pick(row, select)); },
    async create({ data }) {
      const row = { id: `${name}-${rows().length + 1}`, ...data };
      rows().push(row);
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

const MODELS = ['warehouses', 'book_variants', 'stock_balances', 'stock_reservations', 'stock_movements', 'integration_outbox'];

class FakePrismaClient {
  constructor() {
    for (const name of MODELS) this[name] = model(name);
  }

  async $transaction(fn) { return fn(this); }

  async $queryRaw() { return []; }
}

require.cache[require.resolve('@prisma/client')] = {
  id: require.resolve('@prisma/client'),
  filename: require.resolve('@prisma/client'),
  loaded: true,
  exports: { PrismaClient: FakePrismaClient },
};

const { reserveFromBorrow, getAvailability } = require('../src/controllers/borrow-integration.controller');
const { PUBLIC_PICKUP_WAREHOUSE_TYPES } = require('../src/utils/constants');

const VARIANT_ID = '11111111-1111-4111-8111-111111111111';
const RESERVATION_ID = '22222222-2222-4222-8222-222222222222';
const WH = {
  BRANCH: 'aaaaaaaa-0000-4000-8000-000000000001',
  LIBRARY: 'aaaaaaaa-0000-4000-8000-000000000002',
  WAREHOUSE: 'aaaaaaaa-0000-4000-8000-000000000003',
  STORE: 'aaaaaaaa-0000-4000-8000-000000000004',
  INACTIVE_BRANCH: 'aaaaaaaa-0000-4000-8000-000000000005',
  MISSING: 'aaaaaaaa-0000-4000-8000-0000000000ff',
};
const INVALID_MESSAGE = 'Selected warehouse is not a valid pickup location';

function resetState() {
  const warehouse = (id, warehouse_type, is_active = true) => ({ id, warehouse_type, is_active });
  const balance = (warehouse_id, available_qty) => ({
    variant_id: VARIANT_ID,
    warehouse_id,
    location_id: `loc-${warehouse_id}`,
    available_qty,
    reserved_qty: 0,
  });
  state = {
    warehouses: [
      warehouse(WH.BRANCH, 'BRANCH'),
      warehouse(WH.LIBRARY, 'LIBRARY'),
      warehouse(WH.WAREHOUSE, 'WAREHOUSE'),
      warehouse(WH.STORE, 'STORE'),
      warehouse(WH.INACTIVE_BRANCH, 'BRANCH', false),
    ],
    book_variants: [{ id: VARIANT_ID, is_borrowable: true }],
    // Every warehouse holds stock — the internal one far more than any branch —
    // and so does the unknown id, so only the pickup rule can reject.
    stock_balances: [
      balance(WH.BRANCH, 3),
      balance(WH.LIBRARY, 3),
      balance(WH.WAREHOUSE, 500),
      balance(WH.STORE, 50),
      balance(WH.INACTIVE_BRANCH, 5),
      balance(WH.MISSING, 5),
    ],
    stock_reservations: [],
    stock_movements: [],
    integration_outbox: [],
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

async function reserve(warehouseId, reservationChannel = 'CUSTOMER') {
  const res = createRes();
  await reserveFromBorrow({
    body: {
      reservation_id: RESERVATION_ID,
      reservation_number: 'RSV-TEST',
      customer_id: '33333333-3333-4333-8333-333333333333',
      variant_id: VARIANT_ID,
      warehouse_id: warehouseId,
      quantity: 1,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      idempotency_key: `test:${warehouseId}`,
      ...(reservationChannel ? { reservation_channel: reservationChannel } : {}),
    },
  }, res);
  return res;
}

async function availability(warehouseId, reservationChannel = 'CUSTOMER') {
  const res = createRes();
  await getAvailability({
    query: {
      variant_id: VARIANT_ID,
      warehouse_id: warehouseId,
      quantity: '1',
      ...(reservationChannel ? { reservation_channel: reservationChannel } : {}),
    },
  }, res);
  return res;
}

function balanceOf(warehouseId) {
  return state.stock_balances.find((row) => row.warehouse_id === warehouseId);
}

function assertReserved(res, warehouseId, startingQty) {
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.warehouse_id, warehouseId);
  assert.equal(balanceOf(warehouseId).available_qty, startingQty - 1);
  assert.equal(balanceOf(warehouseId).reserved_qty, 1);
  assert.equal(state.stock_reservations.length, 1);
  assert.equal(state.stock_movements.length, 1);
  assert.deepEqual(state.integration_outbox.map((row) => row.event_type), ['inventory.reservation.created']);
}

function assertRejectedWithoutMutation(res, warehouseId, startingQty) {
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, INVALID_MESSAGE);
  assert.equal(balanceOf(warehouseId).available_qty, startingQty, 'available quantity must not drop');
  assert.equal(balanceOf(warehouseId).reserved_qty, 0, 'reserved quantity must not grow');
  assert.equal(state.stock_reservations.length, 0, 'no stock reservation');
  assert.equal(state.stock_movements.length, 0, 'no stock movement');
  assert.equal(state.integration_outbox.length, 0, 'no reservation outbox event');
}

test.beforeEach(resetState);

test('pickup rule reuses PUBLIC_PICKUP_WAREHOUSE_TYPES (BRANCH, LIBRARY)', () => {
  assert.deepEqual([...PUBLIC_PICKUP_WAREHOUSE_TYPES].sort(), ['BRANCH', 'LIBRARY']);
});

test('Case A: customer reservation at an active BRANCH with stock succeeds', async () => {
  assertReserved(await reserve(WH.BRANCH), WH.BRANCH, 3);
});

test('Case B: customer reservation at an active LIBRARY with stock succeeds', async () => {
  assertReserved(await reserve(WH.LIBRARY), WH.LIBRARY, 3);
});

test('Case C + G: customer reservation at an internal WAREHOUSE is rejected despite plenty of stock, nothing mutated', async () => {
  assertRejectedWithoutMutation(await reserve(WH.WAREHOUSE), WH.WAREHOUSE, 500);
});

test('Case D + G: customer reservation at a STORE is rejected, nothing mutated', async () => {
  assert.equal(PUBLIC_PICKUP_WAREHOUSE_TYPES.includes('STORE'), false);
  assertRejectedWithoutMutation(await reserve(WH.STORE), WH.STORE, 50);
});

test('Case E + G: customer reservation at an inactive BRANCH is rejected, nothing mutated', async () => {
  assertRejectedWithoutMutation(await reserve(WH.INACTIVE_BRANCH), WH.INACTIVE_BRANCH, 5);
});

test('Case F + G: customer reservation at an unknown warehouse is rejected, nothing mutated', async () => {
  assertRejectedWithoutMutation(await reserve(WH.MISSING), WH.MISSING, 5);
});

test('channel value is matched case-insensitively', async () => {
  assertRejectedWithoutMutation(await reserve(WH.WAREHOUSE, 'customer'), WH.WAREHOUSE, 500);
});

test('staff/internal reservation (no channel) keeps access to an internal WAREHOUSE', async () => {
  assertReserved(await reserve(WH.WAREHOUSE, null), WH.WAREHOUSE, 500);
});

test('getAvailability for a customer agrees with reserveFromBorrow', async () => {
  for (const id of [WH.BRANCH, WH.LIBRARY]) {
    const res = await availability(id);
    assert.equal(res.statusCode, 200, id);
    assert.equal(res.body.data.total_available, 3);
  }
  for (const id of [WH.WAREHOUSE, WH.STORE, WH.INACTIVE_BRANCH, WH.MISSING]) {
    const res = await availability(id);
    assert.equal(res.statusCode, 409, id);
    assert.equal(res.body.message, INVALID_MESSAGE);
  }
});

test('getAvailability without a channel (staff) still reports internal WAREHOUSE stock', async () => {
  const res = await availability(WH.WAREHOUSE, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.total_available, 500);
});
