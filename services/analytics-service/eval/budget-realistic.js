#!/usr/bin/env node
/**
 * SmartBook's budgeted purchasing vs how a library spends a limited budget WITHOUT it.
 *
 * Earlier studies (eval/reorder-optimization.js) compared SmartBook with its own previous
 * funding order, and with REORDER_POINT / MA30 funded in catalogue order - an internal
 * engineering question. This study asks the thesis question: under the same budget, how
 * much better is SmartBook than realistic library practice?
 *
 * PRE-REGISTERED PROTOCOL (fixed in this file before any seed below was run):
 *   - SmartBook = production's budget mode: IP_RETURNS+FLOOR+MARGINAL.
 *   - Baselines (eval/budget-baselines.js): quantity rule {REORDER_POINT, MA30_FIXED_LT}
 *     x funding rule {POPULAR_FIRST, HOLDS_FIRST, CATEGORY_SHARE, ONE_EACH} = 8 baselines.
 *   - SYNTHETIC: fresh seeds 20261301-08 (never generated before, not used to build or
 *     select SmartBook), scenarios BASE / SUPPLIER_DELAY / LEAN_START.
 *   - REAL: Mendeley 10.17632/6rd45bvxjy.1 loans (public library system, university
 *     library). Loans are served demand only (censored by the copies the library had), so
 *     starting with the real collection is trivial; scenarios start from fewer copies:
 *     REAL_HALF = max(1, floor(copies / 2)), REAL_SINGLE = 1 copy per title. No prices in
 *     the data: every copy costs UNIT_COST_REAL (a constant, so per-VND = per-copy).
 *     Loans with no return date get the median loan length. 14-day delivery.
 *     AMENDMENT (before any public-library run; one univ REAL_SINGLE x1 run had been seen
 *     while timing, nothing was changed after it): the public file is restricted to titles
 *     with >= 10 loans over the window (12,079 of 54,564 titles, 66.3% of loans) because
 *     the full catalogue does not run in reasonable time. The university file is complete.
 *   - Budget per review = reference x multiplier; reference = the cheaper of REORDER_POINT
 *     and MA30_FIXED_LT unconstrained cost / reviews (the rule of the earlier study).
 *     Multipliers: synthetic 0.5, 0.75, 1, 1.25, 1.5; real 0.5, 1, 1.5.
 *   - Comparator = the BEST baseline: per scenario x multiplier, the baseline with the
 *     highest mean fill rate (synthetic: over the 8 seeds) - chosen with hindsight, which
 *     favours the baselines.
 *   - Primary claim (synthetic, multiplier 1): SmartBook's fill rate is higher than the
 *     best baseline's on EVERY seed x scenario. Reported whether it holds or not, with
 *     paired differences (mean, 95% t-interval) in fill rate, unmet demand and stockout days.
 *   - Everything else (other multipliers, real data, budget needed for 95%) is descriptive.
 *
 * USAGE (from services/analytics-service):
 *   node eval/budget-realistic.js [--synthetic-only] [--real-only]
 * OUTPUT: thesis/data/budget_realistic_results.json,
 *         docs/ANALYSIS/BUDGET_REALISTIC_BASELINES.md (generated section between markers)
 */

const fs = require('fs');
const path = require('path');
const { buildDemandWorld } = require('./synthetic-world');
const { runInventoryBacktest } = require('./inventory-simulator');
const { reorderPointPolicy, ma30FixedLeadTimePolicy, smartbookPolicy, marginalAllocation } = require('./reorder-policies');
const { WARM_UP_DAYS, REVIEW_PERIOD_DAYS, STEADY_STATE_OFFSET_DAYS, scenarios } = require('./reorder-policy-backtest');
const { FUNDING_RULES, withFundingSignals, fundingAllocation } = require('./budget-baselines');
const { DEFAULT_LEAD_TIME_DAYS } = require('../src/utils/lead-time');

const ROOT = path.resolve(__dirname, '../../..');
const SEEDS = [20261301, 20261302, 20261303, 20261304, 20261305, 20261306, 20261307, 20261308];
const SCENARIOS = ['BASE', 'SUPPLIER_DELAY', 'LEAN_START'];
const MULTIPLIERS = [0.5, 0.75, 1, 1.25, 1.5];
const REAL_MULTIPLIERS = [0.5, 1, 1.5];
const REAL_SCENARIOS = ['REAL_HALF', 'REAL_SINGLE'];
const UNIT_COST_REAL = 100000;
const DAY_MS = 24 * 60 * 60 * 1000;
// minLoans: titles borrowed fewer times over the whole window are left out (runtime only).
const REAL_FILES = {
  public: { file: 'research-inputs/library-loans-mendeley/derived/public_events.json', minLoans: 10 },
  univ: { file: 'research-inputs/library-loans-mendeley/derived/univ_events.json', minLoans: 1 },
};
const SMARTBOOK = 'SMARTBOOK';
const QUANTITY_RULES = { REORDER_POINT: reorderPointPolicy, MA30_FIXED_LT: ma30FixedLeadTimePolicy };
const BASELINES = Object.keys(QUANTITY_RULES).flatMap((q) => FUNDING_RULES.map((f) => `${q}/${f}`));

function pick(m) {
  return { fill_rate: m.fill_rate, unmet_demand: m.unmet_demand, total_demand: m.total_demand, stockout_days: m.stockout_days,
    procurement_cost: m.procurement_cost, ordered_units: m.ordered_units, average_inventory: m.average_inventory };
}

// One world x scenario: unconstrained baselines fix the reference budget, then every
// policy runs at every multiplier.
// extra: [{ name, make({ reservationsByVariant, wishlistsByBook, categoryOf }) -> [policy, allocate] }] run beside SmartBook.
function runWorld({ variants, firstDay, endDay, leadTimeDays, reservationsByVariant, wishlistsByBook, categoryOf, multipliers, tag, extra = [] }) {
  const evalStartDay = firstDay + WARM_UP_DAYS;
  const run = (policy, budgetPerReview = null, allocate = null) => runInventoryBacktest({
    variants, firstDay, evalStartDay, endDay, reviewPeriodDays: REVIEW_PERIOD_DAYS, policy, leadTimeDays,
    steadyStartDay: evalStartDay + STEADY_STATE_OFFSET_DAYS, budgetPerReview, allocate,
  });
  const rp = run(reorderPointPolicy());
  const ma = run(ma30FixedLeadTimePolicy());
  const reviews = rp.decisionStats.reviews;
  const reference = Math.min(rp.metrics.procurement_cost, ma.metrics.procurement_cost) / reviews;
  const rows = [];
  for (const multiplier of multipliers) {
    const budget = reference * multiplier;
    const add = (policy, result) => rows.push({ ...tag, multiplier, policy, budget_per_review_vnd: budget, ...pick(result.metrics) });
    add(SMARTBOOK, run(smartbookPolicy({ reservationsByVariant, wishlistsByBook, name: SMARTBOOK, expectedReturns: true, priorityFloors: 'IF_SHORTFALL' }), budget, marginalAllocation));
    for (const name of BASELINES) {
      const [q, f] = name.split('/');
      add(name, run(withFundingSignals(QUANTITY_RULES[q](), { reservationsByVariant, categoryOf }), budget, fundingAllocation(f)));
    }
    for (const { name, make } of extra) {
      const [policy, allocate] = make({ reservationsByVariant, wishlistsByBook, categoryOf });
      add(name, run(policy, budget, allocate));
    }
  }
  return rows;
}

function syntheticRows(seeds = SEEDS, extra = []) {
  const rows = [];
  for (const seed of seeds) {
    const world = buildDemandWorld({ seed });
    const reservationsByVariant = new Map(world.variants.map((v) => [v.variantId, v.reservations]));
    const categoryOf = new Map(world.variants.map((v) => [v.variantId, v.category]));
    for (const scenario of scenarios(seed)) {
      rows.push(...runWorld({
        variants: world.variants.map((v) => ({ ...v, initialCopies: scenario.initialCopies(v) })),
        firstDay: world.firstDay, endDay: world.endDay, leadTimeDays: scenario.leadTimeDays,
        reservationsByVariant, wishlistsByBook: world.wishlistsByBook, categoryOf: (v) => categoryOf.get(v.variantId),
        multipliers: MULTIPLIERS, tag: { data: 'synthetic', seed, scenario: scenario.id }, extra,
      }));
    }
    console.log('synthetic seed done', seed);
  }
  return rows;
}

// Real loans -> one variant per title (copies = distinct copies ever borrowed).
function realWorld(file, minLoans = 1) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const dayOf = (iso) => Math.floor(Date.parse(iso) / DAY_MS);
  const loans = data.events.filter((e) => e.kind === 'LOAN');
  const lengths = loans.filter((e) => e.until).map((e) => Math.max(1, dayOf(e.until) - dayOf(e.at))).sort((a, b) => a - b);
  const medianDays = lengths[Math.floor(lengths.length / 2)] || DEFAULT_LEAD_TIME_DAYS;
  const byTitle = new Map(data.catalog.map((b) => [b.id, { variantId: b.id, bookId: b.id, title: b.id, category: b.category,
    unitCost: UNIT_COST_REAL, copies: b.variant_ids.length, requests: [] }]));
  for (const e of loans) {
    const at = Date.parse(e.at);
    byTitle.get(e.book_id).requests.push({ at, returnAt: e.until ? Date.parse(e.until) : at + medianDays * DAY_MS });
  }
  const variants = [...byTitle.values()].filter((v) => v.requests.length >= minLoans).map((v) => ({ ...v, requests: v.requests.sort((a, b) => a.at - b.at) }));
  const keptLoans = variants.reduce((a, v) => a + v.requests.length, 0);
  return { variants, keptLoans, minLoans, firstDay: dayOf(data.window_start), endDay: dayOf(data.window_end) + 1, medianDays, loans: loans.length,
    missingReturns: loans.length - lengths.length, source: data.real_source };
}

function realRows(extra = [], files = REAL_FILES, scenarioIds = REAL_SCENARIOS) {
  const rows = [];
  const meta = {};
  for (const [label, { file, minLoans }] of Object.entries(files)) {
    if (!fs.existsSync(path.join(ROOT, file))) { console.log('missing', file); continue; }
    const world = realWorld(file, minLoans);
    meta[label] = { titles: world.variants.length, loans: world.loans, kept_loans: world.keptLoans, min_loans: world.minLoans, missing_returns: world.missingReturns,
      imputed_loan_days: world.medianDays, days: world.endDay - world.firstDay, doi: world.source?.doi, library: world.source?.library };
    const initial = { REAL_HALF: (v) => Math.max(1, Math.floor(v.copies / 2)), REAL_SINGLE: () => 1 };
    const categoryOf = new Map(world.variants.map((v) => [v.variantId, v.category]));
    for (const scenario of scenarioIds) {
      const started = Date.now();
      rows.push(...runWorld({
        variants: world.variants.map((v) => ({ ...v, initialCopies: initial[scenario](v) })),
        firstDay: world.firstDay, endDay: world.endDay, leadTimeDays: () => DEFAULT_LEAD_TIME_DAYS,
        reservationsByVariant: new Map(), wishlistsByBook: new Map(), categoryOf: (v) => categoryOf.get(v.variantId),
        multipliers: REAL_MULTIPLIERS, tag: { data: label, seed: null, scenario }, extra,
      }));
      console.log('real done', label, scenario, `${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
  }
  return { rows, meta };
}

function tInterval(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, low: null, high: null };
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const t = { 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 6: 2.571, 7: 2.447, 8: 2.365, 9: 2.306, 10: 2.262 }[n] || 1.96;
  return { mean, low: mean - t * sd / Math.sqrt(n), high: mean + t * sd / Math.sqrt(n) };
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Per data x scenario x multiplier: mean of every policy, the best baseline, SmartBook vs it.
function summarize(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.data}|${r.scenario}|${r.multiplier}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].map((rs) => {
    const { data, scenario, multiplier } = rs[0];
    const byPolicy = (p) => rs.filter((r) => r.policy === p);
    const means = Object.fromEntries([SMARTBOOK, ...BASELINES].map((p) => {
      const pr = byPolicy(p);
      return [p, { fill_rate: mean(pr.map((r) => r.fill_rate)), unmet_demand: mean(pr.map((r) => r.unmet_demand)),
        stockout_days: mean(pr.map((r) => r.stockout_days)), procurement_cost: mean(pr.map((r) => r.procurement_cost)),
        total_demand: mean(pr.map((r) => r.total_demand)), budget_per_review_vnd: mean(pr.map((r) => r.budget_per_review_vnd)) }];
    }));
    const best = BASELINES.reduce((a, b) => (means[b].fill_rate > means[a].fill_rate ? b : a));
    const runs = byPolicy(SMARTBOOK).map((s) => ({ s, b: rs.find((r) => r.policy === best && r.seed === s.seed) }));
    const everyBaseline = byPolicy(SMARTBOOK).filter((s) => BASELINES.every((p) => s.fill_rate > rs.find((r) => r.policy === p && r.seed === s.seed).fill_rate)).length;
    return {
      data, scenario, multiplier, means, best_baseline: best, runs: runs.length,
      wins_vs_best: runs.filter(({ s, b }) => s.fill_rate > b.fill_rate).length,
      wins_vs_every_baseline: everyBaseline,
      diff_fill_pp: tInterval(runs.map(({ s, b }) => (s.fill_rate - b.fill_rate) * 100)),
      diff_unmet: tInterval(runs.map(({ s, b }) => s.unmet_demand - b.unmet_demand)),
      unmet_reduction_pct: tInterval(runs.map(({ s, b }) => (b.unmet_demand > 0 ? (1 - s.unmet_demand / b.unmet_demand) * 100 : 0))),
      diff_stockout_days: tInterval(runs.map(({ s, b }) => s.stockout_days - b.stockout_days)),
      cost_ratio_pct: tInterval(runs.map(({ s, b }) => (b.procurement_cost > 0 ? s.procurement_cost / b.procurement_cost * 100 : 100))),
    };
  });
}

// Budget (x reference) at which a policy's mean fill rate first reaches the target,
// linear between sweep points; null when not reached inside the sweep.
function budgetToReach(summary, data, scenario, policy, target) {
  const pts = summary.filter((s) => s.data === data && s.scenario === scenario).sort((a, b) => a.multiplier - b.multiplier)
    .map((s) => [s.multiplier, s.means[policy].fill_rate, s.means[policy].budget_per_review_vnd]);
  for (let i = 0; i < pts.length; i += 1) {
    if (pts[i][1] >= target) {
      if (i === 0) return { multiplier: pts[0][0], budget_per_review_vnd: pts[0][2], at_or_below_lowest: true };
      const [m0, f0, b0] = pts[i - 1];
      const [m1, f1, b1] = pts[i];
      const k = (target - f0) / (f1 - f0);
      return { multiplier: m0 + k * (m1 - m0), budget_per_review_vnd: b0 + k * (b1 - b0) };
    }
  }
  return null;
}

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const fmtCi = (c, d = 2) => (c.low === null ? c.mean.toFixed(d) : `${c.mean.toFixed(d)} [${c.low.toFixed(d)}; ${c.high.toFixed(d)}]`);
const label = { BASE: 'Bình thường', SUPPLIER_DELAY: 'Giao chậm 14–28 ngày', LEAN_START: 'Tồn đầu bằng một nửa', REAL_HALF: 'Một nửa số bản thật', REAL_SINGLE: '1 bản mỗi đầu sách' };

function render(result) {
  const s = result.summary;
  const primary = s.filter((x) => x.data === 'synthetic' && x.multiplier === 1);
  const table = (rows) => ['| Dữ liệu | Kịch bản | Ngân sách (× mốc) | SmartBook | Mốc tốt nhất | Mốc tốt nhất: fill | Δ fill (điểm %) | Giảm lượt không phục vụ (%) | Δ ngày hết sách | Chi phí SB / mốc (%) | Thắng mốc tốt nhất | Thắng cả 8 mốc |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((x) => `| ${x.data} | ${label[x.scenario] || x.scenario} | ${x.multiplier} | ${pct(x.means[SMARTBOOK].fill_rate)} | ${x.best_baseline} | ${pct(x.means[x.best_baseline].fill_rate)} | ${fmtCi(x.diff_fill_pp)} | ${fmtCi(x.unmet_reduction_pct, 1)} | ${fmtCi(x.diff_stockout_days, 1)} | ${fmtCi(x.cost_ratio_pct, 1)} | ${x.wins_vs_best}/${x.runs} | ${x.wins_vs_every_baseline}/${x.runs} |`)].join('\n');
  const allPolicies = (rows) => ['| Dữ liệu | Kịch bản | Ngân sách (× mốc) | ' + [SMARTBOOK, ...BASELINES].join(' | ') + ' |',
    `| --- | --- | --- | ${[SMARTBOOK, ...BASELINES].map(() => '---').join(' | ')} |`,
    ...rows.map((x) => `| ${x.data} | ${label[x.scenario] || x.scenario} | ${x.multiplier} | ${[SMARTBOOK, ...BASELINES].map((p) => pct(x.means[p].fill_rate)).join(' | ')} |`)].join('\n');
  const reach = result.budget_to_95.map((r) => `| ${r.data} | ${label[r.scenario] || r.scenario} | ${r.smartbook ? r.smartbook.multiplier.toFixed(2) : 'chưa đạt trong khoảng quét'} | ${r.best ? `${r.best.multiplier.toFixed(2)} (${r.best_policy})` : 'chưa đạt trong khoảng quét'} |`);
  const meta = Object.entries(result.real_meta).map(([k, m]) => `| ${k} | ${m.library} | ${m.titles} (≥ ${m.min_loans} lượt) | ${m.kept_loans} / ${m.loans} | ${m.days} | ${m.missing_returns} (gán ${m.imputed_loan_days} ngày) |`);
  const claim = result.primary_claim;
  return `<!-- AUTO:budget-realistic:start -->
> Sinh bởi \`services/analytics-service/eval/budget-realistic.js\` — không sửa tay phần này. Giao thức cố định ở đầu script trước khi chạy.
> Dữ liệu \`synthetic\` là **dữ liệu TỔNG HỢP**; \`public\` và \`univ\` là **lượt mượn THẬT** (Mendeley 10.17632/6rd45bvxjy.1, CC BY 4.0),
> nhưng chỉ có lượt mượn đã phục vụ nên số bản ban đầu và đơn giá (${UNIT_COST_REAL.toLocaleString('vi-VN')} đ/bản) là giả định.

**Kết luận chính (dữ liệu tổng hợp, ngân sách × 1, ${SEEDS.length} seed mới × 3 kịch bản):** SmartBook có fill rate cao hơn mốc tốt nhất ở
**${claim.wins}/${claim.runs}** lần chạy → giả thuyết ${claim.holds ? '**ĐƯỢC XÁC NHẬN**' : '**KHÔNG được xác nhận**'}.

### Kết quả chính — ngân sách × 1
${table(primary)}

### Quét mức ngân sách và dữ liệu thật
${table(s.filter((x) => !(x.data === 'synthetic' && x.multiplier === 1)))}

### Ngân sách cần để đạt fill rate 95% (× mốc ngân sách, nội suy tuyến tính)
| Dữ liệu | Kịch bản | SmartBook | Mốc tốt nhất ở mức đó |
| --- | --- | --- | --- |
${reach.join('\n')}

### Fill rate trung bình của mọi chính sách
${allPolicies(s)}

### Dữ liệu thật đã dùng
| Nhãn | Thư viện | Đầu sách dùng | Lượt mượn dùng / tổng | Số ngày | Thiếu ngày trả |
| --- | --- | --- | --- | --- | --- |
${meta.join('\n')}
<!-- AUTO:budget-realistic:end -->`;
}

function main(argv = process.argv.slice(2)) {
  const rows = [];
  let realMeta = {};
  // a partial run keeps the other half of the previous results file
  const out = path.join(ROOT, 'thesis/data/budget_realistic_results.json');
  const previous = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { rows: [], real_meta: {} };
  if (argv.includes('--real-only') || argv.includes('--real-from')) rows.push(...previous.rows.filter((r) => r.data === 'synthetic'));
  if (argv.includes('--synthetic-only')) {
    rows.push(...previous.rows.filter((r) => r.data !== 'synthetic'));
    realMeta = previous.real_meta;
  }
  if (argv.includes('--real-from')) {
    // rows already simulated by eval/budget-improvement.js --real (same worlds, same policies)
    for (const file of argv.slice(argv.indexOf('--real-from') + 1)) {
      const part = JSON.parse(fs.readFileSync(file, 'utf8'));
      rows.push(...part.rows.filter((r) => r.policy === SMARTBOOK || BASELINES.includes(r.policy)));
      Object.assign(realMeta, part.meta);
    }
  } else if (!argv.includes('--real-only')) rows.push(...syntheticRows());
  if (!argv.includes('--synthetic-only') && !argv.includes('--real-from')) {
    const real = realRows();
    rows.push(...real.rows);
    realMeta = real.meta;
  }
  const summary = summarize(rows);
  const primary = summary.filter((x) => x.data === 'synthetic' && x.multiplier === 1);
  const wins = primary.reduce((a, x) => a + x.wins_vs_best, 0);
  const runs = primary.reduce((a, x) => a + x.runs, 0);
  const pairs = [...new Set(summary.map((x) => `${x.data}|${x.scenario}`))].map((k) => k.split('|'));
  const budgetTo95 = pairs.map(([data, scenario]) => {
    const reached = BASELINES.map((p) => ({ p, r: budgetToReach(summary, data, scenario, p, 0.95) })).filter((x) => x.r)
      .sort((a, b) => a.r.multiplier - b.r.multiplier);
    return { data, scenario, smartbook: budgetToReach(summary, data, scenario, SMARTBOOK, 0.95), best: reached[0]?.r || null, best_policy: reached[0]?.p || null };
  });
  const result = {
    protocol: { seeds: SEEDS, scenarios: SCENARIOS, multipliers: MULTIPLIERS, real_scenarios: REAL_SCENARIOS, real_multipliers: REAL_MULTIPLIERS,
      unit_cost_real_vnd: UNIT_COST_REAL, smartbook: 'IP_RETURNS+FLOOR+MARGINAL', baselines: BASELINES },
    primary_claim: { wins, runs, holds: runs > 0 && wins === runs },
    summary, budget_to_95: budgetTo95, real_meta: realMeta, rows,
  };
  fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  const doc = path.join(ROOT, 'docs/ANALYSIS/BUDGET_REALISTIC_BASELINES.md');
  const existing = fs.existsSync(doc) ? fs.readFileSync(doc, 'utf8') : '';
  const marker = /<!-- AUTO:budget-realistic:start -->[\s\S]*<!-- AUTO:budget-realistic:end -->/;
  const generated = render(result);
  fs.writeFileSync(doc, marker.test(existing) ? existing.replace(marker, generated) : `${existing}\n${generated}\n`);
  return result;
}

if (require.main === module) {
  const r = main();
  console.log('primary claim', r.primary_claim);
}

module.exports = { BASELINES, SEEDS, SMARTBOOK, REAL_FILES, tInterval, syntheticRows, realRows, runWorld, summarize, budgetToReach, realWorld, main };
