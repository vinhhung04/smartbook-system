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
