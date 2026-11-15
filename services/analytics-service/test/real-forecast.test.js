const test = require('node:test');
const assert = require('node:assert/strict');
const { datasetFromEvents, evaluateHorizonTotals } = require('../eval/real-forecast');
const { dailySeriesByVariant } = require('../eval/forecast-evaluation');

test('real loan events become the borrow tables the forecast evaluation reads', () => {
  const data = { window_end: '2024-01-10T00:00:00Z', events: [
    { kind: 'LOAN', book_id: 'b:1', at: '2024-01-09T08:00:00Z' },
    { kind: 'LOAN', book_id: 'b:1', at: '2024-01-10T00:00:00Z' },
  ] };
  const series = dailySeriesByVariant(datasetFromEvents(data), 5).get('b:1');
  assert.deepEqual(series.slice(-2), [1, 1]);
});

test('horizon totals: one recent borrow makes the rounded-up production forecast 2 then 1 for a title nobody borrows again', () => {
  const series = Array(44).fill(0);
  series[28] = 1; // folds start at day 30 and 37; both 7-day windows have zero demand
  const [h7] = evaluateHorizonTotals([series], [7], 30);
  const byModel = Object.fromEntries(h7.models.map((m) => [m.model, m]));
  assert.equal(h7.samples, 2);
  assert.equal(h7.zero_actual_share, 1);
  assert.equal(byModel.ZERO.mae, 0);
  assert.equal(byModel.PRODUCTION_EWMA_TREND_CEIL.mae, 1.5); // forecasts 2 and 1
  assert.equal(byModel.PRODUCTION_EWMA_TREND_CEIL.over_forecast_share, 1);
});

test('horizon totals: zero forecast has WAPE exactly 1 whenever there is demand', () => {
  const series = Array(44).fill(0);
  series[33] = 2;
  const [h7] = evaluateHorizonTotals([series], [7], 30);
  const zero = h7.models.find((m) => m.model === 'ZERO');
  assert.equal(zero.wape, 1);
  assert.equal(zero.under_forecast_share, 0.5);
});
