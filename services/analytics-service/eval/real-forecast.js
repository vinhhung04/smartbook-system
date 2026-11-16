#!/usr/bin/env node
/**
 * The forecast-model comparison of run-all.js, on REAL library loans instead of the
 * synthetic dataset: same series (daily borrows per title, last 180 days), same
 * rollingBacktest(), same models and pooling (forecast-evaluation.js).
 *
 * Plus a decision-level check the daily metrics miss: reorder-suggestion.js uses the
 * TOTAL demand of the next 7 / 30 days (projectedDemand, rounded up), so each fold's
 * horizon total is scored against a ZERO forecast - the trivial baseline on series
 * that are almost all zero days.
 *
 * Input: an events file from services/ai-service/eval/real_library_loans.py
 * (Mendeley 10.17632/6rd45bvxjy.1, CC BY 4.0, research/education use only), or
 * --synthetic for the same checks on the synthetic dataset run-all.js uses.
 *
 * USAGE (from services/analytics-service):
 *   node eval/real-forecast.js ../../research-inputs/library-loans-mendeley/derived/univ_events.json univ
 *   node eval/real-forecast.js --synthetic synthetic
 *
 * OUTPUTS: thesis/data/forecast_model_results_real_<label>.json,
 *          thesis/tables/forecast_model_results_real_<label>.csv, ..._by_demand_class.csv,
 *          thesis/tables/forecast_horizon_total_real_<label>.csv,
 *          thesis/tables/forecast_horizon_total_by_category_real_<label>.csv (real data only)
 */

const fs = require('fs');
const { evaluateForecastModels, dailySeriesByVariant, WINDOW_DAYS } = require('./forecast-evaluation');
const { writeJson, writeCsv } = require('./run-all');
const { FORECAST_MODELS, predict, projectedDemand } = require('../src/utils/forecast');

const TOTAL_HORIZONS = [7, 30]; // forecast7d / forecast30d in reorder-suggestion.js
const MIN_TRAIN_DAYS = 30;

// A title plays the role of the variant: the real files have no edition-level stock.
function datasetFromEvents(data, keyOf = (e) => e.book_id) {
  const loans = data.events.filter((e) => e.kind === 'LOAN');
  return {
    meta: { end: new Date(data.window_end) },
    tables: {
      loan_transactions: loans.map((e, id) => ({ id, borrow_date: new Date(e.at) })),
      loan_items: loans.map((e, id) => ({ loan_id: id, variant_id: keyOf(e) })),
    },
  };
}

const sum = (values) => values.reduce((a, b) => a + b, 0);
const TOTAL_FORECASTERS = {
  ZERO: () => 0,
  PRODUCTION_EWMA_TREND_CEIL: (training, h) => projectedDemand(training, h),
  PRODUCTION_MOVING_AVERAGE_CEIL: (training, h) => projectedDemand(training, h, 1, 'MOVING_AVERAGE'),
  ...Object.fromEntries(FORECAST_MODELS.map((m) => [m, (training, h) => sum(predict(m, training, h))])),
};

// One sample per (title, fold): same expanding-window folds as rollingBacktest().
function evaluateHorizonTotals(seriesList, horizons = TOTAL_HORIZONS, minTrainDays = MIN_TRAIN_DAYS) {
  return horizons.map((h) => {
    const pools = Object.fromEntries(Object.keys(TOTAL_FORECASTERS).map((m) => [m, { abs: 0, signed: 0, under: 0, over: 0, n: 0 }]));
    let actualSum = 0;
    let zeroActual = 0;
    for (const series of seriesList) {
      for (let cut = minTrainDays; cut + h <= series.length; cut += h) {
        const training = series.slice(0, cut);
        const actual = sum(series.slice(cut, cut + h));
        actualSum += actual;
        if (actual === 0) zeroActual += 1;
        for (const [model, forecaster] of Object.entries(TOTAL_FORECASTERS)) {
          const error = forecaster(training, h) - actual;
          const p = pools[model];
          p.abs += Math.abs(error); p.signed += error; p.n += 1;
          if (error < 0) p.under += 1;
          if (error > 0) p.over += 1;
        }
      }
    }
    const n = pools.ZERO.n;
    return {
      horizon_days: h,
      samples: n,
      zero_actual_share: n ? zeroActual / n : null,
      mean_actual: n ? actualSum / n : null,
      models: Object.entries(pools).map(([model, p]) => ({
        model,
        mae: n ? p.abs / n : null,
        wape: actualSum ? p.abs / actualSum : null,
        bias: n ? p.signed / n : null,
        under_forecast_share: n ? p.under / n : null,
        over_forecast_share: n ? p.over / n : null,
      })),
    };
  });
}

function loadDataset(file) {
  if (file === '--synthetic') {
    const { observedDataset, provenance } = require('./synthetic-world');
    const { options, dataset } = observedDataset();
    return { dataset, provenance: provenance(options), label: 'observed synthetic dataset (rows written to borrow_db)' };
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.synthetic !== false || !data.real_source) throw new Error('input must come from real_library_loans.py');
  const categoryOf = new Map(data.catalog.map((b) => [b.id, b.category]));
  return {
    dataset: datasetFromEvents(data),
    // the level a budget split is decided at: one series per DDC division
    categoryDataset: datasetFromEvents(data, (e) => categoryOf.get(e.book_id) || 'DDC unknown'),
    provenance: { ...data.real_source, loans: data.events.length },
    label: `real loans: ${data.real_source.library} (Mendeley ${data.real_source.doi}); title-level daily series`,
  };
}

function main([file, label] = process.argv.slice(2)) {
  if (!file || !/^[a-z0-9-]+$/.test(label || '')) throw new Error('usage: real-forecast.js <events.json|--synthetic> <label>');
  const { dataset, categoryDataset, provenance, label: datasetLabel } = loadDataset(file);
  const result = evaluateForecastModels(dataset);
  result.protocol.dataset = datasetLabel;
  const horizonTotals = evaluateHorizonTotals(Array.from(dailySeriesByVariant(dataset, WINDOW_DAYS).values()));
  const categoryTotals = categoryDataset
    ? evaluateHorizonTotals(Array.from(dailySeriesByVariant(categoryDataset, WINDOW_DAYS).values())) : null;
  const forecast = { provenance, ...result, horizon_totals: horizonTotals, horizon_totals_by_category: categoryTotals };
  const written = [
    writeJson(`forecast_model_results_real_${label}.json`, forecast),
    writeCsv(`forecast_model_results_real_${label}.csv`, forecast.horizons.flatMap((h) => h.overall.map((m) => ({
      horizon_days: h.horizon_days, model: m.model, mae: m.mae, rmse: m.rmse, wape: m.wape, mape: m.mape,
      mape_samples: m.mape_samples, bias: m.bias, samples: m.samples, best_model_votes: h.best_model_votes[m.model],
    })))),
    writeCsv(`forecast_model_by_demand_class_real_${label}.csv`, forecast.horizons.flatMap((h) => h.by_demand_class.flatMap((c) => c.models.map((m) => ({
      horizon_days: h.horizon_days, demand_class: c.demand_class, variants: c.variants, model: m.model,
      mae: m.mae, rmse: m.rmse, wape: m.wape, bias: m.bias, samples: m.samples,
    }))))),
    writeCsv(`forecast_horizon_total_real_${label}.csv`, horizonTotals.flatMap((h) => h.models.map((m) => ({
      horizon_days: h.horizon_days, samples: h.samples, zero_actual_share: h.zero_actual_share, mean_actual: h.mean_actual, ...m,
    })))),
  ];
  if (categoryTotals) {
    written.push(writeCsv(`forecast_horizon_total_by_category_real_${label}.csv`, categoryTotals.flatMap((h) => h.models.map((m) => ({
      horizon_days: h.horizon_days, samples: h.samples, zero_actual_share: h.zero_actual_share, mean_actual: h.mean_actual, ...m,
    })))));
  }
  for (const f of written) console.log(`[real-forecast] wrote ${f.replace(/\\/g, '/')}`);
  return forecast;
}

if (require.main === module) main();

module.exports = { datasetFromEvents, evaluateHorizonTotals, main };
