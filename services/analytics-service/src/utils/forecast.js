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
function projectedDemand(series, horizonDays, seasonalIndex = 1) {
  const level = ewma(series, 0.35);
  const trend = linearTrendSlope(series);
  let total = 0;
  for (let day = 1; day <= horizonDays; day += 1) {
    total += Math.max(0, level + trend * day);
  }
  return Math.ceil(total * seasonalIndex);
}

function metricSummary(actual, predicted) {
  const samples = actual.length;
  if (!samples) return { mae: null, rmse: null, wape: null, mape: null, mapeSamples: 0, samples: 0 };
  const absolute = actual.reduce((sum, value, index) => sum + Math.abs(value - predicted[index]), 0);
  const squared = actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0);
  const totalActual = actual.reduce((sum, value) => sum + Math.abs(value), 0);
  const mapeValues = actual.filter((value) => value > 0).map((value, index) => Math.abs(value - predicted[index]) / value);
  return { mae: absolute / samples, rmse: Math.sqrt(squared / samples), wape: totalActual ? absolute / totalActual : null, mape: mapeValues.length ? mapeValues.reduce((sum, value) => sum + value, 0) / mapeValues.length : null, mapeSamples: mapeValues.length, samples };
}

function predict(model, training, horizon) {
  if (model === 'NAIVE_LAST_VALUE') return Array(horizon).fill(training.at(-1) || 0);
  if (model === 'MOVING_AVERAGE_7') return Array(horizon).fill(training.slice(-7).reduce((a, b) => a + b, 0) / Math.min(training.length, 7));
  if (model === 'MOVING_AVERAGE_30') return Array(horizon).fill(training.slice(-30).reduce((a, b) => a + b, 0) / Math.min(training.length, 30));
  const level = ewma(training, 0.35); const trend = linearTrendSlope(training);
  return Array.from({ length: horizon }, (_, index) => Math.max(0, level + trend * (index + 1)));
}

function rollingBacktest(series, { horizonDays = 7, minTrainDays = 30 } = {}) {
  if (!Array.isArray(series) || series.length < minTrainDays + horizonDays) return { status: 'INSUFFICIENT_DATA', requiredDays: minTrainDays + horizonDays, availableDays: Array.isArray(series) ? series.length : 0 };
  const models = ['NAIVE_LAST_VALUE', 'MOVING_AVERAGE_7', 'MOVING_AVERAGE_30', 'CURRENT_EWMA_TREND'];
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
  rollingBacktest,
};
