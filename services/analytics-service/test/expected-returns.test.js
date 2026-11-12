const assert = require('node:assert/strict');
const test = require('node:test');
const { MIN_RETURNED_SAMPLES, loanSurvival, expectedReturns } = require('../src/utils/expected-returns');

const repeat = (value, n) => Array.from({ length: n }, () => value);

test('fewer than 30 returned loans: no curve, so no copy on loan is counted as coming back', () => {
  assert.equal(MIN_RETURNED_SAMPLES, 30);
  assert.equal(loanSurvival(repeat(14, 29)), null);
  assert.equal(expectedReturns([1, 2, 3], 14, null), null);
  assert.notEqual(loanSurvival(repeat(14, 30)), null);
});

test('every loan returned on day 14: a loan aged 10 is back within 7 days, one aged 2 is not', () => {
  const s = loanSurvival(repeat(14, 40));
  assert.equal(s.at(13), 1);
  assert.equal(s.at(14), 0);
  assert.equal(expectedReturns([10], 7, s), 1);
  assert.equal(expectedReturns([2], 7, s), 0);
  assert.equal(expectedReturns([10, 10, 2], 7, s), 2);
});

test('late returns spread the curve: half return on day 14, half on day 60', () => {
  const s = loanSurvival([...repeat(14, 20), ...repeat(60, 20)]);
  // aged 10, horizon 7: only the on-time half is back -> 0.5 copy
  assert.equal(expectedReturns([10], 7, s), 0.5);
  // aged 30 (already overdue): only the late group remains, back by day 60
  assert.equal(expectedReturns([30], 7, s), 0);
  assert.equal(expectedReturns([30], 30, s), 1);
});

test('a loan older than any ever returned is not counted as coming back', () => {
  const s = loanSurvival(repeat(14, 30), [200]);
  assert.equal(expectedReturns([400], 14, s), 0);
});

test('long-open loans are censored: they lower the return probability instead of being ignored', () => {
  const durations = [...repeat(10, 15), ...repeat(40, 15)];
  const withoutOpen = loanSurvival(durations);
  const withOpen = loanSurvival(durations, repeat(20, 30)); // 30 loans still out at day 20
  assert.ok(withOpen.at(30) > withoutOpen.at(30));
  assert.ok(expectedReturns([25], 20, withOpen) < expectedReturns([25], 20, withoutOpen) + 1e-12);
});
