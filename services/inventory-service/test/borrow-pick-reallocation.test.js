const test = require('node:test');
const assert = require('node:assert/strict');

// A borrow reservation's stock hold starts on the shelf the system picked; the
// librarian then reports the shelves the copies were really taken from
// (POST reservations/reallocate). Consume and release must then act on exactly
// those shelves. Fake @prisma/client (same technique as
// borrow-integration-release.test.js) whose $transaction rolls back on error.

let state;

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object') {
      if ('gte' in cond) return row[key] >= cond.gte;
      if ('in' in cond) return cond.in.includes(row[key]);
    }
    return row[key] === cond;
  });
}

function pick(row, select) {
  if (!row || !select) return row ? { ...row } : null;
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
}

function model(name) {
  const rows = () => state[name];
  return {
    async findUnique({ where }) { return pick(rows().find((row) => matches(row, where))); },
    async findFirst({ where }) { return pick(rows().find((row) => matches(row, where))); },
    async findMany({ where, select }) { return rows().filter((row) => matches(row, where)).map((row) => pick(row, select)); },
    async count({ where }) { return rows().filter((row) => matches(row, where)).length; },
    async create({ data }) {
      const row = { id: `${name}-${rows().length + 1}`, ...data };
      if (name === 'stock_movements' && rows().some((item) => item.idempotency_key === data.idempotency_key)) {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      }
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

const MODELS = ['stock_reservations', 'stock_balances', 'stock_movements', 'integration_outbox', 'locations'];

class FakePrismaClient {
  constructor() {
    for (const name of MODELS) this[name] = model(name);
  }

  async $transaction(fn) {
    const snapshot = structuredClone(state);
    try {
      return await fn(this);
    } catch (error) {
      state = snapshot;
      throw error;
    }
  }
}

require.cache[require.resolve('@prisma/client')] = {
  id: require.resolve('@prisma/client'),
  filename: require.resolve('@prisma/client'),
  loaded: true,
  exports: { PrismaClient: FakePrismaClient },
};

const {
  reallocateBorrowReservation,
  consumeBorrowReservation,
  releaseBorrowReservation,
  getBorrowPickOptions,
} = require('../src/controllers/borrow-integration.controller');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RESERVATION_ID = id(1);
const VARIANT_ID = id(2);
const WAREHOUSE_ID = id(3);
const OTHER_WAREHOUSE_ID = id(4);
const SHELF = { K03: id(103), K04: id(104), K05: id(105), FOREIGN: id(199) };

function balance(locationId, available_qty, reserved_qty = 0) {
  return { variant_id: VARIANT_ID, warehouse_id: WAREHOUSE_ID, location_id: locationId, available_qty, reserved_qty, borrowed_qty: 0 };
}

// Reservation of `quantity` copies held, as reserveFromBorrow does, on the fullest shelf (K04).
function reset(quantity = 1) {
  state = {
    locations: [
      { id: SHELF.K03, warehouse_id: WAREHOUSE_ID, location_code: 'KE-03', is_active: true },
      { id: SHELF.K04, warehouse_id: WAREHOUSE_ID, location_code: 'KE-04', is_active: true },
      { id: SHELF.K05, warehouse_id: WAREHOUSE_ID, location_code: 'KE-05', is_active: true },
      { id: SHELF.FOREIGN, warehouse_id: OTHER_WAREHOUSE_ID, location_code: 'KHAC-01', is_active: true },
    ],
    stock_balances: [balance(SHELF.K03, 2), balance(SHELF.K04, 5 - quantity, quantity), balance(SHELF.K05, 1)],
    stock_reservations: [{
      id: 'sr-1', reservation_code: 'RSV-0001', source_service: 'BORROW', source_reference_id: RESERVATION_ID,
      status: 'ACTIVE', variant_id: VARIANT_ID, warehouse_id: WAREHOUSE_ID, location_id: SHELF.K04,
      customer_id: null, quantity, expires_at: new Date('2030-01-01'), created_by_user_id: null, created_at: new Date(0),
    }],
    stock_movements: [],
    integration_outbox: [],
  };
}

function shelf(locationId) {
  return state.stock_balances.find((row) => row.location_id === locationId);
}

// [available, reserved, borrowed] on one shelf.
function counts(locationId) {
  const row = shelf(locationId);
  return [row.available_qty, row.reserved_qty, row.borrowed_qty];
}

async function call(handler, { body = {}, query = {} } = {}) {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  await handler({ body, query, user: { id: id(900) }, requestId: 'req-1' }, res);
  return res;
}

function reallocate(picks, idempotency_key = 'pick-key') {
  return call(reallocateBorrowReservation, { body: { reservation_id: RESERVATION_ID, warehouse_id: WAREHOUSE_ID, picks, idempotency_key } });
}

function consume(idempotency_key = 'consume-key') {
  return call(consumeBorrowReservation, {
    body: { reservation_id: RESERVATION_ID, loan_id: id(500), loan_number: 'LN-1', warehouse_id: WAREHOUSE_ID, idempotency_key },
  });
}

test('picked from shelf 03 while the hold sat on 04: consume takes the copy off 03, not 04', async () => {
  reset(1);

  const moved = await reallocate([{ location_id: SHELF.K03, quantity: 1 }]);
  assert.equal(moved.statusCode, 200);
  assert.deepEqual(counts(SHELF.K04), [5, 0, 0]);
  assert.deepEqual(counts(SHELF.K03), [1, 1, 0]);
  assert.equal(state.stock_reservations.find((row) => row.id === 'sr-1').status, 'REALLOCATED');
  const active = state.stock_reservations.filter((row) => row.status === 'ACTIVE');
  assert.deepEqual(active.map((row) => [row.location_id, row.quantity, row.reservation_code]), [[SHELF.K03, 1, 'RSV-0001/P2']]);
  assert.equal(state.integration_outbox.length, 0, 'moving a hold must not announce stock as released');

  const consumed = await consume();
  assert.equal(consumed.statusCode, 201);
  assert.equal(shelf(SHELF.K03).reserved_qty, 0);
  assert.equal(shelf(SHELF.K03).borrowed_qty, 1);
  assert.equal(shelf(SHELF.K04).borrowed_qty, 0);
  assert.equal(shelf(SHELF.K04).available_qty, 5);
});

test('two copies picked from shelves 03 and 05: each shelf gives up one copy', async () => {
  reset(2);

  const moved = await reallocate([{ location_id: SHELF.K03, quantity: 1 }, { location_id: SHELF.K05, quantity: 1 }]);
  assert.equal(moved.statusCode, 200);
  assert.equal(moved.body.data.length, 2);

  const consumed = await consume();
  assert.equal(consumed.statusCode, 201);
  assert.equal(consumed.body.movements.length, 2);
  assert.deepEqual(state.stock_movements.filter((row) => row.movement_type === 'BORROW').map((row) => [row.from_location_id, row.quantity, row.idempotency_key]), [
    [SHELF.K03, 1, 'consume-key'],
    [SHELF.K05, 1, 'consume-key#2'],
  ]);
  assert.deepEqual([shelf(SHELF.K03).borrowed_qty, shelf(SHELF.K04).borrowed_qty, shelf(SHELF.K05).borrowed_qty], [1, 0, 1]);
  assert.deepEqual([shelf(SHELF.K03).available_qty, shelf(SHELF.K04).available_qty, shelf(SHELF.K05).available_qty], [1, 5, 0]);

  const replay = await consume();
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(state.stock_movements.filter((row) => row.movement_type === 'BORROW').length, 2);
});

test('cancelling a split reservation returns each copy to its own shelf', async () => {
  reset(2);
  await reallocate([{ location_id: SHELF.K03, quantity: 1 }, { location_id: SHELF.K05, quantity: 1 }]);

  const released = await call(releaseBorrowReservation, { body: { reservation_id: RESERVATION_ID, reason: 'CANCELLED', idempotency_key: 'release-key' } });
  assert.equal(released.statusCode, 200);
  assert.equal(released.body.idempotent, false);
  assert.deepEqual([counts(SHELF.K03), counts(SHELF.K04), counts(SHELF.K05)], [[2, 0, 0], [5, 0, 0], [1, 0, 0]]);
  assert.equal(state.integration_outbox.filter((row) => row.event_type === 'inventory.reservation.released').length, 2);
});

test('rejected picks change nothing', async (t) => {
  const cases = [
    ['total differs from the reservation', [{ location_id: SHELF.K03, quantity: 2 }], 'PICK_QUANTITY_MISMATCH'],
    ['shelf of another warehouse', [{ location_id: SHELF.FOREIGN, quantity: 1 }], 'PICK_LOCATION_INVALID'],
    ['shelf with no free copy left on record', [{ location_id: SHELF.K05, quantity: 1 }], 'PICK_LOCATION_SHORT'],
  ];
  for (const [name, picks, code] of cases) {
    await t.test(name, async () => {
      reset(1);
      shelf(SHELF.K05).available_qty = 0;
      const before = structuredClone(state);
      const res = await reallocate(picks);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, code);
      assert.deepEqual(state, before);
    });
  }

  await t.test('malformed picks', async () => {
    reset(1);
    assert.equal((await reallocate([])).statusCode, 400);
    assert.equal((await reallocate([{ location_id: 'KE-03', quantity: 1 }])).statusCode, 400);
    assert.equal((await reallocate([{ location_id: SHELF.K03, quantity: 0 }])).statusCode, 400);
  });
});

test('same key replays; same key with other shelves conflicts; picking the held shelf is a no-op', async () => {
  reset(1);
  const first = await reallocate([{ location_id: SHELF.K03, quantity: 1 }]);
  const replay = await reallocate([{ location_id: SHELF.K03, quantity: 1 }]);
  assert.equal(first.statusCode, 200);
  assert.equal(replay.body.idempotent, true);
  assert.equal(shelf(SHELF.K03).reserved_qty, 1);

  const conflict = await reallocate([{ location_id: SHELF.K05, quantity: 1 }]);
  assert.equal(conflict.statusCode, 409);

  const unchanged = await reallocate([{ location_id: SHELF.K03, quantity: 1 }], 'another-key');
  assert.equal(unchanged.body.unchanged, true);
  assert.equal(state.stock_reservations.filter((row) => row.status === 'ACTIVE').length, 1);
});

test('pick options list free and held copies per shelf of the warehouse', async () => {
  reset(1);
  const res = await call(getBorrowPickOptions, { query: { variant_id: VARIANT_ID, warehouse_id: WAREHOUSE_ID, reservation_id: RESERVATION_ID } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data.map((row) => [row.location_code, row.available_qty, row.held_qty]), [
    ['KE-03', 2, 0],
    ['KE-04', 4, 1],
    ['KE-05', 1, 0],
  ]);
});
