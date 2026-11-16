#!/usr/bin/env node
/**
 * Can production order fewer copies for HIGH-priority titles without losing what the ranking
 * finds? Two changes proposed after eval/real-copies.js (HIGH titles got ~5.4-5.6 copies while
 * their shelf was empty on only 4.8-27.5% of later days) are measured here; production code is
 * NOT changed by this script.
 *
 *   RETURNS_PRIORITY  priority judged on shelf + expected returns (fractions kept), whole
 *                     expected returns in the quantity, minimums only on a shortfall
 *   FLOOR_BY_BORROWS  priority unchanged; minimum = min(5 | 3, borrows + reservations in the window)
 *
 * against CURRENT (production default), IF_SHORTFALL and NO_FLOORS (existing options).
 *
 * Real loans (same 12 monthly reviews as real-copies.js) show what each variant orders and where,
 * but not demand the shelf could not serve. The synthetic simulator records that, so
 * --synthetic judges FLOOR_BY_BORROWS / NO_FLOORS with the pre-registered rule of
 * eval/reorder-optimization.js on its test seeds - POST-HOC, those seeds were already used.
 *
 * USAGE (from services/analytics-service):
 *   node --max-old-space-size=4096 eval/reorder-quantity-variants.js <univ_events.json> <public_events.json>
 *   node eval/reorder-quantity-variants.js --synthetic
 * OUTPUT: thesis/data/reorder_quantity_variants_real.json, thesis/tables/reorder_quantity_variants_real.csv
 *         (--synthetic: thesis/data/reorder_quantity_variants_synthetic.json)
 */

const fs = require('fs');
const reorder = require('../src/utils/reorder-suggestion');
const { loanSurvival, expectedReturns } = require('../src/utils/expected-returns');
const { DEFAULT_LEAD_TIME_DAYS } = require('../src/utils/lead-time');
const { occupancy } = require('./real-copies');
const { writeJson, writeCsv } = require('./run-all');

const { calculateSuggestion, compareReorderCandidates, resolvePriority } = reorder;
const WINDOW_DAYS = 30;
const OUTCOME_DAYS = 30;
const REVIEWS = 12;
const TOP_K = 50;
const SHORTAGE_SHARE = 0.5;
const YEAR_DAYS = 365;
const FLOORS = { HIGH: 5, MEDIUM: 3, LOW: 0 };

const countIn = (sorted, from, to) => sorted.filter((d) => d >= from && d < to).length;
const emptyDays = (t, from, to) => {
  let n = 0;
  for (let d = from; d < to; d += 1) if (t.out[d] >= t.copies) n += 1;
  return n;
};

// `calc` is calculateSuggestion (passed in so the synthetic run can route through its own copy)
function floorByBorrows(calc, row, demand, ranges, seasonal, series, leadTime, options = {}) {
  const base = calc(row, demand, ranges, seasonal, series, leadTime, { ...options, priorityFloors: false });
  const qty = Math.max(base.suggested_reorder_qty, Math.min(FLOORS[base.priority], demand.borrowCount + demand.reservationCount));
  return { ...base, suggested_reorder_qty: qty, estimated_cost: qty * Number(row.unit_cost || 0) };
}

function returnsPriority(row, demand, ranges, seasonal, series, returns) {
  const base = calculateSuggestion(row, demand, ranges, seasonal, series, null, { expectedReturns: returns, priorityFloors: false });
  const position = base.available_qty + returns;
  const priority = resolvePriority({
    availableQty: position, borrowCount: demand.borrowCount, reservationCount: demand.reservationCount, forecast30d: base.forecast_30d,
    estimatedDaysUntilStockout: base.demand_pace > 0 ? position / base.demand_pace : null, leadTimeDays: ranges.leadTimeDays,
  });
  const shortfall = base.lead_time_demand > base.inventory_position || (base.inventory_position <= 0 && (demand.borrowCount > 0 || demand.reservationCount > 0));
  const qty = shortfall ? Math.max(base.suggested_reorder_qty, FLOORS[priority]) : base.suggested_reorder_qty;
  return { ...base, priority, suggested_reorder_qty: qty };
}

// production's getLoanReturnView on day r: durations of loans returned in the year before r,
// ages of loans still out (censored); nothing after r
function loanViewAt(titles, r) {
  const durations = [];
  const openAges = [];
  const openByTitle = new Map();
  for (const t of titles) {
    for (const { s, ret } of t.loans) {
      if (s >= r) continue;
      if (ret !== null && ret <= r) {
        if (ret >= r - YEAR_DAYS) durations.push(ret - s);
      } else {
        openAges.push(r - s);
        if (!openByTitle.has(t.id)) openByTitle.set(t.id, []);
        openByTitle.get(t.id).push(r - s);
      }
    }
  }
  return { survival: loanSurvival(durations, openAges), openByTitle };
}

function realVariants({ titles, days }, leadTimeDays = DEFAULT_LEAD_TIME_DAYS) {
  const ranges = { days: WINDOW_DAYS, leadTimeDays };
  const names = ['CURRENT', 'IF_SHORTFALL', 'NO_FLOORS', 'FLOOR_BY_BORROWS', 'RETURNS_PRIORITY'];
  const samples = Object.fromEntries(names.map((n) => [n, []]));
  const top = Object.fromEntries(names.map((n) => [n, []]));
  for (let k = REVIEWS - 1; k >= 0; k -= 1) {
    const r = days - leadTimeDays - OUTCOME_DAYS - k * WINDOW_DAYS;
    if (r < 2 * WINDOW_DAYS) continue;
    const view = loanViewAt(titles, r);
    const rows = Object.fromEntries(names.map((n) => [n, []]));
    for (const t of titles) {
      const borrowCount = countIn(t.borrowDays, r - WINDOW_DAYS, r);
      if (!borrowCount) continue;
      const borrowed = Math.max(0, t.out[r] - countIn(t.borrowDays, r, r + 1));
      const available = Math.max(0, t.copies - borrowed);
      const series = Array.from({ length: WINDOW_DAYS }, (_, i) => countIn(t.borrowDays, r - WINDOW_DAYS + i, r - WINDOW_DAYS + i + 1));
      const row = { book_id: t.id, variant_id: t.id, title: t.id, author: '', category: t.category, available_qty: available, on_hand_qty: available, borrowed_qty: borrowed, reorder_point: 0, unit_cost: 0 };
      const demand = { borrowCount, previousBorrowCount: countIn(t.borrowDays, r - 2 * WINDOW_DAYS, r - WINDOW_DAYS), reservationCount: 0, wishlistCount: 0, availabilityAlertCount: 0 };
      const returns = Math.min(expectedReturns(view.openByTitle.get(t.id) || [], leadTimeDays, view.survival) ?? 0, borrowed);
      const empty = emptyDays(t, r + leadTimeDays, r + leadTimeDays + OUTCOME_DAYS) / OUTCOME_DAYS;
      const items = {
        CURRENT: calculateSuggestion(row, demand, ranges, {}, series),
        IF_SHORTFALL: calculateSuggestion(row, demand, ranges, {}, series, null, { priorityFloors: 'IF_SHORTFALL' }),
        NO_FLOORS: calculateSuggestion(row, demand, ranges, {}, series, null, { priorityFloors: false }),
        FLOOR_BY_BORROWS: floorByBorrows(calculateSuggestion, row, demand, ranges, {}, series, null),
        RETURNS_PRIORITY: returnsPriority(row, demand, ranges, {}, series, returns),
      };
      for (const n of names) {
        rows[n].push({ item: items[n], empty });
        samples[n].push({ priority: items[n].priority, qty: items[n].suggested_reorder_qty, empty });
      }
    }
    for (const n of names) top[n].push(...[...rows[n]].sort((a, b) => compareReorderCandidates(a.item, b.item)).slice(0, TOP_K).map((x) => x.empty));
  }
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return names.map((variant) => {
    const s = samples[variant];
    const high = s.filter((x) => x.priority === 'HIGH');
    const shortages = s.filter((x) => x.empty >= SHORTAGE_SHARE);
    const total = s.reduce((a, x) => a + x.qty, 0);
    return {
      variant,
      samples: s.length,
      mean_suggested_qty: mean(s.map((x) => x.qty)),
      high_titles: high.length,
      high_mean_suggested_qty: mean(high.map((x) => x.qty)),
      high_share_of_later_shortages: shortages.length ? shortages.filter((x) => x.priority === 'HIGH').length / shortages.length : null,
      top50_mean_empty_shelf_share: mean(top[variant]),
      copies_to_titles_never_empty_later: total ? s.filter((x) => x.empty === 0).reduce((a, x) => a + x.qty, 0) / total : null,
      shortage_titles_given_no_copy: shortages.length ? shortages.filter((x) => x.qty === 0).length / shortages.length : null,
    };
  });
}

function synthetic() {
  // the simulator calls calculateSuggestion through eval/reorder-policies.js; FLOOR_BY_BORROWS is
  // routed to floorByBorrows for this process only: the export is patched, then the modules that
  // captured the original at load time (run-all.js already loaded them) are loaded again
  const original = reorder.calculateSuggestion;
  reorder.calculateSuggestion = (row, demand, ranges, seasonal, series, leadTime, options = {}) => (options.priorityFloors === 'BY_BORROWS'
    ? floorByBorrows(original, row, demand, ranges, seasonal, series, leadTime, options)
    : original(row, demand, ranges, seasonal, series, leadTime, options));
  for (const m of ['./reorder-policies', './reorder-policy-backtest', './reorder-optimization']) delete require.cache[require.resolve(m)];
  const opt = require('./reorder-optimization');
  for (const k of Object.keys(opt.UNCONSTRAINED)) if (k !== 'SMARTBOOK') delete opt.UNCONSTRAINED[k];
  for (const k of Object.keys(opt.BUDGETED)) if (k !== 'SMARTBOOK') delete opt.BUDGETED[k];
  Object.assign(opt.UNCONSTRAINED, { FLOOR_BY_BORROWS: { priorityFloors: 'BY_BORROWS' }, NO_FLOORS: { priorityFloors: false } });
  const rows = opt.TEST_SEEDS.flatMap((seed) => opt.runSeed(seed));
  const fill = (p) => rows.filter((r) => r.policy === p && !r.budget).map((r) => r.fill_rate);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    note: 'POST-HOC: candidates added after the pre-registered study had used these test seeds',
    test_seeds: opt.TEST_SEEDS,
    smartbook_mean_fill_rate: mean(fill('SMARTBOOK')),
    candidates: ['FLOOR_BY_BORROWS', 'NO_FLOORS'].map((c) => {
      const j = opt.judgeUnconstrained(rows, opt.TEST_SEEDS, c);
      return { candidate: c, mean_fill_rate: mean(fill(c)), cost_ratio_vs_smartbook: j.cost_ratio, runs_failing_service_rule: j.failures.length, runs: rows.filter((r) => r.policy === c && !r.budget).length, passes: j.passes };
    }),
  };
}

function main(args = process.argv.slice(2)) {
  if (args[0] === '--synthetic') {
    console.log(`[reorder-quantity-variants] wrote ${writeJson('reorder_quantity_variants_synthetic.json', synthetic())}`);
    return;
  }
  const [univ, pub] = args;
  if (!univ || !pub) throw new Error('usage: reorder-quantity-variants.js <univ_events.json> <public_events.json> | --synthetic');
  const libraries = {};
  for (const [label, file] of [['univ', univ], ['public', pub]]) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.synthetic !== false || !data.real_source) throw new Error('input must come from real_library_loans.py');
    libraries[label] = realVariants(occupancy(data));
  }
  const result = { protocol: `12 monthly reviews, outcome = days ${DEFAULT_LEAD_TIME_DAYS}..${DEFAULT_LEAD_TIME_DAYS + OUTCOME_DAYS} after each review (as eval/real-copies.js)`, libraries };
  const written = [
    writeJson('reorder_quantity_variants_real.json', result),
    writeCsv('reorder_quantity_variants_real.csv', Object.entries(libraries).flatMap(([library, rows]) => rows.map((r) => ({ library, ...r })))),
  ];
  for (const f of written) console.log(`[reorder-quantity-variants] wrote ${f.replace(/\\/g, '/')}`);
}

if (require.main === module) main();

module.exports = { floorByBorrows, returnsPriority, realVariants };
