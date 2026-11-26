const test = require('node:test');
const assert = require('node:assert/strict');
const { fundingAllocation, withFundingSignals } = require('../eval/budget-baselines');

const line = (id, qty, unitCost, borrows, holds = 0, category = 'x') => ({ id, qty, unitCost, candidate: { borrows, holds, category } });
const given = (result) => Object.fromEntries(result.funded.map((d) => [d.id, d.qty]));

test('POPULAR_FIRST fills the most borrowed line first, then partial lines', () => {
  const r = fundingAllocation('POPULAR_FIRST')([line('a', 3, 100, 1), line('b', 2, 100, 9), line('c', 5, 100, 4)], 450);
  assert.deepEqual(given(r), { b: 2, c: 2 });
  assert.equal(r.spent, 400);
});

test('HOLDS_FIRST ranks by holds, ties by borrows', () => {
  const r = fundingAllocation('HOLDS_FIRST')([line('a', 1, 100, 9, 0), line('b', 1, 100, 1, 3), line('c', 1, 100, 5, 3)], 200);
  assert.deepEqual(given(r), { c: 1, b: 1 });
});

test('CATEGORY_SHARE splits by category borrows and hands leftovers on', () => {
  // x has 3/4 of the borrows -> 300 of 400; y gets 100 but its only line costs 150 -> leftover to x
  const r = fundingAllocation('CATEGORY_SHARE')([line('a', 5, 100, 6, 0, 'x'), line('b', 1, 150, 2, 0, 'y')], 400);
  assert.deepEqual(given(r), { a: 4 });
  assert.equal(r.spent, 400);
});

test('ONE_EACH gives one copy per line per round', () => {
  const r = fundingAllocation('ONE_EACH')([line('a', 3, 100, 9), line('b', 3, 100, 1), line('c', 1, 100, 5)], 500);
  assert.deepEqual(given(r), { a: 2, c: 1, b: 2 });
});

test('never exceeds the proposed quantity or the budget', () => {
  for (const rule of ['POPULAR_FIRST', 'HOLDS_FIRST', 'CATEGORY_SHARE', 'ONE_EACH']) {
    const r = fundingAllocation(rule)([line('a', 2, 100, 3), line('b', 1, 70, 1, 1, 'y')], 10000);
    assert.deepEqual(given(r), { a: 2, b: 1 }, rule);
    assert.equal(r.spent, 270, rule);
  }
});

test('withFundingSignals attaches recent borrows, holds and category', () => {
  const day = 100;
  const dayStartMs = day * 86400000;
  const policy = withFundingSignals({ name: 'q', decide: () => ({ qty: 2 }) }, {
    reservationsByVariant: new Map([['v', [{ reservedAt: dayStartMs - 1000, endAt: null }]]]),
    categoryOf: () => 'cat',
  });
  const d = policy.decide({ dayStartMs, history: [dayStartMs - 40 * 86400000, dayStartMs - 86400000], variant: { variantId: 'v' } });
  assert.deepEqual(d, { qty: 2, candidate: { borrows: 1, holds: 1, category: 'cat' } });
});

test('protectedMarginal values copies over lead time + review period', () => {
  const { protectedMarginal } = require('../eval/budget-improvement');
  // demand 1/day: over 14 days a 14th copy barely matters, over 21 days it still does
  const d = (id) => ({ id, qty: 3, unitCost: 100, candidate: { avg_daily_demand: 1, lead_time_days: 14, inventory_position: 14 } });
  const cheapGap = { id: 'b', qty: 3, unitCost: 100, candidate: { avg_daily_demand: 0.2, lead_time_days: 14, inventory_position: 0 } };
  const r = protectedMarginal([d('a'), cheapGap], 300);
  assert.equal(r.spent, 300);
  assert.ok(r.funded.find((x) => x.id === 'a'), 'the fast title still gets a copy once the review gap is counted');
});
