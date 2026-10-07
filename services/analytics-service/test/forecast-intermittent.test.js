const test = require('node:test');
const assert = require('node:assert/strict');
const { croston, tsb, predict, rollingBacktest, FORECAST_MODELS } = require('../src/utils/forecast');

const close = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

// Worked by hand with alpha = beta = 0.1 on [0, 0, 3, 0, 0, 0, 6]:
//   first demand (day 3): size = 3, interval = 3
//   second demand (gap 4): size = 3 + 0.1*(6-3) = 3.3, interval = 3 + 0.1*(4-3) = 3.1
const SPARSE = [0, 0, 3, 0, 0, 0, 6];

test('Croston = smoothed size / smoothed interval', () => {
  close(croston(SPARSE), 3.3 / 3.1);
});

test('SBA applies the (1 - alpha/2) debiasing factor to Croston', () => {
  close(croston(SPARSE, { debias: true }), 0.95 * (3.3 / 3.1));
});

test('TSB = smoothed demand probability * smoothed size', () => {
  // p: 1/3 at day 3, then x0.9 for three zero days, then +0.1*(1-p) on day 7.
  let p = 1 / 3;
  p *= 0.9; p *= 0.9; p *= 0.9;
  p += 0.1 * (1 - p);
  close(tsb(SPARSE), p * 3.3);
});

test('all-zero and empty series forecast exactly zero', () => {
  for (const series of [[], [0], Array(90).fill(0)]) {
    assert.equal(croston(series), 0);
    assert.equal(croston(series, { debias: true }), 0);
    assert.equal(tsb(series), 0);
  }
});

test('short history: a single demand initialises every model', () => {
  close(croston([4]), 4); // size 4, interval 1
  close(croston([0, 4]), 2); // size 4, interval 2
  close(tsb([0, 4]), 0.5 * 4); // probability 1/2
});

test('long zero gap: Croston stays frozen, TSB decays toward zero', () => {
  const series = [5, ...Array(100).fill(0)];
  close(croston(series), 5);
  const decayed = tsb(series);
  close(decayed, 5 * 0.9 ** 100, 1e-12);
  assert.ok(decayed < 0.001);
});

test('every model predicts non-negative values on sparse non-negative series', () => {
  const series = Array.from({ length: 60 }, (_, i) => (i % 9 === 0 ? 2 : 0));
  // Steeply falling series pushes a raw linear trend negative.
  const falling = Array.from({ length: 40 }, (_, i) => Math.max(0, 20 - i));
  for (const training of [series, falling, Array(30).fill(0)]) {
    for (const model of FORECAST_MODELS) {
      const forecast = predict(model, training, 14);
      assert.equal(forecast.length, 14);
      assert.ok(forecast.every((value) => Number.isFinite(value) && value >= 0), `${model} produced a negative or non-finite value`);
    }
  }
});

test('rollingBacktest scores the intermittent models on the same folds as the existing ones', () => {
  const series = Array.from({ length: 60 }, (_, i) => (i % 5 === 0 ? 3 : 0));
  const result = rollingBacktest(series, { minTrainDays: 30, horizonDays: 7 });
  assert.equal(result.status, 'OK');
  assert.deepEqual(result.models.map((m) => m.model).sort(), [...FORECAST_MODELS].sort());
  // 30 training days then folds at 30, 37, 44, 51 -> 4 folds x 7 days.
  assert.ok(result.models.every((m) => m.samples === 28));
});

test('a single-fold backtest scores exactly the forecast built from the training slice (no leakage)', () => {
  // Training is sparse; the 7-day test window is a burst that a leaking model
  // would partly "see". The reported MAE must equal the error of a forecast made
  // from series[0..29] alone.
  const training = Array.from({ length: 30 }, (_, i) => (i % 6 === 0 ? 1 : 0));
  const future = [8, 8, 8, 8, 8, 8, 8];
  const result = rollingBacktest([...training, ...future], { minTrainDays: 30, horizonDays: 7 });
  for (const model of FORECAST_MODELS) {
    const forecast = predict(model, training, 7);
    const expectedMae = future.reduce((sum, value, i) => sum + Math.abs(value - forecast[i]), 0) / 7;
    close(result.models.find((m) => m.model === model).mae, expectedMae);
  }
});
