const test = require('node:test');
const assert = require('node:assert/strict');

let state;
const matches = (row, where) => Object.entries(where || {}).every(([k, v]) => v && typeof v === 'object' && 'gte' in v ? row[k] >= v.gte : row[k] === v);
function model(name) {
  return {
    async findUnique({ where }) { return state[name].find((r) => matches(r, where)) || null; },
    async findFirst({ where }) { return state[name].find((r) => matches(r, where)) || null; },
    async create({ data }) { const row = { id: `${name}-${state[name].length}`, ...data }; state[name].push(row); return row; },
    async update({ where, data }) { const row = state[name].find((r) => matches(r, where)); Object.assign(row, data); return row; },
    async updateMany({ where, data }) {
      const rows = state[name].filter((r) => matches(r, where));
      for (const row of rows) for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : v && typeof v === 'object' && 'decrement' in v ? row[k] - v.decrement : v;
      return { count: rows.length };
    },
  };
}
class FakePrismaClient {
  constructor() { for (const n of ['stock_reservations', 'stock_balances', 'stock_movements', 'integration_outbox', 'inventory_units']) this[n] = model(n); }
  async $transaction(fn) { return fn(this); }
  async $queryRawUnsafe() { return []; }
}
require.cache[require.resolve('@prisma/client')] = { id: require.resolve('@prisma/client'), filename: require.resolve('@prisma/client'), loaded: true, exports: { PrismaClient: FakePrismaClient } };
const { releaseBorrowReservation, consumeBorrowReservation, returnBorrowedLoan } = require('../src/controllers/borrow-integration.controller');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { reservation_id: id(1), loan_id: id(2), loan_number: 'LN-1', variant_id: id(3), warehouse_id: id(4), quantity: 1, idempotency_key: 'same-key' };
function reset() {
  state = {
    stock_reservations: [{ id: id(5), source_service: 'BORROW', source_reference_id: id(1), status: 'ACTIVE', variant_id: id(3), warehouse_id: id(4), location_id: id(6), quantity: 1 }],
    stock_balances: [{ variant_id: id(3), warehouse_id: id(4), location_id: id(6), reserved_qty: 1, borrowed_qty: 1, available_qty: 0, on_hand_qty: 2, damaged_qty: 0 }],
    stock_movements: [], integration_outbox: [], inventory_units: [],
  };
}
async function call(fn, body) {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await fn({ body, user: {}, requestId: 'test' }, res); return res;
}
for (const [name, fn, differences] of [
  ['release', releaseBorrowReservation, [{ reservation_id: id(10) }, { reason: 'EXPIRED' }, { warehouse_id: id(11) }, { quantity: 2 }]],
  ['consume', consumeBorrowReservation, [{ reservation_id: id(10) }, { loan_id: id(11) }, { warehouse_id: id(12) }, { quantity: 2 }]],
  ['return', returnBorrowedLoan, [{ loan_id: id(11) }, { loan_item_id: id(12) }, { variant_id: id(13) }, { warehouse_id: id(14) }, { quantity: 2 }, { item_condition_on_return: 'DAMAGED' }, { mark_lost: true }, { location_id: id(15) }]],
]) {
  test(`SB-22 ${name}: identical retry replays once`, async () => {
    reset(); const first = await call(fn, base); assert.ok([200, 201].includes(first.statusCode));
    const replay = await call(fn, base); assert.equal(replay.statusCode, 200); assert.equal(replay.body.idempotent, true); assert.equal(state.stock_movements.length, 1);
  });
  test(`SB-22 ${name}: pre-upgrade movement supports an identical retry`, async () => {
    reset(); await call(fn, base);
    delete state.stock_movements[0].metadata.borrow_request;
    const replay = await call(fn, base);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.idempotent, true);
    assert.equal(state.stock_movements.length, 1);
  });
  for (const diff of differences) test(`SB-22 ${name}: key reused with ${Object.keys(diff)[0]} conflicts`, async () => {
    reset(); await call(fn, base); const before = structuredClone(state);
    const replay = await call(fn, { ...base, ...diff }); assert.equal(replay.statusCode, 409); assert.deepEqual(state, before);
  });
}
test('SB-22: a release key cannot acknowledge a consume request', async () => {
  reset(); await call(releaseBorrowReservation, base);
  assert.equal((await call(consumeBorrowReservation, base)).statusCode, 409);
});

test('SB-22: legacy lost-return retries keep accepting the original explicit location', async () => {
  reset(); const body = { ...base, mark_lost: true, location_id: id(6) };
  assert.equal((await call(returnBorrowedLoan, body)).statusCode, 201);
  delete state.stock_movements[0].metadata.borrow_request;
  const replay = await call(returnBorrowedLoan, body);
  assert.equal(replay.statusCode, 200);
  assert.equal(state.stock_movements.length, 1);
});
