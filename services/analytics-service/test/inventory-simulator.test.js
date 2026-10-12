const test = require('node:test');
const assert = require('node:assert/strict');
const { runInventoryBacktest, DAY_MS } = require('../eval/inventory-simulator');

const D0 = 20000; // arbitrary UTC day index
const at = (day, hour = 10) => (D0 + day) * DAY_MS + hour * 3600000;
// A request on `day` returned on `returnDay` (null = never returned in the horizon).
const req = (day, returnDay = null) => ({ at: at(day), returnAt: returnDay === null ? null : at(returnDay) });

function variant(requests, initialCopies, extra = {}) {
  return { variantId: 'v1', bookId: 'b1', title: 'T', unitCost: 1000, initialCopies, requests, ...extra };
}

function run(overrides) {
  return runInventoryBacktest({
    firstDay: D0,
    evalStartDay: D0,
    endDay: D0 + 10,
    reviewPeriodDays: 1,
    policy: { name: 'NONE', decide: () => ({ qty: 0 }) },
    leadTimeDays: () => 3,
    timelineVariantIds: ['v1'],
    ...overrides,
  });
}

test('unmet demand, fill rate and stockout days are counted per request and per day', () => {
  // 1 copy. Day 0: 3 requests -> 1 served (back on day 5), 2 unmet. Day 2: 1
  // request, shelf empty -> unmet. Day 5: copy back, 1 request served.
  const result = run({ variants: [variant([req(0, 5), req(0, 5), req(0, 5), req(2, 6), req(5, 7)], 1)] });
  const m = result.metrics;
  assert.equal(m.total_demand, 5);
  assert.equal(m.fulfilled_demand, 2);
  assert.equal(m.unmet_demand, 3);
  assert.equal(m.fill_rate, 2 / 5);
  assert.equal(m.stockout_days, 2); // days 0 and 2
  assert.equal(m.stockout_rate, 2 / 10);
  const timeline = result.timelines.v1;
  assert.deepEqual(timeline.map((d) => d.unmet), [2, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(timeline.map((d) => d.available_end), [0, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
});

test('an order only becomes stock after its lead time', () => {
  let ordered = false;
  const policy = { name: 'ONCE', decide: () => { if (ordered) return { qty: 0 }; ordered = true; return { qty: 4 }; } };
  const requests = Array.from({ length: 10 }, (_, d) => req(d)); // one never-returned borrow per day
  const result = run({ variants: [variant(requests, 0)], policy, leadTimeDays: () => 3 });
  const t = result.timelines.v1;
  assert.equal(t[0].ordered_qty, 4);
  // Days 0-2: nothing on the shelf, the order is only "on order".
  for (const d of [0, 1, 2]) {
    assert.equal(t[d].fulfilled, 0, `day ${d}`);
    assert.equal(t[d].on_order_end, 4);
    assert.equal(t[d].owned_end, 0);
  }
  assert.equal(t[3].received_qty, 4);
  assert.equal(t[3].owned_end, 4);
  assert.deepEqual(t.slice(3, 7).map((d) => d.fulfilled), [1, 1, 1, 1]);
  assert.equal(t[7].unmet, 1); // all 4 copies are out on loan
  assert.equal(result.metrics.procurement_cost, 4 * 1000);
  assert.equal(result.metrics.ordered_units, 4);
  assert.equal(result.metrics.order_count, 1);
  assert.equal(result.metrics.average_order_size, 4);
});

test('stock never goes negative and shelf + loans always equals owned copies', () => {
  // Pseudo-random heavy demand with random returns and random orders.
  let s = 7;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const requests = [];
  for (let d = 0; d < 60; d += 1) {
    const n = Math.floor(rnd() * 5);
    for (let k = 0; k < n; k += 1) requests.push(req(d, rnd() < 0.2 ? null : d + 1 + Math.floor(rnd() * 15)));
  }
  const policy = { name: 'RANDOM', decide: () => ({ qty: rnd() < 0.3 ? Math.floor(rnd() * 6) : 0 }) };
  const result = run({ variants: [variant(requests, 2)], policy, endDay: D0 + 60, leadTimeDays: () => 1 + Math.floor(rnd() * 5) });
  let ordered = 0;
  let received = 0;
  for (const day of result.timelines.v1) {
    assert.ok(day.available_end >= 0);
    assert.ok(day.available_end <= day.owned_end);
    assert.equal(day.fulfilled + day.unmet, day.demand);
    ordered += day.ordered_qty;
    received += day.received_qty;
    assert.equal(day.on_order_end, ordered - received);
    assert.equal(day.owned_end, 2 + received);
  }
});

test('the policy never sees today or later: history only holds borrows it served on earlier days', () => {
  const requests = Array.from({ length: 20 }, (_, d) => req(d, d + 2));
  const seen = [];
  const policy = {
    name: 'SPY',
    decide(ctx) {
      assert.ok(ctx.history.every((t) => t < ctx.dayStartMs), 'history contains a borrow from today or later');
      seen.push({ day: ctx.day, historyLength: ctx.history.length });
      return { qty: 0 };
    },
  };
  run({ variants: [variant(requests, 5)], policy, endDay: D0 + 20 });
  // Served one borrow per earlier day.
  for (const { day, historyLength } of seen) assert.equal(historyLength, day - D0);
});

test('decisions up to day k are identical for two timelines that only differ after day k', () => {
  const base = Array.from({ length: 30 }, (_, d) => req(d, d + 3));
  const altered = [...base.slice(0, 15), ...Array.from({ length: 15 }, (_, i) => [req(15 + i, 20 + i), req(15 + i, 20 + i), req(15 + i, 20 + i)]).flat()];
  const record = (log) => ({ name: 'LOG', decide(ctx) { log.push(`${ctx.day}:${ctx.available}:${ctx.history.length}`); return { qty: ctx.available < 2 ? 2 : 0 }; } });
  const a = [];
  const b = [];
  run({ variants: [variant(base, 2)], policy: record(a), endDay: D0 + 30 });
  run({ variants: [variant(altered, 2)], policy: record(b), endDay: D0 + 30 });
  // Decisions on days 0..15 only depend on borrows before day 15.
  assert.deepEqual(a.slice(0, 16), b.slice(0, 16));
  assert.notDeepEqual(a, b);
});

test('warm-up days are simulated but not scored, and reviews start with the scoring window', () => {
  const requests = Array.from({ length: 10 }, (_, d) => req(d, d + 1));
  const reviewDays = [];
  const policy = { name: 'P', decide: (ctx) => { reviewDays.push(ctx.day - D0); return { qty: 0 }; } };
  const result = run({ variants: [variant(requests, 1)], policy, evalStartDay: D0 + 4, reviewPeriodDays: 3 });
  assert.deepEqual(reviewDays, [4, 7]);
  assert.equal(result.metrics.total_demand, 6);
  assert.equal(result.metrics.evaluated_days, 6);
  assert.equal(result.timelines.v1.length, 6);
});

test('steady-state window only counts days and orders from steadyStartDay on', () => {
  const requests = [req(0, null), req(1, null), req(6, null)];
  const policy = { name: 'P', decide: (ctx) => ({ qty: ctx.day - D0 === 0 || ctx.day - D0 === 7 ? 1 : 0 }) };
  const result = run({ variants: [variant(requests, 0)], policy, steadyStartDay: D0 + 5, leadTimeDays: () => 2 });
  assert.equal(result.metrics.total_demand, 3);
  assert.equal(result.steadyStateMetrics.total_demand, 1);
  assert.equal(result.steadyStateMetrics.fulfilled_demand, 1); // the day-0 order arrived on day 2
  assert.equal(result.metrics.ordered_units, 2);
  assert.equal(result.steadyStateMetrics.ordered_units, 1);
  assert.equal(result.steadyStateMetrics.evaluated_days, 5);
});

test('budget: candidates are funded in rank order and the rest are counted as unfunded', () => {
  const variants = [
    variant([], 0, { variantId: 'cheap', unitCost: 100 }),
    variant([], 0, { variantId: 'pricey', unitCost: 1000 }),
  ];
  const policy = {
    name: 'B',
    decide: (ctx) => ({ qty: 2, candidate: { rank: ctx.variant.variantId === 'pricey' ? 0 : 1 } }),
  };
  const result = runInventoryBacktest({
    variants, firstDay: D0, evalStartDay: D0, endDay: D0 + 2, reviewPeriodDays: 1, policy, leadTimeDays: () => 1,
    budgetPerReview: 2100, rankCandidates: (a, b) => a.rank - b.rank,
  });
  // Each review: pricey (2000) funded first, cheap (200) no longer fits.
  assert.equal(result.metrics.procurement_cost, 4000);
  assert.equal(result.metrics.unfunded_reorder_count, 2);
  assert.equal(result.metrics.budget_total, 4200);
  assert.equal(result.metrics.budget_utilization, 4000 / 4200);
});

test('rejects a lead time that is not a positive whole number of days', () => {
  const policy = { name: 'P', decide: () => ({ qty: 1 }) };
  assert.throws(() => run({ variants: [variant([], 0)], policy, leadTimeDays: () => 0 }), /lead time/);
});
