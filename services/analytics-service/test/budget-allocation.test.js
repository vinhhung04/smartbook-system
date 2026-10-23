const test = require('node:test');
const assert = require('node:assert/strict');
const { allocateBudget } = require('../src/utils/budget-allocation');

test('funds items in order while the budget lasts', () => {
  const result = allocateBudget(
    [
      { title: 'A', estimated_cost: 100000 },
      { title: 'B', estimated_cost: 50000 },
      { title: 'C', estimated_cost: 80000 },
    ],
    150000,
  );

  assert.equal(result.items[0].within_budget, true); // 100k <= 150k remaining
  assert.equal(result.items[1].within_budget, true); // 50k <= 50k remaining
  assert.equal(result.items[2].within_budget, false); // 80k > 0k remaining
  assert.equal(result.funded_cost, 150000);
  assert.equal(result.remaining_vnd, 0);
});

test('skips an item that does not fit but keeps funding cheaper ones behind it', () => {
  const result = allocateBudget(
    [
      { title: 'expensive', estimated_cost: 200000 },
      { title: 'cheap', estimated_cost: 30000 },
    ],
    100000,
  );

  assert.equal(result.items[0].within_budget, false);
  assert.equal(result.items[1].within_budget, true);
  assert.equal(result.funded_cost, 30000);
  assert.equal(result.remaining_vnd, 70000);
});

test('zero budget funds only free (zero-cost) items', () => {
  const result = allocateBudget(
    [
      { title: 'free', estimated_cost: 0 },
      { title: 'paid', estimated_cost: 1 },
    ],
    0,
  );

  assert.equal(result.items[0].within_budget, true);
  assert.equal(result.items[1].within_budget, false);
  assert.equal(result.funded_cost, 0);
  assert.equal(result.remaining_vnd, 0);
});

test('handles an empty candidate list', () => {
  const result = allocateBudget([], 500000);
  assert.deepEqual(result.items, []);
  assert.equal(result.funded_cost, 0);
  assert.equal(result.remaining_vnd, 500000);
});

test('does not mutate the input items', () => {
  const items = [{ title: 'A', estimated_cost: 10 }];
  allocateBudget(items, 100);
  assert.equal(items[0].within_budget, undefined);
});

const { allocateBudgetInOrder } = require('../src/utils/budget-allocation');
const { compareByShortfallPerCost } = require('../src/utils/reorder-suggestion');

test('budget funds the most expected shortfall per VND first but keeps the display order', () => {
  // Display (priority) order: an expensive HIGH line with little shortfall first.
  const items = [
    { title: 'A', priority: 'HIGH', demand_score: 50, suggested_reorder_qty: 5, available_qty: 4, lead_time_demand: 5, estimated_cost: 500000 },
    { title: 'B', priority: 'MEDIUM', demand_score: 10, suggested_reorder_qty: 3, available_qty: 0, lead_time_demand: 4, estimated_cost: 150000 },
    { title: 'C', priority: 'MEDIUM', demand_score: 8, suggested_reorder_qty: 3, available_qty: 0, lead_time_demand: 3, estimated_cost: 150000 },
  ];
  const result = allocateBudgetInOrder(items, 400000, compareByShortfallPerCost);
  assert.deepEqual(result.items.map((i) => i.title), ['A', 'B', 'C']); // order unchanged
  assert.deepEqual(result.items.map((i) => i.within_budget), [false, true, true]);
  assert.equal(result.funded_cost, 300000);
  assert.equal(result.remaining_vnd, 100000);
});

test('lines with no lead-time shortfall are funded after every line that has one; ties keep priority order', () => {
  const safetyOnly = { title: 'S', priority: 'HIGH', demand_score: 99, suggested_reorder_qty: 5, available_qty: 9, lead_time_demand: 2, estimated_cost: 10000 };
  const short = { title: 'X', priority: 'LOW', demand_score: 1, suggested_reorder_qty: 1, available_qty: 0, lead_time_demand: 1, estimated_cost: 900000 };
  assert.ok(compareByShortfallPerCost(short, safetyOnly) < 0);
  const high = { ...safetyOnly, title: 'H', lead_time_demand: 0 };
  const low = { ...safetyOnly, title: 'L', priority: 'LOW', lead_time_demand: 0 };
  assert.ok(compareByShortfallPerCost(high, low) < 0);
});

// ---- allocateMarginal (budget mode since 3.3) ----
const { allocateMarginal, poissonTail } = require('../src/utils/budget-allocation');

test('poissonTail is P(D > k)', () => {
  assert.equal(poissonTail(0, 0), 0);
  assert.ok(Math.abs(poissonTail(1, 0) - (1 - Math.exp(-1))) < 1e-12);
  assert.ok(poissonTail(5, 2) > poissonTail(5, 6));
});

test('marginal allocation never exceeds the budget or a line cap', () => {
  const lines = [
    { cap: 4, unitCost: 100000, lambda: 6, position: 0 },
    { cap: 10, unitCost: 30000, lambda: 2, position: 1 },
    { cap: 2, unitCost: 250000, lambda: 9, position: 0 },
  ];
  const r = allocateMarginal(lines, 500000);
  r.qty.forEach((q, i) => assert.ok(q >= 0 && q <= lines[i].cap));
  const spent = r.qty.reduce((s, q, i) => s + q * lines[i].unitCost, 0);
  assert.equal(r.spent, spent);
  assert.ok(spent <= 500000);
  assert.equal(r.remaining, 500000 - spent);
});

test('the next copy goes where it raises the chance of covering lead-time demand most per VND', () => {
  // same price: the line whose demand is far above its position gets the first copies
  const r = allocateMarginal([
    { cap: 5, unitCost: 100000, lambda: 1, position: 3 },
    { cap: 5, unitCost: 100000, lambda: 8, position: 0 },
  ], 200000);
  assert.deepEqual(r.qty, [0, 2]);
  // a cheap copy with a smaller gain can beat an expensive one
  const cheap = allocateMarginal([
    { cap: 1, unitCost: 1000000, lambda: 5, position: 0 },
    { cap: 1, unitCost: 50000, lambda: 1, position: 0 },
  ], 1000000);
  assert.equal(cheap.qty[1], 1);
});

test('a line can be funded in part; copies with no modelled gain come last, cheapest first', () => {
  const r = allocateMarginal([
    { cap: 6, unitCost: 100000, lambda: 4, position: 0 },
    { cap: 3, unitCost: 20000, lambda: 0, position: 5 }, // safety stock only
  ], 340000);
  assert.ok(r.qty[0] > 0 && r.qty[0] < 6);
  assert.equal(r.qty[0] * 100000 + r.qty[1] * 20000, 340000 - r.remaining);
});

test('a zero budget funds nothing; an ample budget funds every cap', () => {
  const lines = [{ cap: 3, unitCost: 10000, lambda: 2, position: 0 }, { cap: 2, unitCost: 0, lambda: 1, position: 0 }];
  assert.deepEqual(allocateMarginal(lines, 0).qty, [0, 2]); // free copies are always taken
  assert.deepEqual(allocateMarginal(lines, 1e9).qty, [3, 2]);
});

test('the backtest policy calls the same allocation (eval/reorder-policies.js)', () => {
  const { marginalAllocation } = require('../eval/reorder-policies');
  const decisions = [
    { qty: 4, unitCost: 100000, candidate: { lead_time_demand: 6, inventory_position: 0 } },
    { qty: 10, unitCost: 30000, candidate: { lead_time_demand: 2, inventory_position: 1 } },
  ];
  const viaEval = marginalAllocation(decisions, 300000);
  const direct = allocateMarginal(decisions.map((d) => ({ cap: d.qty, unitCost: d.unitCost, lambda: d.candidate.lead_time_demand, position: d.candidate.inventory_position })), 300000);
  assert.deepEqual(viaEval.funded.map((d) => d.qty), direct.qty.filter((q) => q > 0));
  assert.equal(viaEval.spent, direct.spent);
});

test('trace + serviceCurve: cumulative cost vs share of modelled demand served (Phase 6)', () => {
  const { serviceCurve } = require('../src/utils/budget-allocation');
  const lines = [
    { cap: 3, unitCost: 100, lambda: 2, position: 0 },
    { cap: 2, unitCost: 50, lambda: 0, position: 4 }, // safety copies only
  ];
  const r = allocateMarginal(lines, 1e9, { trace: true });
  assert.equal(r.trace.length, 5);
  assert.equal(r.trace.reduce((s, t) => s + t.cost, 0), r.spent);
  const curve = serviceCurve(r.trace, 4);
  assert.equal(curve.full_plan_cost, 400);
  // every modelled gain comes from line 0; the 100 copies of service cost 300, safety copies add 100 more
  assert.equal(curve.cost_for_service_pct[100], 300);
  assert.ok(curve.cost_for_service_pct[90] <= curve.cost_for_service_pct[99]);
  assert.deepEqual(curve.curve.map((c) => c.service_pct), [25, 50, 75, 100]);
});
