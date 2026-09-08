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
