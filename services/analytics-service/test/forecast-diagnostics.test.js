const test = require('node:test');
const assert = require('node:assert/strict');
const { projectedDemand } = require('../src/utils/forecast');
const { calculateSuggestion } = require('../src/utils/reorder-suggestion');
const { variantErrors, pooled, bootstrapDiff, CANDIDATES } = require('../eval/forecast-diagnostics');

test('projectedDemand keeps EWMA + trend as the default (production) model', () => {
  const series = [0, 0, 1, 0, 2, 0, 0, 3];
  assert.equal(projectedDemand(series, 14), projectedDemand(series, 14, 1, 'EWMA_TREND'));
});

test('MOVING_AVERAGE forecasts the flat window mean, no trend', () => {
  const series = [...Array(19).fill(0), 10]; // mean 0.5/day, steep upward "trend"
  assert.equal(projectedDemand(series, 10, 1, 'MOVING_AVERAGE'), 5);
  assert.ok(projectedDemand(series, 10) > 5); // EWMA + trend chases the last spike
  assert.equal(projectedDemand([], 10, 1, 'MOVING_AVERAGE'), 0);
});

test('calculateSuggestion is unchanged unless the evaluation option is passed', () => {
  const row = { variant_id: 'v', book_id: 'b', title: 'T', available_qty: 1, on_hand_qty: 1, reorder_point: 0, unit_cost: 1000 };
  const demand = { borrowCount: 4, previousBorrowCount: 2, reservationCount: 0, wishlistCount: 0, availabilityAlertCount: 0 };
  const series = [0, 1, 0, 0, 1, 0, 1, 1];
  const ranges = { days: 30, leadTimeDays: 14 };
  const base = calculateSuggestion(row, demand, ranges, {}, series);
  assert.deepEqual(calculateSuggestion(row, demand, ranges, {}, series, null, {}), base);
  const ma = calculateSuggestion(row, demand, ranges, {}, series, null, { forecastModel: 'MOVING_AVERAGE' });
  assert.equal(ma.demand_pace, 0.5);
});

test('diagnostics split folds into disjoint validation and test halves', () => {
  const series = Array.from({ length: 120 }, (_, i) => (i % 5 === 0 ? 1 : 0));
  const val = variantErrors(series, 'MA30', 'val');
  const testSplit = variantErrors(series, 'MA30', 'test');
  const all = Math.floor((series.length - 14 - 30) / 7) + 1; // folds with a full 14-day lead time
  assert.equal(val.ltN + testSplit.ltN, all);
  assert.ok(val.ltN > 0 && testSplit.ltN > 0);
});

test('paired bootstrap of a model against itself is exactly zero', () => {
  const series = [Array.from({ length: 90 }, (_, i) => (i % 3 === 0 ? 1 : 0)), Array.from({ length: 90 }, (_, i) => (i % 7 === 0 ? 2 : 0))];
  const errs = series.map((s) => variantErrors(s, 'SES_0.1', 'test'));
  const diff = bootstrapDiff(errs, errs, 'mae');
  assert.equal(diff.point, 0);
  assert.deepEqual(diff.ci95, [0, 0]);
  assert.ok(pooled(errs).mae >= 0);
  assert.ok(Object.keys(CANDIDATES).includes('PROD_EWMA_TREND_30D'));
});
