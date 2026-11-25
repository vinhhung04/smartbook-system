// /late-return-risk and /reservation-no-show-risk list readers by name, so the
// scored rows follow the caller's branch scope (req.warehouseScope from
// attachWarehouseScope). The models still train on every branch: they expose
// weights only. The database layer is replaced; the SQL and params are inspected.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const DAY = 86_400_000;
const base = Date.parse('2026-01-01T00:00:00Z');
const seen = [];

const loan = (i, priorLate) => {
  const due = base + (i % 300 + 14) * DAY;
  const late = priorLate >= 3 ? i % 7 !== 0 : i % 11 === 0;
  return {
    loan_item_id: `l${i}`, variant_id: `v${i}`, customer_name: `Bạn đọc ${i}`,
    borrow_date: new Date(base + (i % 300) * DAY).toISOString(),
    original_due_date: new Date(due).toISOString(), due_date: new Date(due).toISOString(),
    return_date: new Date(due + (late ? 3 : -1) * DAY).toISOString(),
    items_in_loan: 1, prior_loans: 5, prior_late_count: priorLate, prior_renewal_count: 0,
    customer_created_at: new Date(base - 365 * DAY).toISOString(), unpaid_fines_at_checkout: 0,
    plan_max_loan_days: 14, plan_fine_per_day: 1000, from_reservation: false, condition_worn_at_checkout: false,
  };
};
const reservation = (i) => {
  const reserved = base + (i % 300) * DAY;
  const noShow = i % 4 === 0;
  return {
    reservation_id: `r${i}`, variant_id: `v${i}`, customer_name: `Bạn đọc ${i}`,
    status: noShow ? 'EXPIRED' : 'CONVERTED_TO_LOAN',
    reserved_at: new Date(reserved).toISOString(), expires_at: new Date(reserved + 3 * DAY).toISOString(),
    pickup_code_issued_at: new Date(reserved + DAY).toISOString(),
    pickup_code_used_at: noShow ? null : new Date(reserved + 2 * DAY).toISOString(),
    quantity: 1, source_channel: i % 2 ? 'WEB' : 'COUNTER', customer_created_at: new Date(base - 365 * DAY).toISOString(),
    prior_reservations: 4, prior_no_show_count: noShow ? 3 : 0, unpaid_fines_at_reservation: 0, active_loans_at_reservation: 1,
  };
};
const loanHistory = Array.from({ length: 400 }, (_, i) => loan(i, i % 5));
const reservationHistory = Array.from({ length: 400 }, (_, i) => reservation(i));

const dbPath = path.join(__dirname, '..', 'src', 'lib', 'db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    inventoryPool: 'inventory',
    borrowPool: 'borrow',
    async query(pool, text, params) {
      seen.push({ text, params });
      if (text.includes('WHERE li.return_date IS NOT NULL')) return loanHistory;
      if (text.includes("WHERE r.pickup_code_issued_at IS NOT NULL")) return reservationHistory;
      return [];
    },
    async queryOne() { return {}; },
    async pingDatabases() { return { inventory: true, borrow: true }; },
  },
};

const c = require('../src/controllers/analytics.controller');

const run = (handler, warehouseScope, query = {}) => new Promise((resolve, reject) => {
  handler({ query, user: { id: 'u', permissions: ['analytics.borrow.read'] }, warehouseScope, headers: {} },
    { json: (body) => resolve(body.data) }, reject);
});

const cases = [
  ['late-return', c.getLateReturnRisk, 'WHERE li.return_date IS NULL', /lt\.warehouse_id = ANY\(\$1::uuid\[\]\)/],
  ['no-show', c.getReservationNoShowRisk, "WHERE r.status = 'READY_FOR_PICKUP'", /r\.warehouse_id = ANY\(\$1::uuid\[\]\)/],
];

for (const [name, handler, marker, filter] of cases) {
  test(`${name}: scored rows are limited to the caller's branches`, async () => {
    seen.length = 0;
    const data = await run(handler, new Set(['br-a']), name === 'late-return' ? { dueWithinDays: '7' } : {});
    assert.equal(data.status, undefined, data.reason);
    const scoring = seen.find((q) => q.text.includes(marker));
    assert.ok(scoring, 'scoring query ran');
    assert.match(scoring.text, filter);
    assert.deepEqual(scoring.params[0], ['br-a']);
  });

  test(`${name}: an empty scope scores nothing, never every branch`, async () => {
    seen.length = 0;
    await run(handler, new Set());
    assert.deepEqual(seen.find((q) => q.text.includes(marker)).params[0], []);
  });

  test(`${name}: superuser / internal call passes NULL (every branch)`, async () => {
    seen.length = 0;
    await run(handler, null);
    assert.equal(seen.find((q) => q.text.includes(marker)).params[0], null);
  });
}

test('late-return: dueWithinDays still binds to its own parameter', async () => {
  seen.length = 0;
  await run(c.getLateReturnRisk, new Set(['br-a']), { dueWithinDays: '7' });
  const scoring = seen.find((q) => q.text.includes('WHERE li.return_date IS NULL'));
  assert.match(scoring.text, /\(\$2 \|\| ' days'\)/);
  assert.equal(scoring.params[1], 7);
});
