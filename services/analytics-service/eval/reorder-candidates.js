#!/usr/bin/env node
/**
 * Candidate changes to the production reorder rules, evaluated before any
 * production change. Addresses the two P1 directions of
 * docs/ANALYSIS/REORDER_DECISION_EVALUATION.md section 13:
 *   (2) the priority minimum quantities (HIGH >= 5, MEDIUM >= 3), observed to
 *       drive most of SMARTBOOK's over-ordering, and
 *   (3) the budget order (priority, demand score), observed to fund the wrong
 *       lines: at the same spend SMARTBOOK served far less than a min/max rule.
 *
 * Candidates (defined from those mechanisms, before any candidate was run):
 *   NO_FLOOR            production minus the priority minimum quantities
 *   SHORTFALL_RANK      budget order by expected lead-time shortfall per VND
 *                       (compareByShortfallPerCost), floors kept
 *   NO_FLOOR+SHORTFALL  both
 *
 * PRE-REGISTERED PROTOCOL (fixed in this file before the test seeds were run):
 *   - Development: the default synthetic population (seed 20260928) - the one
 *     every earlier analysis already looked at. Used to build the candidates.
 *   - Test: TEST_SEEDS, three populations never generated before this study.
 *     A candidate replaces production only if it passes on EVERY test seed
 *     and EVERY scenario (BASE, SUPPLIER_DELAY, LEAN_START):
 *       unconstrained (no budget) - non-inferior service:
 *         fill rate >= SMARTBOOK fill rate - 0.05 percentage points AND
 *         stockout days <= SMARTBOOK stockout days x 1.05
 *       and cost: mean procurement cost over all test runs <= 0.90 x SMARTBOOK
 *       budget-matched (same budget rule as the main backtest):
 *         fill rate > SMARTBOOK_BUDGET_MATCHED fill rate
 *     A budget-only candidate (SHORTFALL_RANK) is judged on the budget rule
 *     plus unchanged unconstrained behaviour (it only changes the order).
 *
 * USAGE (from services/analytics-service):
 *   node eval/reorder-candidates.js            dev + test seeds
 * OUTPUT: thesis/data/reorder_candidates_results.json, docs/ANALYSIS/REORDER_CANDIDATES.md
 */

const fs = require('fs');
const path = require('path');
const { buildDemandWorld } = require('./synthetic-world');
const { runInventoryBacktest } = require('./inventory-simulator');
const { reorderPointPolicy, ma30FixedLeadTimePolicy, smartbookPolicy } = require('./reorder-policies');
const { WARM_UP_DAYS, REVIEW_PERIOD_DAYS, STEADY_STATE_OFFSET_DAYS, scenarios } = require('./reorder-policy-backtest');

const DEV_SEED = 20260928;
const TEST_SEEDS = [20261101, 20261102, 20261103];
const FILL_MARGIN = 0.0005; // 0.05 percentage points
const STOCKOUT_MARGIN = 1.05;
const COST_TARGET = 0.9;

// SMARTBOOK = production as it was when this study was registered (budget in
// priority order). Spelled out because smartbookPolicy's default now follows
// production, which adopted SHORTFALL_RANK after this study.
const CANDIDATES = {
  SMARTBOOK: { rankBy: 'PRIORITY' },
  NO_FLOOR: { priorityFloors: false, rankBy: 'PRIORITY' },
  SHORTFALL_RANK: { rankBy: 'SHORTFALL_PER_COST' },
  'NO_FLOOR+SHORTFALL': { priorityFloors: false, rankBy: 'SHORTFALL_PER_COST' },
};

function pick(m) {
  return {
    fill_rate: m.fill_rate, unmet_demand: m.unmet_demand, stockout_days: m.stockout_days,
    average_inventory: m.average_inventory, procurement_cost: m.procurement_cost,
    ordered_units: m.ordered_units, order_count: m.order_count,
  };
}

function runSeed(seed) {
  const world = buildDemandWorld({ seed });
  const firstDay = world.firstDay;
  const evalStartDay = firstDay + WARM_UP_DAYS;
  const common = { reservationsByVariant: new Map(world.variants.map((v) => [v.variantId, v.reservations])), wishlistsByBook: world.wishlistsByBook };
  const rows = [];
  for (const scenario of scenarios(seed)) {
    const variants = world.variants.map((v) => ({ ...v, initialCopies: scenario.initialCopies(v) }));
    const run = (policy, budgetPerReview = null) => runInventoryBacktest({
      variants, firstDay, evalStartDay, endDay: world.endDay, reviewPeriodDays: REVIEW_PERIOD_DAYS, policy,
      leadTimeDays: scenario.leadTimeDays, rankCandidates: policy.rankCandidates || null,
      steadyStartDay: evalStartDay + STEADY_STATE_OFFSET_DAYS, budgetPerReview,
    });
    const rp = run(reorderPointPolicy());
    const ma = run(ma30FixedLeadTimePolicy());
    rows.push({ seed, scenario: scenario.id, policy: 'REORDER_POINT', budget: false, ...pick(rp.metrics) });
    rows.push({ seed, scenario: scenario.id, policy: 'MA30_FIXED_LT', budget: false, ...pick(ma.metrics) });
    let budgetPerReview = null;
    for (const [name, opts] of Object.entries(CANDIDATES)) {
      const policy = smartbookPolicy({ ...common, name, ...opts });
      const free = run(policy);
      if (budgetPerReview === null) {
        budgetPerReview = Math.min(rp.metrics.procurement_cost, ma.metrics.procurement_cost) / free.decisionStats.reviews;
      }
      const budgeted = run(policy, budgetPerReview);
      rows.push({ seed, scenario: scenario.id, policy: name, budget: false, ...pick(free.metrics) });
      rows.push({ seed, scenario: scenario.id, policy: name, budget: true, budget_per_review_vnd: budgetPerReview, ...pick(budgeted.metrics) });
    }
    // Reference only (added after the development run, criteria unchanged): the
    // simple baselines under the SAME per-review budget. Unconstrained, they may
    // spend most of their total in the first reviews; SMARTBOOK_BUDGET_MATCHED
    // cannot, so "same total spend" alone is not a like-for-like comparison.
    for (const [name, policy] of [['REORDER_POINT', reorderPointPolicy()], ['MA30_FIXED_LT', ma30FixedLeadTimePolicy()]]) {
      rows.push({ seed, scenario: scenario.id, policy: name, budget: true, budget_per_review_vnd: budgetPerReview, ...pick(run(policy, budgetPerReview).metrics) });
    }
  }
  return rows;
}

function find(rows, seed, scenario, policy, budget) {
  return rows.find((r) => r.seed === seed && r.scenario === scenario && r.policy === policy && r.budget === budget);
}

function judge(rows, seeds, candidate) {
  const checks = [];
  let costCandidate = 0;
  let costBase = 0;
  for (const seed of seeds) {
    for (const scenario of ['BASE', 'SUPPLIER_DELAY', 'LEAN_START']) {
      const base = find(rows, seed, scenario, 'SMARTBOOK', false);
      const cand = find(rows, seed, scenario, candidate, false);
      const baseBudget = find(rows, seed, scenario, 'SMARTBOOK', true);
      const candBudget = find(rows, seed, scenario, candidate, true);
      costCandidate += cand.procurement_cost;
      costBase += base.procurement_cost;
      checks.push({
        seed, scenario,
        fill_non_inferior: cand.fill_rate >= base.fill_rate - FILL_MARGIN,
        stockout_non_inferior: cand.stockout_days <= base.stockout_days * STOCKOUT_MARGIN,
        budget_fill_better: candBudget.fill_rate > baseBudget.fill_rate,
      });
    }
  }
  const costRatio = costCandidate / costBase;
  const service = checks.every((c) => c.fill_non_inferior && c.stockout_non_inferior);
  const budget = checks.every((c) => c.budget_fill_better);
  return {
    candidate, cost_ratio: costRatio, service_non_inferior: service, budget_better_everywhere: budget,
    cost_target_met: costRatio <= COST_TARGET,
    passes: candidate === 'SHORTFALL_RANK' ? budget && service : service && budget && costRatio <= COST_TARGET,
    checks,
  };
}

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const mvnd = (x) => (x / 1e6).toFixed(1);

function table(rows, seeds, budget) {
  const lines = ['| Seed | Kịch bản | Chính sách | Fill rate | Unmet | Stockout days | Tồn kho TB | Chi phí (triệu) |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const r of rows.filter((x) => seeds.includes(x.seed) && x.budget === budget)) {
    lines.push(`| ${r.seed} | ${r.scenario} | ${r.policy} | ${pct(r.fill_rate)} | ${r.unmet_demand} | ${r.stockout_days} | ${r.average_inventory.toFixed(1)} | ${mvnd(r.procurement_cost)} |`);
  }
  return lines.join('\n');
}

function render(result) {
  const verdict = (j) => `| ${j.candidate} | ${j.service_non_inferior ? 'đạt' : 'KHÔNG'} | ${j.budget_better_everywhere ? 'đạt' : 'KHÔNG'} | ${(j.cost_ratio * 100).toFixed(1)}% | ${j.passes ? '**ĐẠT**' : 'không đạt'} |`;
  return `# Ứng viên cải tiến quy tắc nhập kho (tự động)

> Sinh bởi \`services/analytics-service/eval/reorder-candidates.js\` — không sửa tay. Dữ liệu TỔNG HỢP.
> Giao thức và tiêu chí chấp nhận được cố định trong đầu file script **trước** khi chạy các seed kiểm định.

- Seed phát triển (đã dùng ở mọi phân tích trước): ${DEV_SEED}. Seed kiểm định (mới): ${TEST_SEEDS.join(', ')}.
- Ứng viên: \`NO_FLOOR\` (bỏ sàn số lượng HIGH ≥ 5 / MEDIUM ≥ 3), \`SHORTFALL_RANK\` (xếp hạng dưới ngân sách theo
  thiếu hụt kỳ vọng trong lead time trên mỗi đồng), \`NO_FLOOR+SHORTFALL\` (cả hai).
- Tiêu chí (mọi seed kiểm định × mọi kịch bản): không ngân sách — fill rate ≥ SMARTBOOK − 0.05 điểm % và stockout
  days ≤ SMARTBOOK × 1.05; chi phí trung bình ≤ 90% SMARTBOOK; có ngân sách — fill rate > SMARTBOOK_BUDGET_MATCHED.
  \`SHORTFALL_RANK\` chỉ đổi thứ tự cấp vốn nên chỉ xét tiêu chí ngân sách và không-kém-hơn.

## Kết luận trên seed kiểm định
| Ứng viên | Mức phục vụ không kém | Ngân sách: fill rate tốt hơn | Chi phí so với SMARTBOOK | Kết quả |
| --- | --- | --- | --- | --- |
${result.test_verdicts.map(verdict).join('\n')}

## Seed kiểm định — không giới hạn ngân sách
${table(result.rows, TEST_SEEDS, false)}

## Seed kiểm định — ngân sách khớp baseline rẻ hơn
${table(result.rows, TEST_SEEDS, true)}

## Seed phát triển (tham khảo, không dùng để kết luận)
| Ứng viên | Mức phục vụ không kém | Ngân sách: fill rate tốt hơn | Chi phí so với SMARTBOOK | Kết quả |
| --- | --- | --- | --- | --- |
${result.dev_verdicts.map(verdict).join('\n')}

${table(result.rows, [DEV_SEED], false)}

${table(result.rows, [DEV_SEED], true)}
`;
}

function main(argv = process.argv.slice(2)) {
  const seeds = argv.includes('--dev-only') ? [DEV_SEED] : [DEV_SEED, ...TEST_SEEDS];
  const rows = seeds.flatMap(runSeed);
  const names = Object.keys(CANDIDATES).filter((n) => n !== 'SMARTBOOK');
  const result = {
    synthetic: true,
    protocol: { dev_seed: DEV_SEED, test_seeds: TEST_SEEDS, fill_margin_pp: FILL_MARGIN * 100, stockout_margin: STOCKOUT_MARGIN, cost_target: COST_TARGET },
    dev_verdicts: names.map((n) => judge(rows, [DEV_SEED], n)),
    test_verdicts: seeds.length > 1 ? names.map((n) => judge(rows, TEST_SEEDS, n)) : [],
    rows,
  };
  const root = path.resolve(__dirname, '../../..');
  if (seeds.length > 1) {
    fs.writeFileSync(path.join(root, 'thesis/data/reorder_candidates_results.json'), `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(path.join(root, 'docs/ANALYSIS/REORDER_CANDIDATES.md'), render(result));
  }
  return result;
}

if (require.main === module) {
  const result = main();
  for (const key of ['dev_verdicts', 'test_verdicts']) {
    for (const v of result[key]) console.log(key, v.candidate, 'service', v.service_non_inferior, 'budget', v.budget_better_everywhere, 'cost', v.cost_ratio.toFixed(3), 'PASS', v.passes);
  }
}

module.exports = { CANDIDATES, DEV_SEED, TEST_SEEDS, judge, runSeed };
