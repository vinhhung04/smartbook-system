const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const express = require('express');

const {
  PUBLIC_PLAN_SELECT,
  createPublicMembershipRouter,
  listPublicPlans,
} = require('../src/routes/public-membership.routes');
const publicMembershipRoutes = require('../src/routes/public-membership.routes');

// Rows as the database holds them, including columns that must never reach
// the public page (plan code, audit timestamps, member counts).
const PLAN_ROWS = [
  { id: 'p-gold', code: 'GOLD', name: 'Vàng', description: 'Gói cao cấp', max_active_loans: 8, max_loan_days: 30, max_renewal_count: 3, reservation_hold_hours: 48, fine_per_day: '2000.00', lost_item_fee_multiplier: '1.20', is_active: true, created_at: new Date('2026-01-02'), updated_at: new Date('2026-01-03'), _count: { customer_memberships: 40 } },
  { id: 'p-basic', code: 'BASIC', name: 'Cơ bản', description: null, max_active_loans: 3, max_loan_days: 14, max_renewal_count: 1, reservation_hold_hours: 24, fine_per_day: '5000.00', lost_item_fee_multiplier: '1.50', is_active: true, created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'), _count: { customer_memberships: 120 } },
  { id: 'p-old', code: 'LEGACY', name: 'Ngừng áp dụng', description: 'Cũ', max_active_loans: 2, max_loan_days: 7, max_renewal_count: 0, reservation_hold_hours: 12, fine_per_day: '9000.00', lost_item_fee_multiplier: '2.00', is_active: false, created_at: new Date('2025-01-01'), updated_at: new Date('2025-01-01') },
];

/** Minimal Prisma stand-in that honours where/orderBy/select the way the route uses them. */
function mockClient(rows = PLAN_ROWS) {
  const calls = [];
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => row[key] === value);
  const project = (row, select) => (select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : row);
  return {
    calls,
    membership_plans: {
      findMany: async (args) => {
        calls.push({ op: 'findMany', args });
        return rows.filter((row) => matches(row, args.where))
          .sort((a, b) => a.max_active_loans - b.max_active_loans)
          .map((row) => project(row, args.select));
      },
      findFirst: async (args) => {
        calls.push({ op: 'findFirst', args });
        const found = rows.filter((row) => matches(row, args.where)).sort((a, b) => a.created_at - b.created_at)[0];
        return found ? project(found, args.select) : null;
      },
    },
  };
}

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

async function withServer(router, run) {
  const app = express();
  app.use('/public/membership', router);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}/public/membership`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('public membership router exposes GET /plans only', () => {
  const endpoints = publicMembershipRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.deepEqual(endpoints, ['GET /plans']);
});

test('select never asks for the plan code, audit fields or member counts', () => {
  for (const key of ['code', 'created_at', 'updated_at', '_count', 'customer_memberships', 'lost_item_fee_multiplier', 'is_active']) {
    assert.equal(key in PUBLIC_PLAN_SELECT, false, `select must not include ${key}`);
  }
});

test('anonymous GET returns active plans only, as a whitelist, with numeric fees', async () => {
  const client = mockClient();
  await withServer(createPublicMembershipRouter(client), async (base) => {
    const response = await fetch(`${base}/plans`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /public/);
    const body = await response.json();
    assert.deepEqual(body.data.map((plan) => plan.name), ['Cơ bản', 'Vàng']);
    assert.deepEqual(Object.keys(body.data[0]).sort(), [
      'description', 'fine_per_day', 'id', 'is_default', 'max_active_loans', 'max_loan_days',
      'max_renewal_count', 'name', 'reservation_hold_hours',
    ]);
    assert.equal(body.data[0].fine_per_day, 5000);
    assert.equal(body.data[0].description, null);
    assert.equal(body.card_validity_days, 365);
    const keys = collectKeys(body);
    for (const key of ['code', 'created_at', 'updated_at', '_count', 'customer_memberships', 'note', 'card_number', 'customer_id']) {
      assert.equal(keys.has(key), false, `leaked ${key}`);
    }
  });
  const listCall = client.calls.find((call) => call.op === 'findMany');
  assert.deepEqual(listCall.args.where, { is_active: true });
});

test('is_default marks the plan new accounts receive: configured code first, else the oldest active plan', async () => {
  const previous = process.env.DEFAULT_MEMBERSHIP_PLAN_CODE;
  try {
    process.env.DEFAULT_MEMBERSHIP_PLAN_CODE = 'GOLD';
    let body = await listPublicPlans(mockClient());
    assert.deepEqual(body.data.filter((plan) => plan.is_default).map((plan) => plan.name), ['Vàng']);

    // Configured code missing (the seed has no STANDARD plan): oldest active plan, never an inactive one.
    process.env.DEFAULT_MEMBERSHIP_PLAN_CODE = 'STANDARD';
    body = await listPublicPlans(mockClient());
    assert.deepEqual(body.data.filter((plan) => plan.is_default).map((plan) => plan.name), ['Cơ bản']);

    body = await listPublicPlans(mockClient([]));
    assert.deepEqual(body.data, []);
  } finally {
    if (previous === undefined) delete process.env.DEFAULT_MEMBERSHIP_PLAN_CODE;
    else process.env.DEFAULT_MEMBERSHIP_PLAN_CODE = previous;
  }
});

test('writes under /public/membership are not routed and a failing database is a 500, not a crash', async () => {
  await withServer(createPublicMembershipRouter(mockClient()), async (base) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${base}/plans`, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 404, method);
    }
  });
  const broken = { membership_plans: { findMany: async () => { throw new Error('db down'); }, findFirst: async () => null } };
  const originalError = console.error;
  console.error = () => {};
  try {
    await withServer(createPublicMembershipRouter(broken), async (base) => {
      const response = await fetch(`${base}/plans`);
      assert.equal(response.status, 500);
      assert.equal(JSON.stringify(await response.json()).includes('db down'), false);
    });
  } finally {
    console.error = originalError;
  }
});
