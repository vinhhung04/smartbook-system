// End-to-end checks of the thesis evaluation pipeline on the real synthetic
// dataset (no DB). Slower than the unit tests (~10 s): it regenerates the
// seeded population.
const test = require('node:test');
const assert = require('node:assert/strict');
const { metricSummary, predict, FORECAST_MODELS } = require('../src/utils/forecast');
const { evaluateForecastModels } = require('../eval/forecast-evaluation');
const { buildDemandWorld, simulationModules, simulationOptions } = require('../eval/synthetic-world');
const { runReorderBacktest } = require('../eval/reorder-policy-backtest');

const DAY_MS = 24 * 60 * 60 * 1000;

test('forecast evaluation pools exactly: equals metricSummary over every (actual, forecast) pair', () => {
  // Two-variant toy dataset in the observed-dataset shape.
  const end = new Date(Date.UTC(2026, 0, 31));
  const loans = [];
  const items = [];
  const add = (variant, daysBefore) => {
    const id = `l${loans.length}`;
    loans.push({ id, borrow_date: new Date(end.getTime() - daysBefore * DAY_MS + 3600000) });
    items.push({ loan_id: id, variant_id: variant });
  };
  for (let d = 1; d <= 60; d += 1) {
    if (d % 3 === 0) add('a', d);
    if (d % 7 === 0) { add('b', d); add('b', d); }
  }
  const dataset = { meta: { end }, tables: { loan_transactions: loans, loan_items: items } };
  const result = evaluateForecastModels(dataset, { windowDays: 60, minTrainDays: 30, horizons: [7] });

  // Recompute by hand with the same fold layout.
  const { dailySeriesByVariant } = require('../eval/forecast-evaluation');
  const series = dailySeriesByVariant(dataset, 60);
  for (const model of FORECAST_MODELS) {
    const actual = [];
    const predicted = [];
    for (const s of series.values()) {
      for (let cut = 30; cut + 7 <= s.length; cut += 7) {
        actual.push(...s.slice(cut, cut + 7));
        predicted.push(...predict(model, s.slice(0, cut), 7));
      }
    }
    const expected = metricSummary(actual, predicted);
    const got = result.horizons[0].overall.find((m) => m.model === model);
    for (const key of ['mae', 'rmse', 'wape', 'mape', 'bias', 'samples']) {
      assert.ok(Math.abs(got[key] - expected[key]) < 1e-9, `${model} ${key}: ${got[key]} != ${expected[key]}`);
    }
  }
});

test('the backtest replays the same population the observed dataset was generated from', () => {
  const world = buildDemandWorld();
  const { simulate, catalog } = simulationModules();
  const options = simulationOptions();
  const observed = simulate.generateDataset({ ...options, catalog: catalog.buildCatalog(options.seed) });
  assert.deepEqual(world.copies, observed.copies); // same pilot -> same calibrated collection
});

test('reorder backtest: deterministic, same demand for every policy, and internally consistent', () => {
  const world = buildDemandWorld();
  const a = runReorderBacktest(world);
  const b = runReorderBacktest(buildDemandWorld());
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));

  for (const scenario of a.scenarios) {
    const rows = [...a.policies, ...a.ablation].filter((p) => p.scenario === scenario.id);
    const demand = new Set(rows.map((p) => p.metrics.total_demand));
    assert.equal(demand.size, 1, `${scenario.id}: every policy must face the same demand`);
    for (const p of rows) {
      const m = p.metrics;
      assert.equal(m.fulfilled_demand + m.unmet_demand, m.total_demand);
      assert.ok(m.fill_rate >= 0 && m.fill_rate <= 1);
      assert.ok(m.max_inventory >= m.average_inventory);
      assert.ok(m.average_inventory >= scenario.initial_catalog_copies); // copies are never lost
      if (m.budget_utilization !== undefined) assert.ok(m.budget_utilization <= 1 + 1e-9);
    }
    const none = rows.find((p) => p.policy === 'NO_REORDER');
    assert.equal(none.metrics.ordered_units, 0);
    assert.equal(none.metrics.average_inventory, scenario.initial_catalog_copies);
  }
  // With a deterministic 14-day supplier, learning the lead time can only ever
  // learn 14: the FIXED_LEAD_TIME ablation must be indistinguishable from FULL.
  const base = a.ablation.filter((x) => x.scenario === 'BASE' && !x.budget_constrained);
  const full = base.find((x) => x.variant === 'SMARTBOOK_FULL');
  const fixed = base.find((x) => x.variant === 'SMARTBOOK_FIXED_LEAD_TIME');
  assert.deepEqual(fixed.metrics, full.metrics);
});
