#!/usr/bin/env node
/**
 * Phase 4 (Copilot 3.3 cycle): cost-aware reorder candidates, evaluated before
 * any production change. Builds on eval/reorder-candidates.js (which adopted
 * SHORTFALL_RANK on 2026-10-08) and addresses the mechanisms that study left
 * open (docs/ANALYSIS/REORDER_DECISION_EVALUATION.md section 11):
 *   (1) the order quantity is netted against shelf stock only, as if every
 *       borrow were consumed - library copies come back;
 *   (2) the priority minimum quantities (HIGH >= 5, MEDIUM >= 3) buy copies for
 *       titles whose shelf already covers the lead time;
 *   (3) the budget order funds whole lines, not the copies that most reduce
 *       expected unmet demand per VND.
 *
 * CANDIDATES (defined from those mechanisms before any test seed was run):
 *   IP_RETURNS          position = shelf + on order + whole copies expected back
 *                       from loans within the lead time (Kaplan-Meier over the
 *                       loans this inventory has observed; utils/expected-returns.js)
 *   FLOOR_IF_SHORTFALL  priority minimums only when lead-time demand > position
 *   IP_RETURNS+FLOOR    both
 *   IP_RETURNS+ADAPTIVE_Z  IP_RETURNS with z = 1.645 for titles borrowed >= 0.2
 *                       times a day, z = 1.0 below (slow movers carry less safety)
 *   MARGINAL            budget only: production quantities, copies funded one at a
 *                       time by P(lead-time demand > position + k) / unit cost
 *   IP_RETURNS+FLOOR+MARGINAL  budget only
 *
 * PRE-REGISTERED PROTOCOL (fixed in this file before TEST_SEEDS were run):
 *   - Development seeds: 20260928 (every earlier analysis) and 20261101-03 (the
 *     previous candidate study's test seeds). Used to build the candidates.
 *   - Test seeds: TEST_SEEDS, eight populations never generated before.
 *   - Same demand, starting collection, lead-time scenario, unit costs, review
 *     cycle and budget rule for every policy (inventory-simulator.js).
 *   - An UNCONSTRAINED candidate replaces production only if, on EVERY test seed
 *     x scenario (BASE, SUPPLIER_DELAY, LEAN_START):
 *         fill rate >= SMARTBOOK - 0.05 pp  AND
 *         stockout days <= max(SMARTBOOK x 1.05, SMARTBOOK + 2)
 *     and the procurement cost summed over all test runs <= 0.90 x SMARTBOOK.
 *   - A BUDGET candidate replaces production's funding order only if, on EVERY
 *     test seed x scenario under the same per-review budget, its fill rate is
 *     higher than SMARTBOOK_BUDGET (production quantities, SHORTFALL_RANK order).
 *   - Several passing candidates: the one with the lowest summed test cost.
 *   - Reported for every candidate, pass or not: paired differences vs SMARTBOOK
 *     (mean and 95% t-interval over the test seeds) and Pareto position vs the
 *     REORDER_POINT and MA30_FIXED_LT baselines (cost vs fill rate).
 *   - The z sweep at the end is descriptive (cost / service trade-off curve),
 *     never used to pick a candidate.
 *
 * USAGE (from services/analytics-service):
 *   node eval/reorder-optimization.js [--dev-only]
 * OUTPUT: thesis/data/reorder_optimization_results.json,
 *         docs/ANALYSIS/REORDER_OPTIMIZATION_EVALUATION.md (generated tables;
 *         the hand-written discussion lives in the same file below the marker)
 */

const fs = require('fs');
const path = require('path');
const { buildDemandWorld } = require('./synthetic-world');
const { runInventoryBacktest } = require('./inventory-simulator');
const { reorderPointPolicy, ma30FixedLeadTimePolicy, smartbookPolicy, noReorderPolicy, marginalAllocation } = require('./reorder-policies');
const { WARM_UP_DAYS, REVIEW_PERIOD_DAYS, STEADY_STATE_OFFSET_DAYS, scenarios } = require('./reorder-policy-backtest');

const DEV_SEEDS = [20260928, 20261101, 20261102, 20261103];
const TEST_SEEDS = [20261201, 20261202, 20261203, 20261204, 20261205, 20261206, 20261207, 20261208];
const SCENARIOS = ['BASE', 'SUPPLIER_DELAY', 'LEAN_START'];
const FILL_MARGIN = 0.0005;
const STOCKOUT_RATIO = 1.05;
const STOCKOUT_SLACK = 2;
const COST_TARGET = 0.9;
const adaptiveZ = (dailyDemand) => (dailyDemand >= 0.2 ? 1.645 : 1.0);

const UNCONSTRAINED = {
  SMARTBOOK: {},
  IP_RETURNS: { expectedReturns: true },
  FLOOR_IF_SHORTFALL: { priorityFloors: 'IF_SHORTFALL' },
  'IP_RETURNS+FLOOR': { expectedReturns: true, priorityFloors: 'IF_SHORTFALL' },
  'IP_RETURNS+ADAPTIVE_Z': { expectedReturns: true, safetyZ: adaptiveZ },
};
// budget runs: [policy options, allocation]
const BUDGETED = {
  SMARTBOOK: [{}, null],
  MARGINAL: [{}, marginalAllocation],
  'IP_RETURNS+FLOOR': [{ expectedReturns: true, priorityFloors: 'IF_SHORTFALL' }, null],
  'IP_RETURNS+FLOOR+MARGINAL': [{ expectedReturns: true, priorityFloors: 'IF_SHORTFALL' }, marginalAllocation],
};
const Z_SWEEP = [1.0, 1.28, 1.645, 2.05];

function pick(m) {
  return {
    fill_rate: m.fill_rate, unmet_demand: m.unmet_demand, stockout_days: m.stockout_days,
    average_inventory: m.average_inventory, average_inventory_value: m.average_inventory_value,
    procurement_cost: m.procurement_cost, ordered_units: m.ordered_units, order_count: m.order_count,
    budget_utilization: m.budget_utilization ?? null,
  };
}

function runSeed(seed, { sweep = false } = {}) {
  const world = buildDemandWorld({ seed });
  const firstDay = world.firstDay;
  const evalStartDay = firstDay + WARM_UP_DAYS;
  const common = { reservationsByVariant: new Map(world.variants.map((v) => [v.variantId, v.reservations])), wishlistsByBook: world.wishlistsByBook };
  const rows = [];
  for (const scenario of scenarios(seed)) {
    const variants = world.variants.map((v) => ({ ...v, initialCopies: scenario.initialCopies(v) }));
    const run = (policy, budgetPerReview = null, allocate = null) => runInventoryBacktest({
      variants, firstDay, evalStartDay, endDay: world.endDay, reviewPeriodDays: REVIEW_PERIOD_DAYS, policy,
      leadTimeDays: scenario.leadTimeDays, rankCandidates: policy.rankCandidates || null,
      steadyStartDay: evalStartDay + STEADY_STATE_OFFSET_DAYS, budgetPerReview, allocate,
    });
    const add = (policy, budget, result, extra = {}) => rows.push({ seed, scenario: scenario.id, policy, budget, ...pick(result.metrics), ...extra });
    const none = run(noReorderPolicy());
    const rp = run(reorderPointPolicy());
    const ma = run(ma30FixedLeadTimePolicy());
    add('NO_REORDER', false, none);
    add('REORDER_POINT', false, rp);
    add('MA30_FIXED_LT', false, ma);
    let reviews = null;
    for (const [name, opts] of Object.entries(UNCONSTRAINED)) {
      const result = run(smartbookPolicy({ ...common, name, ...opts }));
      reviews = reviews ?? result.decisionStats.reviews;
      add(name, false, result);
    }
    const budgetPerReview = Math.min(rp.metrics.procurement_cost, ma.metrics.procurement_cost) / reviews;
    for (const [name, [opts, allocate]] of Object.entries(BUDGETED)) {
      add(name, true, run(smartbookPolicy({ ...common, name, ...opts }), budgetPerReview, allocate), { budget_per_review_vnd: budgetPerReview });
    }
    add('REORDER_POINT', true, run(reorderPointPolicy(), budgetPerReview), { budget_per_review_vnd: budgetPerReview });
    add('MA30_FIXED_LT', true, run(ma30FixedLeadTimePolicy(), budgetPerReview), { budget_per_review_vnd: budgetPerReview });
    if (sweep) {
      for (const z of Z_SWEEP) {
        const fixedZ = () => z;
        add(`SWEEP_SMARTBOOK_z${z}`, false, run(smartbookPolicy({ ...common, name: 'sweep', safetyZ: fixedZ })), { z });
        add(`SWEEP_IP_RETURNS+FLOOR_z${z}`, false, run(smartbookPolicy({ ...common, name: 'sweep', expectedReturns: true, priorityFloors: 'IF_SHORTFALL', safetyZ: fixedZ })), { z });
      }
    }
  }
  return rows;
}

function find(rows, seed, scenario, policy, budget) {
  return rows.find((r) => r.seed === seed && r.scenario === scenario && r.policy === policy && r.budget === budget);
}

function tInterval(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, low: mean, high: mean };
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const t = { 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447, 8: 2.365, 9: 2.306, 10: 2.262 }[n] || 1.96;
  const half = t * sd / Math.sqrt(n);
  return { mean, low: mean - half, high: mean + half };
}

function judgeUnconstrained(rows, seeds, candidate) {
  const checks = [];
  let costC = 0;
  let costB = 0;
  for (const seed of seeds) {
    for (const scenario of SCENARIOS) {
      const base = find(rows, seed, scenario, 'SMARTBOOK', false);
      const cand = find(rows, seed, scenario, candidate, false);
      costC += cand.procurement_cost;
      costB += base.procurement_cost;
      checks.push({
        seed, scenario,
        fill_ok: cand.fill_rate >= base.fill_rate - FILL_MARGIN,
        stockout_ok: cand.stockout_days <= Math.max(base.stockout_days * STOCKOUT_RATIO, base.stockout_days + STOCKOUT_SLACK),
      });
    }
  }
  const costRatio = costC / costB;
  const service = checks.every((c) => c.fill_ok && c.stockout_ok);
  return { candidate, cost_ratio: costRatio, service_non_inferior: service, cost_target_met: costRatio <= COST_TARGET,
    passes: service && costRatio <= COST_TARGET, failures: checks.filter((c) => !(c.fill_ok && c.stockout_ok)) };
}

function judgeBudget(rows, seeds, candidate) {
  const checks = [];
  for (const seed of seeds) {
    for (const scenario of SCENARIOS) {
      const base = find(rows, seed, scenario, 'SMARTBOOK', true);
      const cand = find(rows, seed, scenario, candidate, true);
      checks.push({ seed, scenario, better: cand.fill_rate > base.fill_rate });
    }
  }
  return { candidate, passes: checks.every((c) => c.better), wins: checks.filter((c) => c.better).length, runs: checks.length };
}

function pairedDiffs(rows, seeds, candidate, budget) {
  const out = {};
  for (const scenario of SCENARIOS) {
    const d = (field) => tInterval(seeds.map((seed) => find(rows, seed, scenario, candidate, budget)[field]
      - find(rows, seed, scenario, 'SMARTBOOK', budget)[field]));
    const rel = tInterval(seeds.map((seed) => find(rows, seed, scenario, candidate, budget).procurement_cost
      / find(rows, seed, scenario, 'SMARTBOOK', budget).procurement_cost - 1));
    out[scenario] = { fill_pp: scale(d('fill_rate'), 100), stockout_days: d('stockout_days'), unmet: d('unmet_demand'),
      cost_rel_pct: scale(rel, 100), avg_inventory: d('average_inventory') };
  }
  return out;
}

function scale(ci, k) {
  return { mean: ci.mean * k, low: ci.low * k, high: ci.high * k };
}

// Pareto vs the simple baselines (unconstrained runs): does the candidate reach
// at least the baseline's fill rate at no more cost, per seed x scenario?
function pareto(rows, seeds, candidate) {
  const out = {};
  for (const baseline of ['REORDER_POINT', 'MA30_FIXED_LT']) {
    let dominates = 0;
    let dominated = 0;
    let tradeoff = 0;
    for (const seed of seeds) {
      for (const scenario of SCENARIOS) {
        const c = find(rows, seed, scenario, candidate, false);
        const b = find(rows, seed, scenario, baseline, false);
        if (c.fill_rate >= b.fill_rate && c.procurement_cost <= b.procurement_cost) dominates += 1;
        else if (c.fill_rate <= b.fill_rate && c.procurement_cost >= b.procurement_cost) dominated += 1;
        else tradeoff += 1;
      }
    }
    out[baseline] = { dominates, dominated, tradeoff };
  }
  return out;
}

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const mvnd = (x) => (x / 1e6).toFixed(1);
const ci = (c, digits = 2) => `${c.mean.toFixed(digits)} [${c.low.toFixed(digits)}; ${c.high.toFixed(digits)}]`;

function meanTable(rows, seeds, budget, policies) {
  const lines = ['| Kịch bản | Chính sách | Fill rate TB | Unmet TB | Stockout days TB | Tồn kho TB (bản) | Giá trị tồn TB (triệu) | Chi phí TB (triệu) | Số đơn TB |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const scenario of SCENARIOS) {
    for (const policy of policies) {
      const rs = seeds.map((seed) => find(rows, seed, scenario, policy, budget)).filter(Boolean);
      if (!rs.length) continue;
      const m = (f) => rs.reduce((a, r) => a + r[f], 0) / rs.length;
      lines.push(`| ${scenario} | ${policy} | ${pct(m('fill_rate'))} | ${m('unmet_demand').toFixed(0)} | ${m('stockout_days').toFixed(1)} | ${m('average_inventory').toFixed(0)} | ${mvnd(m('average_inventory_value'))} | ${mvnd(m('procurement_cost'))} | ${m('order_count').toFixed(0)} |`);
    }
  }
  return lines.join('\n');
}

function render(result) {
  const u = result.test.unconstrained;
  const b = result.test.budget;
  const unconstrainedPolicies = ['NO_REORDER', 'REORDER_POINT', 'MA30_FIXED_LT', ...Object.keys(UNCONSTRAINED)];
  const budgetPolicies = ['REORDER_POINT', 'MA30_FIXED_LT', ...Object.keys(BUDGETED)];
  const diffRows = [];
  for (const [name, diffs] of Object.entries(result.test.paired_unconstrained)) {
    for (const scenario of SCENARIOS) {
      const d = diffs[scenario];
      diffRows.push(`| ${name} | ${scenario} | ${ci(d.fill_pp)} | ${ci(d.stockout_days, 1)} | ${ci(d.cost_rel_pct, 1)} | ${ci(d.avg_inventory, 0)} |`);
    }
  }
  const budgetDiffRows = [];
  for (const [name, diffs] of Object.entries(result.test.paired_budget)) {
    for (const scenario of SCENARIOS) {
      const d = diffs[scenario];
      budgetDiffRows.push(`| ${name} | ${scenario} | ${ci(d.fill_pp)} | ${ci(d.unmet, 0)} | ${ci(d.stockout_days, 1)} |`);
    }
  }
  const sweep = result.sweep.map((r) => `| ${r.policy} | ${r.scenario} | ${r.z} | ${pct(r.fill_rate)} | ${r.stockout_days.toFixed(1)} | ${mvnd(r.procurement_cost)} | ${r.average_inventory.toFixed(0)} |`);
  return `<!-- AUTO:reorder-optimization:start -->
> Sinh bởi \`services/analytics-service/eval/reorder-optimization.js\` — không sửa tay phần này. **Dữ liệu TỔNG HỢP** (bộ mô phỏng
> hành vi, không phải thư viện thật). Giao thức và tiêu chí chấp nhận cố định trong đầu script trước khi chạy seed kiểm định.

- Seed phát triển: ${DEV_SEEDS.join(', ')}. **Seed kiểm định (mới):** ${TEST_SEEDS.join(', ')} (${TEST_SEEDS.length} quần thể × 3 kịch bản).
- 114 variant, chu kỳ xem xét 7 ngày, warm-up 395 ngày, chấm điểm ~335 ngày; ngân sách mỗi lần xem xét = chi phí của baseline rẻ hơn ÷ số lần xem xét.

### Kết luận trên seed kiểm định
| Ứng viên (không ngân sách) | Mức phục vụ không kém (mọi seed × kịch bản) | Chi phí so với SMARTBOOK | Kết quả |
| --- | --- | --- | --- |
${u.map((j) => `| ${j.candidate} | ${j.service_non_inferior ? 'đạt' : `KHÔNG (${j.failures.length} lần)`} | ${(j.cost_ratio * 100).toFixed(1)}% | ${j.passes ? '**ĐẠT**' : 'không đạt'} |`).join('\n')}

| Ứng viên (có ngân sách) | Fill rate cao hơn SMARTBOOK_BUDGET | Kết quả |
| --- | --- | --- |
${b.map((j) => `| ${j.candidate} | ${j.wins}/${j.runs} | ${j.passes ? '**ĐẠT**' : 'không đạt'} |`).join('\n')}

Ứng viên được chọn: **${result.selected.unconstrained || 'không có'}** (không ngân sách), **${result.selected.budget || 'không có'}** (thứ tự cấp vốn).

### Trung bình trên ${TEST_SEEDS.length} seed kiểm định — không giới hạn ngân sách
${meanTable(result.rows, TEST_SEEDS, false, unconstrainedPolicies)}

### Trung bình trên ${TEST_SEEDS.length} seed kiểm định — cùng ngân sách mỗi lần xem xét
${meanTable(result.rows, TEST_SEEDS, true, budgetPolicies)}

### Chênh lệch ghép cặp so với SMARTBOOK (trung bình [KTC 95% t] trên seed kiểm định)
| Ứng viên | Kịch bản | Δ fill rate (điểm %) | Δ stockout days | Δ chi phí (%) | Δ tồn kho TB (bản) |
| --- | --- | --- | --- | --- | --- |
${diffRows.join('\n')}

| Ứng viên (ngân sách) | Kịch bản | Δ fill rate (điểm %) | Δ unmet | Δ stockout days |
| --- | --- | --- | --- | --- |
${budgetDiffRows.join('\n')}

### Vị trí Pareto (chi phí ↔ fill rate) so với baseline đơn giản, số seed × kịch bản
| Ứng viên | vs REORDER_POINT: trội / bị trội / đánh đổi | vs MA30_FIXED_LT: trội / bị trội / đánh đổi |
| --- | --- | --- |
${Object.entries(result.test.pareto).map(([n, p]) => `| ${n} | ${p.REORDER_POINT.dominates} / ${p.REORDER_POINT.dominated} / ${p.REORDER_POINT.tradeoff} | ${p.MA30_FIXED_LT.dominates} / ${p.MA30_FIXED_LT.dominated} / ${p.MA30_FIXED_LT.tradeoff} |`).join('\n')}

### Đường đánh đổi theo z (mô tả, seed kiểm định đầu tiên)
| Chính sách | Kịch bản | z | Fill rate | Stockout days | Chi phí (triệu) | Tồn kho TB |
| --- | --- | --- | --- | --- | --- | --- |
${sweep.join('\n')}
<!-- AUTO:reorder-optimization:end -->`;
}

function main(argv = process.argv.slice(2)) {
  const devOnly = argv.includes('--dev-only');
  const seeds = devOnly ? DEV_SEEDS : [...DEV_SEEDS, ...TEST_SEEDS];
  const rows = seeds.flatMap((seed) => runSeed(seed, { sweep: seed === TEST_SEEDS[0] }));
  const names = Object.keys(UNCONSTRAINED).filter((n) => n !== 'SMARTBOOK');
  const budgetNames = Object.keys(BUDGETED).filter((n) => n !== 'SMARTBOOK');
  const evalSeeds = devOnly ? DEV_SEEDS : TEST_SEEDS;
  const unconstrained = names.map((n) => judgeUnconstrained(rows, evalSeeds, n));
  const budget = budgetNames.map((n) => judgeBudget(rows, evalSeeds, n));
  const passU = unconstrained.filter((j) => j.passes).sort((a, b) => a.cost_ratio - b.cost_ratio);
  // same selection rule as the unconstrained candidates: lowest summed test cost
  const budgetCost = (name) => evalSeeds.flatMap((seed) => SCENARIOS.map((sc) => find(rows, seed, sc, name, true).procurement_cost))
    .reduce((a, b) => a + b, 0);
  const passB = budget.filter((j) => j.passes).map((j) => ({ ...j, summed_cost: budgetCost(j.candidate) }))
    .sort((a, b) => a.summed_cost - b.summed_cost);
  const result = {
    synthetic: true,
    protocol: { dev_seeds: DEV_SEEDS, test_seeds: TEST_SEEDS, fill_margin_pp: FILL_MARGIN * 100, stockout_ratio: STOCKOUT_RATIO,
      stockout_slack_days: STOCKOUT_SLACK, cost_target: COST_TARGET, scored_on: devOnly ? 'dev' : 'test' },
    dev: { unconstrained: names.map((n) => judgeUnconstrained(rows, DEV_SEEDS, n)), budget: budgetNames.map((n) => judgeBudget(rows, DEV_SEEDS, n)) },
    test: {
      unconstrained, budget: budget.map((j) => ({ ...j, summed_cost: budgetCost(j.candidate) })),
      paired_unconstrained: Object.fromEntries(names.map((n) => [n, pairedDiffs(rows, evalSeeds, n, false)])),
      paired_budget: Object.fromEntries(budgetNames.map((n) => [n, pairedDiffs(rows, evalSeeds, n, true)])),
      pareto: Object.fromEntries(['SMARTBOOK', ...names].map((n) => [n, pareto(rows, evalSeeds, n)])),
    },
    selected: { unconstrained: passU[0]?.candidate || null, budget: passB[0]?.candidate || null },
    sweep: rows.filter((r) => r.policy.startsWith('SWEEP_')),
    rows: rows.filter((r) => !r.policy.startsWith('SWEEP_')),
  };
  if (!devOnly) {
    const root = path.resolve(__dirname, '../../..');
    fs.writeFileSync(path.join(root, 'thesis/data/reorder_optimization_results.json'), `${JSON.stringify(result, null, 2)}\n`);
    const doc = path.join(root, 'docs/ANALYSIS/REORDER_OPTIMIZATION_EVALUATION.md');
    const generated = render(result);
    const existing = fs.existsSync(doc) ? fs.readFileSync(doc, 'utf8') : '';
    const marker = /<!-- AUTO:reorder-optimization:start -->[\s\S]*<!-- AUTO:reorder-optimization:end -->/;
    fs.writeFileSync(doc, marker.test(existing) ? existing.replace(marker, generated) : `${existing}\n${generated}\n`);
  }
  return result;
}

if (require.main === module) {
  const result = main();
  const scope = result.protocol.scored_on;
  for (const j of result.test.unconstrained) console.log(scope, 'U', j.candidate, 'service', j.service_non_inferior, 'cost', j.cost_ratio.toFixed(3), 'PASS', j.passes, j.failures.length);
  for (const j of result.test.budget) console.log(scope, 'B', j.candidate, `${j.wins}/${j.runs}`, 'PASS', j.passes);
  console.log('selected', result.selected);
}

module.exports = { DEV_SEEDS, TEST_SEEDS, UNCONSTRAINED, BUDGETED, runSeed, judgeUnconstrained, judgeBudget, main };
