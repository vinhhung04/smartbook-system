// Forecast-model comparison on the observed synthetic dataset (the loans that
// borrow_db holds). Same series as GET /analytics/forecast-accuracy and the
// simulation report: one zero-filled daily borrow series per variant over the
// last WINDOW_DAYS days, variants with at least one borrow in the window.
// Every model is scored by rollingBacktest() (forecast.js): expanding training
// window, non-overlapping test folds, forecasts built from the training slice
// only.
//
// Pooling across variants is exact, not an average of averages:
//   MAE  = sum |e| / n          RMSE = sqrt(sum e^2 / n)
//   WAPE = sum |e| / sum actual MAPE = mean |e|/actual over actual > 0 days
//   bias = sum (forecast - actual) / n

const { rollingBacktest, FORECAST_MODELS } = require('../src/utils/forecast');

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 180;
const MIN_TRAIN_DAYS = 30;
const HORIZONS = [7, 14];

// Mirrors evaluateForecast() in prisma/simulation/evaluation.js.
function dailySeriesByVariant(dataset, days = WINDOW_DAYS) {
  const end = dataset.meta.end.getTime();
  const firstDay = Math.floor((end - days * DAY_MS) / DAY_MS) * DAY_MS;
  const nDays = Math.floor(end / DAY_MS) - firstDay / DAY_MS + 1;
  const loans = new Map(dataset.tables.loan_transactions.map((l) => [l.id, l]));
  const series = new Map();
  for (const item of dataset.tables.loan_items) {
    const at = loans.get(item.loan_id).borrow_date.getTime();
    if (at < end - days * DAY_MS || at > end) continue;
    if (!series.has(item.variant_id)) series.set(item.variant_id, new Array(nDays).fill(0));
    series.get(item.variant_id)[Math.floor(at / DAY_MS) - firstDay / DAY_MS] += 1;
  }
  return series;
}

// Syntetos-Boylan-Croston demand classes (ADI cut-off 1.32, CV^2 cut-off 0.49).
// Used only to group the report; never as a model input.
function demandClass(series) {
  const nonZero = series.filter((v) => v > 0);
  if (!nonZero.length) return { adi: null, cv2: null, demand_class: 'NO_DEMAND' };
  const adi = series.length / nonZero.length;
  const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
  const variance = nonZero.reduce((a, b) => a + (b - mean) ** 2, 0) / nonZero.length;
  const cv2 = variance / mean ** 2;
  const intermittent = adi >= 1.32;
  const erratic = cv2 >= 0.49;
  const label = intermittent ? (erratic ? 'LUMPY' : 'INTERMITTENT') : (erratic ? 'ERRATIC' : 'SMOOTH');
  return { adi, cv2, demand_class: label };
}

// Sum of the actuals rollingBacktest scored (its fold layout).
function scoredActualTotal(series, horizonDays, minTrainDays) {
  let total = 0;
  for (let cut = minTrainDays; cut + horizonDays <= series.length; cut += horizonDays) {
    for (let i = cut; i < cut + horizonDays; i += 1) total += series[i];
  }
  return total;
}

function emptyPool() {
  return { absSum: 0, sqSum: 0, signedSum: 0, n: 0, actualSum: 0, mapeSum: 0, mapeN: 0 };
}

function addToPool(pool, m, actualTotal) {
  pool.absSum += m.mae * m.samples;
  pool.sqSum += m.rmse ** 2 * m.samples;
  pool.signedSum += m.bias * m.samples;
  pool.n += m.samples;
  pool.actualSum += actualTotal;
  if (m.mape !== null) {
    pool.mapeSum += m.mape * m.mapeSamples;
    pool.mapeN += m.mapeSamples;
  }
}

function finishPool(model, pool) {
  return {
    model,
    mae: pool.n ? pool.absSum / pool.n : null,
    rmse: pool.n ? Math.sqrt(pool.sqSum / pool.n) : null,
    wape: pool.actualSum ? pool.absSum / pool.actualSum : null,
    mape: pool.mapeN ? pool.mapeSum / pool.mapeN : null,
    mape_samples: pool.mapeN,
    bias: pool.n ? pool.signedSum / pool.n : null,
    samples: pool.n,
  };
}

function evaluateForecastModels(dataset, { windowDays = WINDOW_DAYS, minTrainDays = MIN_TRAIN_DAYS, horizons = HORIZONS } = {}) {
  const seriesByVariant = dailySeriesByVariant(dataset, windowDays);
  const variants = Array.from(seriesByVariant.entries()).map(([variantId, series]) => ({ variantId, series, ...demandClass(series) }));
  const zeroShare = variants.reduce((s, v) => s + v.series.filter((x) => x === 0).length / v.series.length, 0) / Math.max(1, variants.length);

  const results = horizons.map((horizonDays) => {
    const overall = new Map(FORECAST_MODELS.map((m) => [m, emptyPool()]));
    const byClass = new Map();
    const votes = Object.fromEntries(FORECAST_MODELS.map((m) => [m, 0]));
    let ok = 0;
    for (const v of variants) {
      const backtest = rollingBacktest(v.series, { horizonDays, minTrainDays });
      if (backtest.status !== 'OK') continue;
      ok += 1;
      votes[backtest.bestModel] += 1;
      const actualTotal = scoredActualTotal(v.series, horizonDays, minTrainDays);
      if (!byClass.has(v.demand_class)) byClass.set(v.demand_class, { variants: 0, pools: new Map(FORECAST_MODELS.map((m) => [m, emptyPool()])) });
      const cls = byClass.get(v.demand_class);
      cls.variants += 1;
      for (const m of backtest.models) {
        addToPool(overall.get(m.model), m, actualTotal);
        addToPool(cls.pools.get(m.model), m, actualTotal);
      }
    }
    return {
      horizon_days: horizonDays,
      variants_backtested: ok,
      overall: FORECAST_MODELS.map((m) => finishPool(m, overall.get(m))),
      best_model_votes: votes,
      by_demand_class: Array.from(byClass.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([demandClassName, cls]) => ({ demand_class: demandClassName, variants: cls.variants, models: FORECAST_MODELS.map((m) => finishPool(m, cls.pools.get(m))) })),
    };
  });

  const classCounts = {};
  for (const v of variants) classCounts[v.demand_class] = (classCounts[v.demand_class] || 0) + 1;
  return {
    protocol: {
      dataset: 'observed synthetic dataset (rows written to borrow_db)',
      window_days: windowDays,
      window_end: dataset.meta.end.toISOString(),
      min_train_days: minTrainDays,
      horizons_days: horizons,
      backtest: 'rollingBacktest(): expanding window, non-overlapping folds of horizon_days, forecast from the training slice only',
      models: FORECAST_MODELS,
      intermittent_parameters: { alpha: 0.1, beta: 0.1, source: 'literature defaults, not tuned' },
    },
    variants_with_demand: variants.length,
    mean_zero_demand_day_share: zeroShare,
    demand_class_counts: classCounts,
    horizons: results,
  };
}

module.exports = { WINDOW_DAYS, dailySeriesByVariant, demandClass, evaluateForecastModels };
