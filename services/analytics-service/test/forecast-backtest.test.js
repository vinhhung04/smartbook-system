const test = require('node:test');
const assert = require('node:assert/strict');
const { metricSummary, rollingBacktest } = require('../src/utils/forecast');
test('calculates backtest metrics without future leakage', () => {
  const series = Array.from({ length: 50 }, (_, index) => index + 1);
  const result = rollingBacktest(series, { minTrainDays: 30, horizonDays: 7 });
  assert.equal(result.status, 'OK'); assert.ok(result.models.every((item) => item.samples === 14));
});
test('does not divide by zero for zero demand', () => {
  const result = metricSummary([0, 0], [0, 1]);
  assert.equal(result.wape, null); assert.equal(result.mape, null);
});
test('reports insufficient history', () => assert.equal(rollingBacktest([1, 2], { minTrainDays: 30 }).status, 'INSUFFICIENT_DATA'));

// Regression test for a real bug: .filter().map() re-indexes after dropping
// zero-demand days, so predicted[index] no longer pairs with the actual value
// it was computed for. Fails on the buggy code (mape = |10-5|/10 = 0.5
// instead of the correct 0), passes after the index-preserving fix.
test('mape stays index-aligned when a leading zero-demand day is filtered out', () => {
  const result = metricSummary([0, 10], [5, 10]);
  assert.equal(result.mape, 0);
  assert.equal(result.mapeSamples, 1);
});

test('mape only counts positive-actual days, still index-aligned', () => {
  const result = metricSummary([0, 0, 4], [1, 1, 2]);
  assert.equal(result.mape, 0.5);
  assert.equal(result.mapeSamples, 1);
});
