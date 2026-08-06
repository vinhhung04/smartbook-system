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

module.exports = {
  ewma,
  linearTrendSlope,
  stdDev,
  projectedDemand,
};
