const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const express = require('express');

const {
  assignDefaultMembership,
  findDefaultMembershipPlan,
  resolveActiveMembership,
  setDefaultMembershipPlan,
} = require('../src/services/membership.service');

// Membership plans carry their own price/duration and an explicit default flag.
// A new account gets the flagged plan's card for that plan's duration — never a
// plan picked by name, created_at or database row order.

function matches(row, where = {}) {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && 'not' in cond) return row[key] !== cond.not;
    return row[key] === cond;
  });
}

function planStore(plans) {
  const state = { plans: plans.map((plan) => ({ ...plan })), memberships: [], rawLocks: 0 };
  const client = {
    state,
    membership_plans: {
      // Deliberately returns rows in reverse insertion order: nothing may depend on it.
      async findMany({ where, take }) { return state.plans.filter((row) => matches(row, where)).reverse().slice(0, take ?? Infinity).map((row) => ({ ...row })); },
      async findFirst({ where }) { const row = [...state.plans].reverse().find((item) => matches(item, where)); return row ? { ...row } : null; },
      async findUnique({ where }) { const row = state.plans.find((item) => item.id === where.id); return row ? { ...row } : null; },
      async updateMany({ where, data }) {
        const hits = state.plans.filter((row) => matches(row, where));
        hits.forEach((row) => Object.assign(row, data));
        return { count: hits.length };
      },
      async update({ where, data }) {
        const row = state.plans.find((item) => item.id === where.id);
        if (!row) { const error = new Error('not found'); error.code = 'P2025'; throw error; }
        Object.assign(row, data);
        return { ...row };
      },
      async create({ data }) {
        const row = { id: `plan-${state.plans.length + 1}`, is_active: true, is_default: false, price: 0, duration_days: 365, ...data };
        state.plans.push(row);
        return { ...row };
      },
    },
    customer_memberships: {
      async create({ data }) { const row = { id: `m-${state.memberships.length + 1}`, ...data }; state.memberships.push(row); return row; },
    },
    async $executeRaw() { state.rawLocks += 1; return 0; },
    async $transaction(fn) { return fn(client); },
  };
  return client;
}

const plan = (id, overrides = {}) => ({
  id, code: id.toUpperCase(), name: id, is_active: true, is_default: false, price: 0, duration_days: 365,
  max_active_loans: 3, max_loan_days: 14, max_renewal_count: 1, reservation_hold_hours: 24, fine_per_day: 5000, lost_item_fee_multiplier: 1,
  created_at: new Date('2026-01-01'), ...overrides,
});

function withoutEnvDefault(fn) {
  return async () => {
    const previous = process.env.DEFAULT_MEMBERSHIP_PLAN_CODE;
    delete process.env.DEFAULT_MEMBERSHIP_PLAN_CODE;
    try { await fn(); } finally {
      if (previous !== undefined) process.env.DEFAULT_MEMBERSHIP_PLAN_CODE = previous;
    }
  };
}

// ── default plan ─────────────────────────────────────────────────────────────

test('the default plan is the flagged one, whatever the creation order or names say', withoutEnvDefault(async () => {
  // Same created_at for every plan, like the demo seed; the oldest/"STANDARD"-named plan is not flagged.
  const client = planStore([plan('standard'), plan('basic'), plan('silver', { is_default: true }), plan('gold')]);
  assert.equal((await findDefaultMembershipPlan(client)).id, 'silver');
  assert.equal((await findDefaultMembershipPlan(client)).id, 'silver', 'stable across calls');
}));

test('an inactive plan is never the default, and a misconfigured double default is an error, not a coin toss', withoutEnvDefault(async () => {
  assert.equal(await findDefaultMembershipPlan(planStore([plan('basic', { is_default: true, is_active: false }), plan('gold')])), null);
  await assert.rejects(
    findDefaultMembershipPlan(planStore([plan('a', { is_default: true }), plan('b', { is_default: true })])),
    /More than one default membership plan/,
  );
}));

test('without a flag, only an explicitly configured code is used — no fallback to the oldest plan', async () => {
  const previous = process.env.DEFAULT_MEMBERSHIP_PLAN_CODE;
  try {
    process.env.DEFAULT_MEMBERSHIP_PLAN_CODE = 'GOLD';
    assert.equal((await findDefaultMembershipPlan(planStore([plan('basic'), plan('gold')]))).id, 'gold');
    delete process.env.DEFAULT_MEMBERSHIP_PLAN_CODE;
    assert.equal(await findDefaultMembershipPlan(planStore([plan('basic'), plan('gold')])), null);
  } finally {
    if (previous === undefined) delete process.env.DEFAULT_MEMBERSHIP_PLAN_CODE;
    else process.env.DEFAULT_MEMBERSHIP_PLAN_CODE = previous;
  }
});

// ── card issued at sign-up ───────────────────────────────────────────────────

test('a new account gets the default plan, valid for that plan\'s duration_days', withoutEnvDefault(async () => {
  const client = planStore([plan('basic'), plan('half-year', { is_default: true, duration_days: 180 })]);
  const startDate = new Date('2026-10-06T00:00:00.000Z');
  const assigned = await assignDefaultMembership(client, { customerId: 'cust-1', cardNumber: 'CARD-1', note: 'test', startDate });

  assert.equal(assigned.plan.id, 'half-year');
  const [membership] = client.state.memberships;
  assert.equal(membership.plan_id, 'half-year');
  assert.equal(membership.status, 'ACTIVE');
  assert.equal(membership.start_date.toISOString(), '2026-10-06T00:00:00.000Z');
  assert.equal(membership.end_date.toISOString(), '2027-04-04T00:00:00.000Z');
}));

test('with no active default plan nothing is assigned (no invented "Standard Plan")', withoutEnvDefault(async () => {
  const client = planStore([plan('basic', { is_default: true, is_active: false })]);
  assert.equal(await assignDefaultMembership(client, { customerId: 'cust-1', cardNumber: 'CARD-1' }), null);
  assert.equal(client.state.memberships.length, 0);
  assert.equal(client.state.plans.length, 1);
}));

test('switching the default flags exactly one plan and refuses an inactive plan', async () => {
  const client = planStore([plan('basic', { is_default: true }), plan('gold'), plan('old', { is_active: false })]);
  const result = await setDefaultMembershipPlan(client, 'gold');
  assert.equal(result.plan.id, 'gold');
  assert.deepEqual(client.state.plans.filter((row) => row.is_default).map((row) => row.id), ['gold']);
  assert.equal(client.state.rawLocks, 1, 'serialized with an advisory lock');

  assert.deepEqual(await setDefaultMembershipPlan(client, 'old'), { error: 'INACTIVE' });
  assert.deepEqual(await setDefaultMembershipPlan(client, 'missing'), { error: 'NOT_FOUND' });
  assert.deepEqual(client.state.plans.filter((row) => row.is_default).map((row) => row.id), ['gold']);
});

// ── limits still come from the plan ──────────────────────────────────────────

function membershipClient(membership) {
  return { customer_memberships: { findFirst: async () => membership } };
}

test('membership limits come from the plan, with per-card overrides', async () => {
  const goldPlan = plan('gold', { max_active_loans: 8, max_loan_days: 30, max_renewal_count: 3, reservation_hold_hours: 48, fine_per_day: '2000.00' });
  const info = await resolveActiveMembership(membershipClient({ id: 'm1', max_active_loans_override: null, max_loan_days_override: 21, membership_plans: goldPlan }), 'cust-1');
  assert.deepEqual(
    { ...info.limits, lost_item_fee_multiplier: undefined },
    { max_active_loans: 8, max_loan_days: 21, max_renewal_count: 3, reservation_hold_hours: 48, fine_per_day: 2000, lost_item_fee_multiplier: undefined },
  );
});

test('a card on a deactivated plan grants no membership (so no new loans or reservations)', async () => {
  const info = await resolveActiveMembership(membershipClient({ id: 'm1', membership_plans: plan('old', { is_active: false }) }), 'cust-1');
  assert.equal(info, null);
});

test('the reader sees plan name, card dates, benefits, limits and price', () => {
  const { toMembershipView } = require('../src/controllers/customer.controller');
  const view = toMembershipView('cust-1', {
    membership: { id: 'm1', card_number: 'CARD-1', status: 'ACTIVE', start_date: new Date('2026-01-01'), end_date: new Date('2027-01-01') },
    plan: { id: 'p1', code: 'SILVER', name: 'Thẻ Bạc', description: 'Gói trung cấp', price: '50000.00', duration_days: 365 },
    limits: { max_active_loans: 5, max_loan_days: 21, max_renewal_count: 2, reservation_hold_hours: 36, fine_per_day: 3000, lost_item_fee_multiplier: 1.3 },
  }, 2, '0.00');
  assert.equal(view.plan_name, 'Thẻ Bạc');
  assert.equal(view.plan_description, 'Gói trung cấp');
  assert.equal(view.price, 50000);
  assert.equal(view.duration_days, 365);
  assert.equal(view.start_date.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(view.end_date.toISOString(), '2027-01-01T00:00:00.000Z');
  assert.equal(view.limits.max_active_loans, 5);
  assert.equal(view.limits.reservation_hold_hours, 36);
  assert.equal(view.limits.max_renewal_count, 2);
  assert.equal(view.remaining_loan_slots, 3);
});

// ── staff plan management ────────────────────────────────────────────────────

function loadPlanRoutes(client) {
  const prismaPath = require.resolve('../src/lib/prisma');
  const routesPath = require.resolve('../src/routes/membership-plan.routes');
  const saved = require.cache[prismaPath];
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: client } };
  delete require.cache[routesPath];
  const router = require('../src/routes/membership-plan.routes');
  if (saved) require.cache[prismaPath] = saved; else delete require.cache[prismaPath];
  return router;
}

async function withPlanServer(client, run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { is_superuser: true }; next(); });
  app.use('/plans', loadPlanRoutes(client));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}/plans`;
  const send = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  try { await run(send); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('staff can set price/duration and move the default, but cannot leave the system without one', async () => {
  const client = planStore([plan('basic', { is_default: true }), plan('gold')]);
  await withPlanServer(client, async (send) => {
    let res = await send('PATCH', '/gold', { price: 120000, duration_days: 180, is_default: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.is_default, true);
    assert.deepEqual(client.state.plans.filter((row) => row.is_default).map((row) => row.id), ['gold']);
    assert.equal(client.state.plans.find((row) => row.id === 'gold').duration_days, 180);

    res = await send('PATCH', '/gold', { is_active: false });
    assert.equal(res.status, 409, 'default plan cannot be deactivated');
    res = await send('PATCH', '/gold', { is_default: false });
    assert.equal(res.status, 400);

    for (const body of [{ price: -1 }, { price: 'abc' }, { duration_days: 0 }, { duration_days: 1.5 }]) {
      res = await send('PATCH', '/basic', body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }

    res = await send('PATCH', '/basic', { is_active: false });
    assert.equal(res.status, 200, 'a non-default plan can still be deactivated');
    res = await send('PATCH', '/basic', { is_default: true });
    assert.equal(res.status, 409, 'an inactive plan cannot become the default');
    assert.deepEqual(client.state.plans.filter((row) => row.is_default).map((row) => row.id), ['gold']);
  });
});

// ── numeric plan limits: 0 is a value, not "missing" ─────────────────────────

const PLAN_DEFAULTS = {
  max_active_loans: 5, max_loan_days: 14, max_renewal_count: 2, reservation_hold_hours: 24,
  fine_per_day: 0, lost_item_fee_multiplier: 1, price: 0, duration_days: 365,
};

test('POST keeps max_renewal_count 0 (no renewals) and other explicit zeros; omitted fields get defaults', async () => {
  const client = planStore([plan('basic', { is_default: true })]);
  await withPlanServer(client, async (send) => {
    let res = await send('POST', '/', { code: 'norenew', name: 'Không gia hạn', max_renewal_count: 0, fine_per_day: 0, lost_item_fee_multiplier: 0, price: 0 });
    assert.equal(res.status, 201);
    const created = client.state.plans.find((row) => row.code === 'NORENEW');
    assert.equal(created.max_renewal_count, 0);
    assert.equal(created.lost_item_fee_multiplier, 0);
    for (const key of ['max_active_loans', 'max_loan_days', 'reservation_hold_hours', 'duration_days']) {
      assert.equal(created[key], PLAN_DEFAULTS[key], key);
    }

    res = await send('POST', '/', { code: 'defaults', name: 'Mặc định' });
    assert.equal(res.status, 201);
    const defaults = client.state.plans.find((row) => row.code === 'DEFAULTS');
    for (const [key, value] of Object.entries(PLAN_DEFAULTS)) assert.equal(defaults[key], value, key);

    // Numeric strings from the HTML form are parsed explicitly.
    res = await send('POST', '/', { code: 'form', name: 'Form', max_active_loans: '5', max_renewal_count: '0', price: '100000' });
    assert.equal(res.status, 201);
    const fromForm = client.state.plans.find((row) => row.code === 'FORM');
    assert.deepEqual([fromForm.max_active_loans, fromForm.max_renewal_count, fromForm.price], [5, 0, 100000]);
  });
});

test('PATCH max_renewal_count 0 is stored as 0; only the sent fields change', async () => {
  const client = planStore([plan('basic', { is_default: true, max_renewal_count: 3, max_active_loans: 4 })]);
  await withPlanServer(client, async (send) => {
    const res = await send('PATCH', '/basic', { max_renewal_count: 0 });
    assert.equal(res.status, 200);
    const row = client.state.plans.find((item) => item.id === 'basic');
    assert.equal(row.max_renewal_count, 0);
    assert.equal(row.max_active_loans, 4, 'untouched');
  });
});

test('out-of-range, fractional and non-numeric limits are rejected (400), never coerced', async () => {
  const invalid = [
    { max_active_loans: 0 }, { max_active_loans: -1 }, { max_active_loans: 1.5 },
    { max_loan_days: 0 },
    { max_renewal_count: -1 }, { max_renewal_count: 2.5 },
    { reservation_hold_hours: 0 },
    { fine_per_day: -1 }, { fine_per_day: 0.005 },
    { lost_item_fee_multiplier: -0.1 }, { lost_item_fee_multiplier: 1000 },
    { price: -1000 }, { price: -1 },
    { duration_days: 0 }, { duration_days: 30.5 },
    { max_active_loans: 'abc' }, { max_active_loans: '' }, { max_active_loans: null }, { max_active_loans: true },
    { price: 'Infinity' }, { duration_days: 'NaN' }, { max_loan_days: 2147483648 },
  ];
  const original = plan('basic', { is_default: true, max_active_loans: 4, max_renewal_count: 3, price: 0 });
  const client = planStore([original]);
  await withPlanServer(client, async (send) => {
    for (const body of invalid) {
      const patched = await send('PATCH', '/basic', body);
      assert.equal(patched.status, 400, `PATCH ${JSON.stringify(body)}`);
      const created = await send('POST', '/', { code: `bad${Math.random().toString(36).slice(2, 7)}`, name: 'x', ...body });
      assert.equal(created.status, 400, `POST ${JSON.stringify(body)}`);
    }
  });
  const row = client.state.plans.find((item) => item.id === 'basic');
  assert.deepEqual([row.max_active_loans, row.max_renewal_count, row.price], [4, 3, 0]);
  assert.equal(client.state.plans.length, 1, 'no invalid plan was created');
});
