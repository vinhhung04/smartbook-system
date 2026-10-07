#!/usr/bin/env node
/**
 * Runs every reorder-decision evaluation and writes machine-readable results
 * for the thesis. Deterministic: same seed -> byte-identical outputs.
 *
 * USAGE (from services/analytics-service):
 *   node eval/run-all.js                         synthetic dataset + repo seed deliveries
 *   node eval/run-all.js --deliveries file.json  lead-time backtest on an exported delivery list
 *   INVENTORY_DATABASE_URL=postgres://... node eval/run-all.js --lead-time-from-db
 *   SIMULATION_SEED=123 node eval/run-all.js     another synthetic population
 *
 * OUTPUTS (repo root):
 *   thesis/data/{forecast_model,reorder_policy,reorder_ablation,lead_time}_results.json
 *   thesis/data/inventory_timeline_example.json
 *   thesis/tables/*.csv
 *   docs/ANALYSIS/REORDER_DECISION_EVALUATION.md  (auto-generated result sections)
 */

const fs = require('fs');
const path = require('path');
const { observedDataset, buildDemandWorld, provenance } = require('./synthetic-world');
const { evaluateForecastModels } = require('./forecast-evaluation');
const { runReorderBacktest } = require('./reorder-policy-backtest');
const { evaluateLeadTimeHistory, deliveriesFromSeedSql, deliveriesFromDatabase, SAMPLE_SEED_PATH } = require('./lead-time-backtest');
const { renderReport } = require('./render-report');

const REPO_ROOT = path.resolve(__dirname, '../../..');
const THESIS_DIR = path.join(REPO_ROOT, 'thesis');
const DOC_PATH = path.join(REPO_ROOT, 'docs/ANALYSIS/REORDER_DECISION_EVALUATION.md');

// Fixed precision keeps the JSON readable and the files byte-stable across runs.
function rounded(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : Number(value.toFixed(6));
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  return value;
}

function writeJson(name, data) {
  const file = path.join(THESIS_DIR, 'data', name);
  fs.writeFileSync(file, `${JSON.stringify(rounded(data), null, 2)}\n`);
  return path.relative(REPO_ROOT, file);
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' && !Number.isInteger(value) ? String(Number(value.toFixed(6))) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeCsv(name, rows) {
  const file = path.join(THESIS_DIR, 'tables', name);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const lines = [columns.join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return path.relative(REPO_ROOT, file);
}

const METRIC_COLUMNS = [
  'total_demand', 'fulfilled_demand', 'unmet_demand', 'fill_rate', 'stockout_days', 'stockout_rate',
  'variants_with_stockout', 'average_inventory', 'max_inventory', 'average_available_inventory',
  'ordered_units', 'order_count', 'procurement_cost', 'average_order_size',
  'budget_total', 'budget_utilization', 'unfunded_reorder_count',
];

function metricRow(metrics) {
  return Object.fromEntries(METRIC_COLUMNS.map((c) => [c, metrics[c] ?? null]));
}

async function loadDeliveries(argv) {
  const fileIndex = argv.indexOf('--deliveries');
  if (fileIndex >= 0) {
    const file = path.resolve(argv[fileIndex + 1]);
    return { source: `json:${path.relative(REPO_ROOT, file)}`, deliveries: JSON.parse(fs.readFileSync(file, 'utf8')) };
  }
  if (argv.includes('--lead-time-from-db')) {
    if (!process.env.INVENTORY_DATABASE_URL) throw new Error('--lead-time-from-db needs INVENTORY_DATABASE_URL');
    return { source: 'inventory_db (INVENTORY_DATABASE_URL)', deliveries: await deliveriesFromDatabase(process.env.INVENTORY_DATABASE_URL) };
  }
  return { source: `seed:${path.relative(REPO_ROOT, SAMPLE_SEED_PATH).replace(/\\/g, '/')}`, deliveries: deliveriesFromSeedSql() };
}

async function main(argv = process.argv.slice(2)) {
  for (const dir of ['data', 'tables', 'figures']) fs.mkdirSync(path.join(THESIS_DIR, dir), { recursive: true });
  const written = [];

  // 1. Forecast models (observed dataset)
  const { options, dataset } = observedDataset();
  const forecast = { provenance: provenance(options), ...evaluateForecastModels(dataset) };
  written.push(writeJson('forecast_model_results.json', forecast));
  written.push(writeCsv('forecast_model_results.csv', forecast.horizons.flatMap((h) => h.overall.map((m) => ({
    horizon_days: h.horizon_days, model: m.model, mae: m.mae, rmse: m.rmse, wape: m.wape, mape: m.mape,
    mape_samples: m.mape_samples, bias: m.bias, samples: m.samples, best_model_votes: h.best_model_votes[m.model],
  })))));
  written.push(writeCsv('forecast_model_by_demand_class.csv', forecast.horizons.flatMap((h) => h.by_demand_class.flatMap((c) => c.models.map((m) => ({
    horizon_days: h.horizon_days, demand_class: c.demand_class, variants: c.variants, model: m.model,
    mae: m.mae, rmse: m.rmse, wape: m.wape, bias: m.bias, samples: m.samples,
  }))))));

  // 2-3. Reorder policies + ablation (uncensored demand world)
  const reorder = runReorderBacktest(buildDemandWorld());
  const { ablation, per_variant_base: perVariant, timeline_example: timeline, ...policyResults } = reorder;
  written.push(writeJson('reorder_policy_results.json', policyResults));
  written.push(writeJson('reorder_ablation_results.json', { provenance: reorder.provenance, protocol: reorder.protocol, scenarios: reorder.scenarios, ablation }));
  written.push(writeJson('inventory_timeline_example.json', { provenance: reorder.provenance, ...timeline }));
  const windows = (row) => [['full', row.metrics], ['steady_state', row.steady_state_metrics]];
  written.push(writeCsv('reorder_policy_results.csv', reorder.policies.flatMap((p) => windows(p).map(([window, m]) => ({
    scenario: p.scenario, policy: p.policy, role: p.role, window, ...metricRow(m),
  })))));
  written.push(writeCsv('reorder_ablation_results.csv', ablation.flatMap((a) => windows(a).map(([window, m]) => ({
    scenario: a.scenario, variant: a.variant, budget_constrained: a.budget_constrained, window, ...metricRow(m),
  })))));
  written.push(writeCsv('reorder_policy_per_variant_base.csv', perVariant));
  written.push(writeCsv('inventory_timeline_example.csv', Object.entries(timeline.policies).flatMap(([policy, days]) => days.map((d) => ({ policy, ...d })))));

  // 4. Lead time (real purchase-order history, never synthetic)
  const { source, deliveries } = await loadDeliveries(argv);
  const leadTime = evaluateLeadTimeHistory(deliveries, { source });
  written.push(writeJson('lead_time_results.json', leadTime));
  written.push(writeCsv('lead_time_results.csv', leadTime.methods.flatMap((m) => [['applicable', m.applicable], ['paired', m.paired]]
    .filter(([, metrics]) => metrics)
    .map(([scope, metrics]) => ({ status: leadTime.status, method: m.method, scope, ...metrics })))));

  // 5. Result sections of the analysis document
  if (fs.existsSync(DOC_PATH)) {
    fs.writeFileSync(DOC_PATH, renderReport(fs.readFileSync(DOC_PATH, 'utf8'), { forecast, reorder, leadTime }));
    written.push(path.relative(REPO_ROOT, DOC_PATH));
  }

  for (const file of written) console.log(`[eval] wrote ${file.replace(/\\/g, '/')}`);
  console.log(`[eval] lead time: ${leadTime.status} (${leadTime.deliveries} deliveries, source ${source})`);
  console.log('[eval] figures: python thesis/scripts/plot_reorder_evaluation.py');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[eval] failed', error);
    process.exitCode = 1;
  });
}

module.exports = { main };
