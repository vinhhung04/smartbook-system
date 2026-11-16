#!/usr/bin/env node
/**
 * Copies per title on REAL library loans: how often every copy of a title is out at
 * once (the shelf is empty), how many copies were never needed at the same time, and
 * whether production's reorder ranking (calculateSuggestion + compareReorderCandidates,
 * reused verbatim) points at the titles whose shelf is empty after an order would arrive.
 *
 * Demand the shelf could not serve is never recorded (the files hold served loans only,
 * no holds), so "all copies out" is the observable proxy for a title needing more copies.
 * Copies of a title = distinct copies that ever appear in a loan.
 *
 * Input: an events file from services/ai-service/eval/real_library_loans.py
 * (Mendeley 10.17632/6rd45bvxjy.1, CC BY 4.0, research/education use only).
 *
 * USAGE (from services/analytics-service):
 *   node eval/real-copies.js ../../research-inputs/library-loans-mendeley/derived/public_events.json public
 *
 * OUTPUTS: thesis/data/copies_needed_real_<label>.json,
 *          thesis/tables/copies_saturation_real_<label>.csv, copies_reorder_backtest_real_<label>.csv
 */

const fs = require('fs');
const { calculateSuggestion, compareReorderCandidates } = require('../src/utils/reorder-suggestion');
const { DEFAULT_LEAD_TIME_DAYS } = require('../src/utils/lead-time');
const { writeJson, writeCsv } = require('./run-all');

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365;
const WINDOW_DAYS = 30; // GET /analytics/reorder-suggestions default window
const OUTCOME_DAYS = 30;
const REVIEWS = 12; // monthly reviews over the last year of data
const TOP_K = 50; // the first page a librarian reads
const SHORTAGE_SHARE = 0.5; // "shelf empty most of the time"

const dayOf = (iso) => Math.floor(Date.parse(iso) / DAY_MS);
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

// Per title: copies, borrow days and the copies out on each day. A loan holds its copy from
// the borrow day to the day before the return (at least the borrow day itself); a loan with
// no return date is given the median loan length.
function occupancy(data) {
  const start = dayOf(data.window_start);
  const days = dayOf(data.window_end) - start + 1;
  const loans = data.events.filter((e) => e.kind === 'LOAN');
  const fallback = median(loans.filter((e) => e.until).map((e) => Math.max(1, dayOf(e.until) - dayOf(e.at))));
  const titles = new Map(data.catalog.map((b) => [b.id, {
    id: b.id, category: b.category, copies: b.variant_ids.length, borrowDays: [], loans: [], out: new Int16Array(days + 1),
  }]));
  for (const e of loans) {
    const t = titles.get(e.book_id);
    const s = dayOf(e.at) - start;
    const end = Math.min(days - 1, e.until ? Math.max(s, dayOf(e.until) - start - 1) : s + fallback - 1);
    t.borrowDays.push(s);
    t.loans.push({ s, ret: e.until ? dayOf(e.until) - start : null }); // ret null: no return date in the file
    t.out[s] += 1;
    t.out[end + 1] -= 1;
  }
  for (const t of titles.values()) {
    for (let d = 1; d <= days; d += 1) t.out[d] += t.out[d - 1];
    t.borrowDays.sort((a, b) => a - b);
  }
  return { titles: [...titles.values()], days, imputedLoanDays: fallback, missingReturns: loans.filter((e) => !e.until).length };
}

const emptyDays = (t, from, to) => {
  let n = 0;
  for (let d = from; d < to; d += 1) if (t.out[d] >= t.copies) n += 1;
  return n;
};
const countIn = (sorted, from, to) => sorted.filter((d) => d >= from && d < to).length;

// The last year of data: empty-shelf days, peak copies out at once, copies never needed together.
function describe({ titles, days }) {
  const from = Math.max(0, days - YEAR_DAYS);
  const span = days - from;
  const buckets = [['1', 1, 1], ['2', 2, 2], ['3-5', 3, 5], ['6+', 6, Infinity]].map(([label, lo, hi]) => ({
    label, lo, hi, titles: 0, borrowed: 0, copies: 0, copyDaysOut: 0, emptyTitleDays: 0, shortage: 0, idle: 0, extra: 0,
  }));
  const categories = new Map();
  let anomalies = 0;
  for (const t of titles) {
    let peak = 0;
    let out = 0;
    for (let d = from; d < days; d += 1) {
      peak = Math.max(peak, t.out[d]);
      out += Math.min(t.out[d], t.copies);
      if (t.out[d] > t.copies) anomalies += 1;
    }
    const empty = emptyDays(t, from, days);
    const b = buckets.find((x) => t.copies >= x.lo && t.copies <= x.hi);
    const c = categories.get(t.category) || { category: t.category, titles: 0, copies: 0, copyDaysOut: 0, emptyTitleDays: 0, shortage: 0 };
    const shortage = empty >= SHORTAGE_SHARE * span ? 1 : 0;
    for (const x of [b, c]) {
      x.titles += 1; x.copies += t.copies; x.copyDaysOut += out; x.emptyTitleDays += empty; x.shortage += shortage;
    }
    b.borrowed += countIn(t.borrowDays, from, days) > 0 ? 1 : 0;
    // idle: no copy of the title was out all window; extra: copies above the peak of a title that was out
    if (peak === 0) b.idle += t.copies; else b.extra += Math.max(0, t.copies - peak);
    categories.set(t.category, c);
  }
  const shape = (x) => ({
    titles: x.titles,
    copies: x.copies,
    utilization: x.copies ? x.copyDaysOut / (x.copies * span) : null,
    empty_shelf_share: x.titles ? x.emptyTitleDays / (x.titles * span) : null,
    shortage_titles: x.shortage,
  });
  const all = buckets.reduce((acc, x) => ({
    titles: acc.titles + x.titles, borrowed: acc.borrowed + x.borrowed, copies: acc.copies + x.copies,
    copyDaysOut: acc.copyDaysOut + x.copyDaysOut, emptyTitleDays: acc.emptyTitleDays + x.emptyTitleDays,
    shortage: acc.shortage + x.shortage, idle: acc.idle + x.idle, extra: acc.extra + x.extra,
  }), { titles: 0, borrowed: 0, copies: 0, copyDaysOut: 0, emptyTitleDays: 0, shortage: 0, idle: 0, extra: 0 });
  const withSpare = (x) => ({
    ...shape(x), borrowed_titles: x.borrowed, idle_copies: x.idle, extra_copies: x.extra,
    extra_copy_share: x.copies - x.idle ? x.extra / (x.copies - x.idle) : null,
  });
  return {
    window_days: span,
    shortage_rule: `all copies out on >= ${SHORTAGE_SHARE * 100}% of the days`,
    idle_rule: 'copies of titles with no copy out on any day of the window',
    extra_rule: 'for titles out at least once: copies minus the most copies out on the same day (share is of the copies of those titles)',
    overall: withSpare(all),
    by_copies: buckets.map((x) => ({ copies_per_title: x.label, ...withSpare(x) })),
    top_categories_by_empty_shelf_days: [...categories.values()]
      .sort((a, b) => b.emptyTitleDays - a.emptyTitleDays || a.category.localeCompare(b.category))
      .slice(0, 10)
      .map((c) => ({ category: c.category, ...shape(c), empty_title_days: c.emptyTitleDays })),
    // overlapping loans of the same copy in the source file
    title_days_more_out_than_copies: anomalies,
    title_days_more_out_than_copies_share: anomalies / (titles.length * span),
  };
}

// Monthly reviews: production's suggestion for every title borrowed in the last 30 days,
// scored by the days the shelf is empty AFTER an order placed that day would arrive
// (lead time .. lead time + 30), so a loan already out at review time counts little.
function backtest({ titles, days }, leadTimeDays = DEFAULT_LEAD_TIME_DAYS) {
  const ranges = { days: WINDOW_DAYS, leadTimeDays };
  const samples = [];
  const rankers = { PRODUCTION_RANKING: [], RECENT_BORROWS: [], ALL_CANDIDATES: [] };
  const reviews = [];
  for (let k = REVIEWS - 1; k >= 0; k -= 1) {
    const r = days - leadTimeDays - OUTCOME_DAYS - k * WINDOW_DAYS;
    if (r < 2 * WINDOW_DAYS) continue;
    reviews.push(r);
    const rows = [];
    for (const t of titles) {
      const borrowCount = countIn(t.borrowDays, r - WINDOW_DAYS, r);
      if (!borrowCount) continue;
      const startedToday = countIn(t.borrowDays, r, r + 1);
      const borrowed = Math.max(0, t.out[r] - startedToday);
      const series = Array.from({ length: WINDOW_DAYS }, (_, i) => countIn(t.borrowDays, r - WINDOW_DAYS + i, r - WINDOW_DAYS + i + 1));
      const available = Math.max(0, t.copies - borrowed);
      const row = { book_id: t.id, variant_id: t.id, title: t.id, author: '', category: t.category, available_qty: available, on_hand_qty: available, borrowed_qty: borrowed, reorder_point: 0, unit_cost: 0 };
      const demand = { borrowCount, previousBorrowCount: countIn(t.borrowDays, r - 2 * WINDOW_DAYS, r - WINDOW_DAYS), reservationCount: 0, wishlistCount: 0, availabilityAlertCount: 0 };
      const item = calculateSuggestion(row, demand, ranges, {}, series);
      const empty = emptyDays(t, r + leadTimeDays, r + leadTimeDays + OUTCOME_DAYS) / OUTCOME_DAYS;
      // production's own alternative: the priority minimum only when lead-time demand exceeds the shelf
      const ifShortfall = calculateSuggestion(row, demand, ranges, {}, series, null, { priorityFloors: 'IF_SHORTFALL' });
      const noFloors = calculateSuggestion(row, demand, ranges, {}, series, null, { priorityFloors: false });
      rows.push({ item, empty });
      samples.push({ priority: item.priority, qty: item.suggested_reorder_qty, qtyIfShortfall: ifShortfall.suggested_reorder_qty, qtyNoFloors: noFloors.suggested_reorder_qty, empty });
    }
    const top = (sorted) => sorted.slice(0, TOP_K).map((x) => x.empty);
    rankers.PRODUCTION_RANKING.push(...top([...rows].sort((a, b) => compareReorderCandidates(a.item, b.item))));
    rankers.RECENT_BORROWS.push(...top([...rows].sort((a, b) => b.item.borrow_count - a.item.borrow_count || a.item.title.localeCompare(b.item.title))));
    rankers.ALL_CANDIDATES.push(...rows.map((x) => x.empty));
  }
  const summarize = (values) => ({
    samples: values.length,
    mean_empty_shelf_share: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    shortage_share: values.length ? values.filter((v) => v >= SHORTAGE_SHARE).length / values.length : null,
  });
  const shortages = samples.filter((s) => s.empty >= SHORTAGE_SHARE);
  return {
    reviews: reviews.length,
    lead_time_days: leadTimeDays,
    outcome: `share of days ${leadTimeDays}..${leadTimeDays + OUTCOME_DAYS} after the review with every copy out`,
    inputs_missing: 'no reservations, wishlists, availability alerts, reorder points or costs in the files; seasonal index fixed at 1; default 14-day lead time',
    by_priority: ['HIGH', 'MEDIUM', 'LOW'].map((p) => {
      const group = samples.filter((s) => s.priority === p);
      return {
        priority: p, ...summarize(group.map((s) => s.empty)),
        mean_suggested_qty: group.length ? group.reduce((a, s) => a + s.qty, 0) / group.length : null,
        mean_suggested_qty_if_shortfall_floors: group.length ? group.reduce((a, s) => a + s.qtyIfShortfall, 0) / group.length : null,
        mean_suggested_qty_without_floors: group.length ? group.reduce((a, s) => a + s.qtyNoFloors, 0) / group.length : null,
        share_of_later_shortages: shortages.length ? shortages.filter((s) => s.priority === p).length / shortages.length : null,
      };
    }),
    top_k: TOP_K,
    rankers: Object.entries(rankers).map(([ranker, values]) => ({ ranker, ...summarize(values) })),
  };
}

function main([file, label] = process.argv.slice(2)) {
  if (!file || !/^[a-z0-9-]+$/.test(label || '')) throw new Error('usage: real-copies.js <events.json> <label>');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.synthetic !== false || !data.real_source) throw new Error('input must come from real_library_loans.py');
  const occ = occupancy(data);
  const result = {
    provenance: { ...data.real_source, loans: data.events.length, missing_return_dates: occ.missingReturns, imputed_loan_days: occ.imputedLoanDays },
    copies_rule: 'copies of a title = distinct copies that ever appear in a loan (copies never borrowed are unknown; late acquisitions count from the start)',
    last_year: describe(occ),
    reorder_backtest: backtest(occ),
  };
  const written = [
    writeJson(`copies_needed_real_${label}.json`, result),
    writeCsv(`copies_saturation_real_${label}.csv`, [{ copies_per_title: 'all', ...result.last_year.overall }, ...result.last_year.by_copies]),
    writeCsv(`copies_reorder_backtest_real_${label}.csv`, [
      ...result.reorder_backtest.by_priority.map((p) => ({ group: `priority ${p.priority}`, ...p })),
      ...result.reorder_backtest.rankers.map((r) => ({ group: r.ranker === 'ALL_CANDIDATES' ? 'all candidates' : `top ${TOP_K} by ${r.ranker}`, ...r })),
    ].map((g) => ({
      group: g.group, samples: g.samples, mean_empty_shelf_share: g.mean_empty_shelf_share, shortage_share: g.shortage_share,
      share_of_later_shortages: g.share_of_later_shortages ?? '', mean_suggested_qty: g.mean_suggested_qty ?? '',
      mean_suggested_qty_if_shortfall_floors: g.mean_suggested_qty_if_shortfall_floors ?? '',
      mean_suggested_qty_without_floors: g.mean_suggested_qty_without_floors ?? '',
    }))),
  ];
  for (const f of written) console.log(`[real-copies] wrote ${f.replace(/\\/g, '/')}`);
  return result;
}

if (require.main === module) main();

module.exports = { occupancy, describe, backtest, main };
