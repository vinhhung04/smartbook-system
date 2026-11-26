#!/usr/bin/env node
/**
 * Improved SmartBook budget mode, after eval/budget-realistic.js found that a simple rule
 * (REORDER_POINT min/max + ONE_EACH: one more copy per title per round) beats production's
 * IP_RETURNS+FLOOR+MARGINAL under the same budget (0/24 at budget x1, synthetic seeds 20261301-08).
 *
 * Mechanisms behind the candidates (from that study, before any test seed below was run):
 *   (a) production's priority minimums (HIGH >= 5, MEDIUM >= 3) and safety stock buy copies
 *       the shelf does not need: production spent ~13% more for a lower fill rate;
 *   (b) MARGINAL values the next copy by P(lead-time demand > position + k), but a copy bought
 *       now must cover demand until the NEXT order can arrive: lead time + review period;
 *   (c) ONE_EACH spreads money over many titles one copy at a time.
 *
 * CANDIDATES
 *   SB_SPREAD             production quantities (IP_RETURNS+FLOOR), ONE_EACH funding
 *   SB_NOFLOOR            IP_RETURNS, no priority minimums, MARGINAL funding
 *   SB_PROTECT            IP_RETURNS+FLOOR, MARGINAL over lead time + review period
 *   SB_NOFLOOR_PROTECT    (a) + (b)
 *   SB_NOFLOOR_SPREAD     (a) + (c)
 *
 * PRE-REGISTERED PROTOCOL
 *   - Development seeds 20261301-08 (already seen in budget-realistic.js): candidates may be
 *     inspected and changed. Selection rule: the candidate with the highest fill rate averaged
 *     over dev seeds x 3 scenarios at budget x1.
 *   - Test seeds 20261401-08: generated for the first time here, run ONCE with the selected
 *     candidate frozen. Comparator = best of the 8 realistic baselines (chosen with hindsight)
 *     AND current production.
 *   - Claim: the selected candidate's fill rate is higher than the best baseline's on EVERY
 *     test seed x scenario at budget x1. Reported whether it holds or not; other multipliers
 *     and the real-library runs are descriptive.
 *
 * USAGE (from services/analytics-service):
 *   node eval/budget-improvement.js --dev          development seeds, all candidates, console only
 *   node eval/budget-improvement.js --test <NAME>  test seeds with the frozen candidate -> files
 *   node eval/budget-improvement.js --real <NAME> --part <public|univ>:<REAL_HALF|REAL_SINGLE>   one real run
 *   node eval/budget-improvement.js --real <NAME> --merge <part files...>   real section of the report
 */

const fs = require('fs');
const path = require('path');
const { smartbookPolicy, marginalAllocation } = require('./reorder-policies');
const { protectionDemand, REVIEW_PERIOD_DAYS } = require('../src/utils/budget-allocation');
const { withFundingSignals, fundingAllocation } = require('./budget-baselines');
const { BASELINES, SMARTBOOK, REAL_FILES, tInterval, syntheticRows, realRows } = require('./budget-realistic');

const ROOT = path.resolve(__dirname, '../../..');
const DEV_SEEDS = [20261301, 20261302, 20261303, 20261304, 20261305, 20261306, 20261307, 20261308];
const TEST_SEEDS = [20261401, 20261402, 20261403, 20261404, 20261405, 20261406, 20261407, 20261408];
const OUT = path.join(ROOT, 'thesis/data/budget_improvement_results.json');
const DOC = path.join(ROOT, 'docs/ANALYSIS/BUDGET_REALISTIC_BASELINES.md');
const partFile = (label, scenario) => path.join(ROOT, `thesis/data/budget_improvement_real_${label}_${scenario}.json`);

// MARGINAL with demand over lead time + review period (the protection interval of a periodic review).
function protectedMarginal(decisions, budget) {
  return marginalAllocation(decisions.map((d) => {
    const c = d.candidate || {};
    // production's formula, so the backtest and GET /analytics/reorder-suggestions?budget= agree
    const lambda = protectionDemand(c.avg_daily_demand, c.lead_time_days);
    return { ...d, candidate: { ...c, lead_time_demand: lambda, lead_time_days: Number(c.lead_time_days || 0) + REVIEW_PERIOD_DAYS } };
  }), budget);
}

const sb = (ctx, opts) => smartbookPolicy({ reservationsByVariant: ctx.reservationsByVariant, wishlistsByBook: ctx.wishlistsByBook, name: 'candidate', expectedReturns: true, ...opts });
const CANDIDATES = {
  SB_SPREAD: (ctx) => [withFundingSignals(sb(ctx, { priorityFloors: 'IF_SHORTFALL' }), ctx), fundingAllocation('ONE_EACH')],
  SB_NOFLOOR: (ctx) => [sb(ctx, { priorityFloors: false }), marginalAllocation],
  SB_PROTECT: (ctx) => [sb(ctx, { priorityFloors: 'IF_SHORTFALL' }), protectedMarginal],
  SB_NOFLOOR_PROTECT: (ctx) => [sb(ctx, { priorityFloors: false }), protectedMarginal],
  SB_NOFLOOR_SPREAD: (ctx) => [withFundingSignals(sb(ctx, { priorityFloors: false }), ctx), fundingAllocation('ONE_EACH')],
};
const extraFor = (names) => names.map((name) => ({ name, make: CANDIDATES[name] }));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function compare(rows, candidate) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.data}|${r.scenario}|${r.multiplier}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].map((rs) => {
    const { data, scenario, multiplier } = rs[0];
    const fill = (p) => mean(rs.filter((r) => r.policy === p).map((r) => r.fill_rate));
    const best = BASELINES.reduce((a, b) => (fill(b) > fill(a) ? b : a));
    const pairs = (other) => rs.filter((r) => r.policy === candidate).map((c) => [c, rs.find((r) => r.policy === other && r.seed === c.seed)]);
    const vs = (other) => {
      const ps = pairs(other);
      return {
        wins: ps.filter(([c, o]) => c.fill_rate > o.fill_rate).length, runs: ps.length,
        fill_pp: tInterval(ps.map(([c, o]) => (c.fill_rate - o.fill_rate) * 100)),
        unmet_reduction_pct: tInterval(ps.map(([c, o]) => (o.unmet_demand > 0 ? (1 - c.unmet_demand / o.unmet_demand) * 100 : 0))),
        stockout_days: tInterval(ps.map(([c, o]) => c.stockout_days - o.stockout_days)),
        cost_ratio_pct: tInterval(ps.map(([c, o]) => (o.procurement_cost > 0 ? c.procurement_cost / o.procurement_cost * 100 : 100))),
      };
    };
    return { data, scenario, multiplier, best_baseline: best,
      fill: { candidate: fill(candidate), production: fill(SMARTBOOK), best: fill(best) },
      vs_best: vs(best), vs_production: vs(SMARTBOOK) };
  });
}

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const ci = (c, d = 2) => (c.low === null ? c.mean.toFixed(d) : `${c.mean.toFixed(d)} [${c.low.toFixed(d)}; ${c.high.toFixed(d)}]`);
const label = { BASE: 'Bình thường', SUPPLIER_DELAY: 'Giao chậm 14–28 ngày', LEAN_START: 'Tồn đầu bằng một nửa', REAL_HALF: 'Một nửa số bản thật', REAL_SINGLE: '1 bản mỗi đầu sách' };

function render(result) {
  const lines = (cmp) => cmp.map((x) => `| ${x.data} | ${label[x.scenario] || x.scenario} | ${x.multiplier} | ${pct(x.fill.candidate)} | ${pct(x.fill.production)} | ${x.best_baseline} ${pct(x.fill.best)} | ${ci(x.vs_best.fill_pp)} | ${ci(x.vs_best.unmet_reduction_pct, 1)} | ${ci(x.vs_best.stockout_days, 1)} | ${ci(x.vs_best.cost_ratio_pct, 1)} | ${x.vs_best.wins}/${x.vs_best.runs} | ${ci(x.vs_production.fill_pp)} | ${x.vs_production.wins}/${x.vs_production.runs} |`).join('\n');
  const head = '| Dữ liệu | Kịch bản | Ngân sách (× mốc) | Bản cải tiến | Production hiện tại | Mốc tốt nhất | Δ fill vs mốc (điểm %) | Giảm lượt không phục vụ vs mốc (%) | Δ ngày hết sách vs mốc | Chi phí / mốc (%) | Thắng mốc | Δ fill vs production | Thắng production |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const dev = result.dev.map((d) => `| ${d.name} | ${pct(d.mean_fill)} |`).join('\n');
  const c = result.claim;
  const test = result.test || [];
  const real = result.real || [];
  return `<!-- AUTO:budget-improvement:start -->
> Sinh bởi \`services/analytics-service/eval/budget-improvement.js\` — không sửa tay phần này. Giao thức cố định ở đầu script.

### Chọn ứng viên trên seed phát triển (20261301–08, ngân sách × 1, trung bình 3 kịch bản)
| Ứng viên | Fill rate TB |
| --- | --- |
${dev}

Ứng viên được chọn và đóng băng: **${result.selected}**.

**Kiểm định trên 8 seed mới (20261401–08), ngân sách × 1:** ${result.selected} có fill rate cao hơn mốc tốt nhất ở **${c ? `${c.wins}/${c.runs}` : 'chưa chạy'}**
lần chạy → giả thuyết ${c ? (c.holds ? '**ĐƯỢC XÁC NHẬN**' : '**KHÔNG được xác nhận**') : 'chưa kiểm định'}.

### Seed kiểm định
${head}
${lines(test)}

### Dữ liệu thư viện thật (mô tả, một lần chạy mỗi ô, không có khoảng tin cậy)
${head}
${lines(real)}
<!-- AUTO:budget-improvement:end -->`;
}

function save(result) {
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  const existing = fs.readFileSync(DOC, 'utf8');
  const marker = /<!-- AUTO:budget-improvement:start -->[\s\S]*<!-- AUTO:budget-improvement:end -->/;
  const generated = render(result);
  fs.writeFileSync(DOC, marker.test(existing) ? existing.replace(marker, generated) : `${existing}\n${generated}\n`);
}

function main(argv = process.argv.slice(2)) {
  const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  if (argv.includes('--dev')) {
    const rows = syntheticRows(DEV_SEEDS, extraFor(Object.keys(CANDIDATES)));
    const at1 = rows.filter((r) => r.multiplier === 1);
    const dev = [SMARTBOOK, 'REORDER_POINT/ONE_EACH', ...Object.keys(CANDIDATES)].map((name) => ({ name, mean_fill: mean(at1.filter((r) => r.policy === name).map((r) => r.fill_rate)) }));
    for (const d of dev) console.log(d.name.padEnd(26), pct(d.mean_fill));
    for (const name of Object.keys(CANDIDATES)) {
      for (const x of compare(rows, name)) console.log(name.padEnd(20), x.scenario.padEnd(15), x.multiplier, 'vs best', x.vs_best.wins, ci(x.vs_best.fill_pp), 'vs prod', ci(x.vs_production.fill_pp));
    }
    const selected = dev.filter((d) => CANDIDATES[d.name]).sort((a, b) => b.mean_fill - a.mean_fill)[0].name;
    console.log('selected', selected);
    save({ ...previous, dev, selected, dev_rows: rows });
    return;
  }
  const name = argv[argv.indexOf(argv.includes('--test') ? '--test' : '--real') + 1];
  if (!CANDIDATES[name] || name !== previous.selected) throw new Error(`run --dev first; frozen candidate is ${previous.selected}`);
  if (argv.includes('--test')) {
    const rows = syntheticRows(TEST_SEEDS, extraFor([name]));
    const test = compare(rows, name);
    const at1 = test.filter((x) => x.multiplier === 1);
    const claim = { wins: at1.reduce((a, x) => a + x.vs_best.wins, 0), runs: at1.reduce((a, x) => a + x.vs_best.runs, 0) };
    claim.holds = claim.runs > 0 && claim.wins === claim.runs;
    save({ ...previous, test, claim, test_rows: rows });
    console.log('claim', claim);
  } else if (argv.includes('--part')) {
    // one library x scenario per process so the slow real runs go in parallel
    const [label, scenario] = argv[argv.indexOf('--part') + 1].split(':');
    const { rows, meta } = realRows(extraFor([name]), { [label]: REAL_FILES[label] }, [scenario]);
    fs.writeFileSync(partFile(label, scenario), `${JSON.stringify({ rows, meta })}
`);
  } else {
    const parts = argv.slice(argv.indexOf('--merge') + 1).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
    const rows = parts.flatMap((p) => p.rows);
    save({ ...previous, real: compare(rows, name), real_rows: rows });
  }
}

if (require.main === module) main();

module.exports = { CANDIDATES, protectedMarginal, compare, DEV_SEEDS, TEST_SEEDS };
