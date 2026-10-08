#!/usr/bin/env node
/**
 * Why does the production forecast (EWMA alpha 0.35 + linear trend) not beat
 * a 30-day moving average? A decomposition study with a selection protocol
 * that keeps model choice and reported performance on different data.
 *
 * Candidates (fixed before looking at any result):
 *   PROD_EWMA_TREND_30D   production as it really runs: EWMA(0.35) level + OLS
 *                         trend over the last 30 complete days only
 *   EWMA_TREND_EXPANDING  the variant forecast-evaluation.js labels "production":
 *                         same formula over the whole expanding training window
 *   SES_a (a in .05 .1 .2 .35)  EWMA level, NO trend, expanding window
 *   SES_0.35_30D          production without the trend term
 *   MA30, TSB             references from the main comparison
 *
 * Protocol: one zero-filled daily series per variant over the last 360 days of
 * the observed synthetic dataset; rolling origin, expanding window, folds of
 * HORIZON days starting at day 30. Folds whose cut is in the first half of the
 * window are VALIDATION, the rest TEST. The "selected" model is the lowest
 * validation MAE among the SES/EWMA candidates; only its TEST numbers are
 * reported as its performance. Paired 95% bootstrap CIs (resampling variants,
 * 2000 draws, fixed seed) for test MAE differences.
 *
 * Metrics: daily MAE / RMSE / bias, and LT-sum error: |sum of forecast over a
 * 14-day lead time - actual 14-day demand| - the quantity a reorder decision
 * actually uses (projectedDemand over the lead time), which daily MAE on
 * mostly-zero series does not measure.
 *
 * USAGE (from services/analytics-service):  node eval/forecast-diagnostics.js
 * OUTPUT: thesis/data/forecast_diagnostics_results.json,
 *         docs/ANALYSIS/FORECAST_DIAGNOSTICS.md
 */

const fs = require('fs');
const path = require('path');
const { ewma, linearTrendSlope, tsb } = require('../src/utils/forecast');
const { observedDataset, provenance } = require('./synthetic-world');
const { dailySeriesByVariant } = require('./forecast-evaluation');

const WINDOW_DAYS = 360;
const MIN_TRAIN_DAYS = 30;
const HORIZON = 7;
const LEAD_TIME = 14;
const PROD_WINDOW = 30;
const BOOTSTRAP_DRAWS = 2000;
const BOOTSTRAP_SEED = 20261008;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function ewmaTrend(training, horizon, windowDays = null) {
  const series = windowDays ? training.slice(-windowDays) : training;
  const level = ewma(series, 0.35);
  const trend = linearTrendSlope(series);
  return Array.from({ length: horizon }, (_, i) => Math.max(0, level + trend * (i + 1)));
}

const CANDIDATES = {
  PROD_EWMA_TREND_30D: (t, h) => ewmaTrend(t, h, PROD_WINDOW),
  EWMA_TREND_EXPANDING: (t, h) => ewmaTrend(t, h),
  'SES_0.35_30D': (t, h) => Array(h).fill(ewma(t.slice(-PROD_WINDOW), 0.35)),
  'SES_0.35': (t, h) => Array(h).fill(ewma(t, 0.35)),
  'SES_0.2': (t, h) => Array(h).fill(ewma(t, 0.2)),
  'SES_0.1': (t, h) => Array(h).fill(ewma(t, 0.1)),
  'SES_0.05': (t, h) => Array(h).fill(ewma(t, 0.05)),
  MA30: (t, h) => Array(h).fill(mean(t.slice(-30))),
  TSB: (t, h) => Array(h).fill(tsb(t)),
};
const SELECTABLE = Object.keys(CANDIDATES).filter((m) => m !== 'MA30' && m !== 'TSB');

// Per-variant error sums for one split, so variants can be bootstrapped.
function variantErrors(series, model, split) {
  const half = MIN_TRAIN_DAYS + Math.floor((series.length - MIN_TRAIN_DAYS) / 2);
  const out = { abs: 0, sq: 0, signed: 0, n: 0, ltAbs: 0, ltSigned: 0, ltN: 0 };
  for (let cut = MIN_TRAIN_DAYS; cut + LEAD_TIME <= series.length; cut += HORIZON) {
    const inSplit = split === 'val' ? cut < half : cut >= half;
    if (!inSplit) continue;
    const training = series.slice(0, cut);
    const forecast = CANDIDATES[model](training, LEAD_TIME);
    const actual = series.slice(cut, cut + LEAD_TIME);
    for (let i = 0; i < HORIZON; i += 1) {
      const e = forecast[i] - actual[i];
      out.abs += Math.abs(e); out.sq += e * e; out.signed += e; out.n += 1;
    }
    const ltError = forecast.reduce((a, b) => a + b, 0) - actual.reduce((a, b) => a + b, 0);
    out.ltAbs += Math.abs(ltError); out.ltSigned += ltError; out.ltN += 1;
  }
  return out;
}

function pooled(errorsList) {
  const s = errorsList.reduce((acc, e) => {
    for (const k of Object.keys(acc)) acc[k] += e[k];
    return acc;
  }, { abs: 0, sq: 0, signed: 0, n: 0, ltAbs: 0, ltSigned: 0, ltN: 0 });
  return {
    mae: s.n ? s.abs / s.n : null,
    rmse: s.n ? Math.sqrt(s.sq / s.n) : null,
    bias: s.n ? s.signed / s.n : null,
    lt_sum_mae: s.ltN ? s.ltAbs / s.ltN : null,
    lt_sum_bias: s.ltN ? s.ltSigned / s.ltN : null,
    daily_points: s.n,
    lead_time_windows: s.ltN,
  };
}

// Deterministic PRNG (mulberry32) for the bootstrap.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Paired bootstrap over variants of (pooled metric of A) - (pooled metric of B).
function bootstrapDiff(errA, errB, metric) {
  const random = rng(BOOTSTRAP_SEED);
  const n = errA.length;
  const diffs = [];
  for (let d = 0; d < BOOTSTRAP_DRAWS; d += 1) {
    const idx = Array.from({ length: n }, () => Math.floor(random() * n));
    diffs.push(pooled(idx.map((i) => errA[i]))[metric] - pooled(idx.map((i) => errB[i]))[metric]);
  }
  diffs.sort((x, y) => x - y);
  return {
    point: pooled(errA)[metric] - pooled(errB)[metric],
    ci95: [diffs[Math.floor(0.025 * BOOTSTRAP_DRAWS)], diffs[Math.floor(0.975 * BOOTSTRAP_DRAWS) - 1]],
  };
}

function run() {
  const { options, dataset } = observedDataset();
  const seriesByVariant = dailySeriesByVariant(dataset, WINDOW_DAYS);
  const variants = Array.from(seriesByVariant.values());

  const errors = {};
  for (const split of ['val', 'test']) {
    errors[split] = Object.fromEntries(Object.keys(CANDIDATES).map((m) => [m, variants.map((s) => variantErrors(s, m, split))]));
  }
  const summary = Object.fromEntries(['val', 'test'].map((split) => [
    split, Object.fromEntries(Object.keys(CANDIDATES).map((m) => [m, pooled(errors[split][m])])),
  ]));
  const selected = SELECTABLE.reduce((best, m) => (summary.val[m].mae < summary.val[best].mae ? m : best), SELECTABLE[0]);

  const comparisons = {};
  for (const [a, b] of [[selected, 'PROD_EWMA_TREND_30D'], [selected, 'MA30'], ['PROD_EWMA_TREND_30D', 'MA30'], ['SES_0.35_30D', 'PROD_EWMA_TREND_30D']]) {
    comparisons[`${a} - ${b}`] = {
      mae: bootstrapDiff(errors.test[a], errors.test[b], 'mae'),
      lt_sum_mae: bootstrapDiff(errors.test[a], errors.test[b], 'lt_sum_mae'),
    };
  }

  return {
    provenance: provenance(options),
    protocol: {
      window_days: WINDOW_DAYS, min_train_days: MIN_TRAIN_DAYS, fold_step_days: HORIZON,
      daily_metric_horizon_days: HORIZON, lead_time_days: LEAD_TIME, production_window_days: PROD_WINDOW,
      split: 'folds with cut in the first half of the window = val, second half = test',
      selection: 'lowest val MAE among SES/EWMA candidates (MA30/TSB are references only)',
      bootstrap: { draws: BOOTSTRAP_DRAWS, seed: BOOTSTRAP_SEED, unit: 'variant (paired)' },
    },
    variants: variants.length,
    selected_on_validation: selected,
    summary,
    test_comparisons: comparisons,
  };
}

const f = (x, d = 4) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));

function render(r) {
  const rows = (split) => Object.entries(r.summary[split])
    .sort(([, a], [, b]) => a.mae - b.mae)
    .map(([m, s]) => `| ${m}${m === r.selected_on_validation ? ' (chọn trên val)' : ''} | ${f(s.mae)} | ${f(s.rmse)} | ${f(s.bias)} | ${f(s.lt_sum_mae, 3)} | ${f(s.lt_sum_bias, 3)} |`);
  const header = '| Mô hình | MAE ngày | RMSE ngày | Bias ngày | MAE tổng 14 ngày | Bias tổng 14 ngày |\n| --- | --- | --- | --- | --- | --- |';
  const cmp = Object.entries(r.test_comparisons).map(([k, v]) => `| ${k} | ${f(v.mae.point)} [${f(v.mae.ci95[0])}, ${f(v.mae.ci95[1])}] | ${f(v.lt_sum_mae.point, 3)} [${f(v.lt_sum_mae.ci95[0], 3)}, ${f(v.lt_sum_mae.ci95[1], 3)}] |`);
  return `# Chẩn đoán mô hình dự báo nhu cầu (tự động)

> Sinh bởi \`services/analytics-service/eval/forecast-diagnostics.js\` — không sửa tay. Dữ liệu TỔNG HỢP
> (seed ${r.provenance.seed ?? 'mặc định'}), ${r.variants} variant, cửa sổ ${r.protocol.window_days} ngày.

Giao thức: rolling origin, cửa sổ huấn luyện mở rộng, mỗi fold cách ${r.protocol.fold_step_days} ngày. Fold có mốc cắt ở
nửa đầu cửa sổ = **validation**, nửa sau = **test**. Mô hình được **chọn trên validation** (MAE thấp nhất trong
nhóm SES/EWMA); kết quả báo cáo của nó là trên **test**. CI 95% bootstrap ghép cặp theo variant
(${r.protocol.bootstrap.draws} lần, seed ${r.protocol.bootstrap.seed}). "Tổng 14 ngày" = sai số của tổng dự báo trong lead time 14
ngày — đại lượng mà gợi ý nhập kho thực sự dùng.

Mô hình được chọn trên validation: **${r.selected_on_validation}**.

## Validation
${header}
${rows('val').join('\n')}

## Test
${header}
${rows('test').join('\n')}

## So sánh trên test (hiệu A − B; âm = A tốt hơn)
| Cặp | Δ MAE ngày [CI 95%] | Δ MAE tổng 14 ngày [CI 95%] |
| --- | --- | --- |
${cmp.join('\n')}
`;
}

if (require.main === module) {
  const result = run();
  const root = path.resolve(__dirname, '../../..');
  fs.writeFileSync(path.join(root, 'thesis/data/forecast_diagnostics_results.json'), `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'docs/ANALYSIS/FORECAST_DIAGNOSTICS.md'), render(result));
  console.log(render(result));
}

module.exports = { CANDIDATES, variantErrors, pooled, bootstrapDiff, run };
