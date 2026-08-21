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
