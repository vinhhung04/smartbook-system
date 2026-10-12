// Time-series demand forecasting helpers for reorder suggestions.
// Pure functions, no DB access, so they can be exercised directly with sample series.

function ewma(series, alpha) {
  if (!series.length) return 0;
  let level = series[0];
  for (let i = 1; i < series.length; i += 1) {
    level = alpha * series[i] + (1 - alpha) * level;
  }
  return level;
}

function linearTrendSlope(series) {
  const n = series.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = series.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - xMean) * (series[i] - yMean);
    denominator += (i - xMean) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function stdDev(series) {
  const n = series.length;
  if (n < 2) return 0;
  const mean = series.reduce((sum, value) => sum + value, 0) / n;
  const variance = series.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
}

// Projects total demand over the next `horizonDays`, using the EWMA level and
// linear trend estimated from `series` (oldest -> newest), adjusted by a
// seasonal multiplier. Each day's projected demand is floored at 0 so a
// negative trend can't drive the forecast below zero.
//
// model 'MOVING_AVERAGE' (flat mean of `series`, no trend) is an evaluation
// candidate - see eval/forecast-diagnostics.js; production passes nothing and
// keeps 'EWMA_TREND'.
function projectedDemand(series, horizonDays, seasonalIndex = 1, model = 'EWMA_TREND') {
  const movingAverage = model === 'MOVING_AVERAGE';
  const level = movingAverage
    ? (series.length ? series.reduce((sum, value) => sum + value, 0) / series.length : 0)
    : ewma(series, 0.35);
  const trend = movingAverage ? 0 : linearTrendSlope(series);
  let total = 0;
  for (let day = 1; day <= horizonDays; day += 1) {
    total += Math.max(0, level + trend * day);
  }
  return Math.ceil(total * seasonalIndex);
}

function metricSummary(actual, predicted) {
  const samples = actual.length;
  if (!samples) return { mae: null, rmse: null, wape: null, mape: null, mapeSamples: 0, bias: null, samples: 0 };
  const absolute = actual.reduce((sum, value, index) => sum + Math.abs(value - predicted[index]), 0);
  // Mean signed error (forecast - actual): > 0 over-forecasts. On mostly-zero
  // series MAE alone rewards forecasting ~0, so bias is reported alongside it.
  const signed = actual.reduce((sum, value, index) => sum + (predicted[index] - value), 0);
  const squared = actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0);
  const totalActual = actual.reduce((sum, value) => sum + Math.abs(value), 0);
  // Index-preserving: .filter().map() would re-index after filtering out
  // zero-demand days, misaligning predicted[index] with the actual it was
  // supposed to pair with - wrong on any sparse series (the normal case for
  // per-title daily borrow counts).
  const mapeValues = [];
  for (let i = 0; i < actual.length; i += 1) {
    if (actual[i] > 0) mapeValues.push(Math.abs(actual[i] - predicted[i]) / actual[i]);
  }
  return { mae: absolute / samples, rmse: Math.sqrt(squared / samples), wape: totalActual ? absolute / totalActual : null, mape: mapeValues.length ? mapeValues.reduce((sum, value) => sum + value, 0) / mapeValues.length : null, mapeSamples: mapeValues.length, bias: signed / samples, samples };
}

// ── Intermittent-demand models ───────────────────────────────────────────────
// Per-title daily borrow counts are mostly zeros (~80% zero days on the
// synthetic dataset), the textbook case for intermittent-demand methods. They
// are evaluation candidates only: production reorder suggestions keep using
// EWMA + trend until a backtest gives a reason to switch.
//
// Smoothing constants are the usual literature defaults (alpha = beta = 0.1,
// Syntetos & Boylan 2005; Teunter, Syntetos & Babai 2011), fixed up front -
// never tuned on the series being evaluated.
const INTERMITTENT_ALPHA = 0.1;

// Croston (1972): smooth the non-zero demand size and the interval between
// demands separately, forecast = size / interval. Both are updated only on
// demand days, so the forecast is frozen through a run of zeros. The first
// demand initialises size and interval (interval counted from the series
// start). debias = true gives SBA (Syntetos-Boylan approximation), which
// multiplies by (1 - alpha/2) to remove Croston's known positive bias.
function croston(series, { alpha = INTERMITTENT_ALPHA, debias = false } = {}) {
  let size = null;
  let interval = null;
  let gap = 0;
  for (const value of series) {
    gap += 1;
    if (value > 0) {
      if (size === null) {
        size = value;
        interval = gap;
      } else {
        size += alpha * (value - size);
        interval += alpha * (gap - interval);
      }
      gap = 0;
    }
  }
  if (size === null) return 0;
  const rate = size / interval;
  return debias ? (1 - alpha / 2) * rate : rate;
}

// TSB (Teunter-Syntetos-Babai 2011): smooth the demand size on demand days and
// the probability of a demand on EVERY day, forecast = probability * size.
// Unlike Croston the forecast decays through long zero gaps, so a title that
// stopped circulating stops being forecast. Initialised at the first demand
// with probability = 1 / (periods until that demand).
function tsb(series, { alpha = INTERMITTENT_ALPHA, beta = INTERMITTENT_ALPHA } = {}) {
  let size = null;
  let probability = null;
  for (let i = 0; i < series.length; i += 1) {
    const value = series[i];
    if (size === null) {
      if (value > 0) {
        size = value;
        probability = 1 / (i + 1);
      }
      continue;
    }
    probability += beta * ((value > 0 ? 1 : 0) - probability);
    if (value > 0) size += alpha * (value - size);
  }
  return size === null ? 0 : probability * size;
}

const FORECAST_MODELS = ['NAIVE_LAST_VALUE', 'MOVING_AVERAGE_7', 'MOVING_AVERAGE_30', 'CURRENT_EWMA_TREND', 'CROSTON', 'SBA', 'TSB'];

// Daily point forecasts for the next `horizon` days, using only `training`
// (oldest -> newest). Every model is non-negative for non-negative input.
function predict(model, training, horizon) {
  if (model === 'NAIVE_LAST_VALUE') return Array(horizon).fill(training.at(-1) || 0);
  if (model === 'MOVING_AVERAGE_7') return Array(horizon).fill(training.slice(-7).reduce((a, b) => a + b, 0) / Math.min(training.length, 7));
  if (model === 'MOVING_AVERAGE_30') return Array(horizon).fill(training.slice(-30).reduce((a, b) => a + b, 0) / Math.min(training.length, 30));
  if (model === 'CROSTON') return Array(horizon).fill(croston(training));
  if (model === 'SBA') return Array(horizon).fill(croston(training, { debias: true }));
  if (model === 'TSB') return Array(horizon).fill(tsb(training));
  const level = ewma(training, 0.35); const trend = linearTrendSlope(training);
  return Array.from({ length: horizon }, (_, index) => Math.max(0, level + trend * (index + 1)));
}

function rollingBacktest(series, { horizonDays = 7, minTrainDays = 30 } = {}) {
  if (!Array.isArray(series) || series.length < minTrainDays + horizonDays) return { status: 'INSUFFICIENT_DATA', requiredDays: minTrainDays + horizonDays, availableDays: Array.isArray(series) ? series.length : 0 };
  const models = FORECAST_MODELS;
  const actualByModel = new Map(models.map((model) => [model, { actual: [], predicted: [] }]));
  for (let cut = minTrainDays; cut + horizonDays <= series.length; cut += horizonDays) {
    const training = series.slice(0, cut); const actual = series.slice(cut, cut + horizonDays);
    for (const model of models) { const pair = actualByModel.get(model); pair.actual.push(...actual); pair.predicted.push(...predict(model, training, horizonDays)); }
  }
  const results = models.map((model) => ({ model, ...metricSummary(actualByModel.get(model).actual, actualByModel.get(model).predicted) }));
  results.sort((left, right) => left.mae - right.mae);
  return { status: 'OK', horizonDays, models: results, bestModel: results[0].model };
}

module.exports = {
  ewma,
  linearTrendSlope,
  stdDev,
  projectedDemand,
  metricSummary,
  croston,
  tsb,
  FORECAST_MODELS,
  predict,
  rollingBacktest,
};
