// Tests for the persona-conditioned synthetic behavioural simulation
// (prisma/simulation/). Pure - no database. Statistical assertions compare
// groups (e.g. "heavy > casual") rather than exact numbers, so they are robust
// to parameter tuning; the fixed seed keeps them deterministic.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SIM = path.join(__dirname, '..', 'prisma', 'simulation');
const { createRng } = require('../prisma/simulation/random');
const personas = require('../prisma/simulation/personas');
const { sampleDemographics } = require('../prisma/simulation/demographics');
const { sampleTraits, noShowProbability, lateProbability, ratingFromScore } = require('../prisma/simulation/behavior-model');
const { sampleCategoryPreferences, chooseBook } = require('../prisma/simulation/preferences');
const { sampleLocalHour, dayOfWeekFactor, HOUR_MS } = require('../prisma/simulation/temporal-model');
const { buildCatalog } = require('../prisma/simulation/catalog');
const { generateDataset, EventHeap } = require('../prisma/simulation/simulate');
const { validateDataset } = require('../prisma/simulation/validation');
const { deleteSimulationRows } = require('../prisma/simulation/seed-simulation');
const { LOCAL_TZ_OFFSET_HOURS } = require('../prisma/simulation/config');

const SMALL = { seed: 4242, customerCount: 60, months: 12, end: new Date('2026-09-28T00:00:00Z') };
let full;
function fullDataset() {
  if (!full) {
    full = generateDataset({ seed: 20260928, customerCount: 600, months: 24, end: new Date('2026-09-28T00:00:00Z') });
    full.report = validateDataset(full);
  }
  return full;
}
const snapshot = (d) => JSON.stringify(d.tables);

function testUser(overrides = {}) {
  const catalog = buildCatalog(1);
  const effective = Object.fromEntries(catalog.categoriesPresent.map((c) => [c, c === 'kinh-te' ? 0.9 : 0.1 / (catalog.categoriesPresent.length - 1)]));
  return {
    catalog,
    user: {
      prefs: { effective, relative: effective },
      traits: { exploration: 0, digital_affinity: 0.5, ...overrides },
      authorAffinity: {}, likedAuthors: new Map(), borrowed: new Set(), held: new Map(), wishlist: new Map(), recentCategories: [],
    },
  };
}

// ── Reproducibility ─────────────────────────────────────────────────────────

test('same seed reproduces the whole dataset, ids included', () => {
  assert.equal(snapshot(generateDataset(SMALL)), snapshot(generateDataset(SMALL)));
});

test('a different seed produces a different dataset', () => {
  assert.notEqual(snapshot(generateDataset(SMALL)), snapshot(generateDataset({ ...SMALL, seed: 4243 })));
});

test('no Math.random anywhere in the simulation', () => {
  for (const file of fs.readdirSync(SIM).filter((f) => f.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(SIM, file), 'utf8'), /Math\.random/, file);
  }
});

// ── Population ──────────────────────────────────────────────────────────────

test('demographics follow the configured age mix; occupation follows age', () => {
  const rng = createRng(7);
  const n = 20000;
  const draws = Array.from({ length: n }, () => sampleDemographics(rng));
  for (const bucket of personas.AGE_BUCKETS) {
    const share = draws.filter((d) => d.age_bucket === bucket.label).length / n;
    assert.ok(Math.abs(share - bucket.weight) < 0.015, `${bucket.label}: ${share}`);
  }
  assert.ok(draws.filter((d) => d.occupation === 'RETIRED').every((d) => d.age >= 55));
  const itStudents = draws.filter((d) => d.occupation === 'IT_STUDENT');
  assert.ok(itStudents.filter((d) => d.persona === 'TECH_FOCUSED_READER').length / itStudents.length > 0.4);
});

test('traits = persona prior + individual variation', () => {
  const rng = createRng(11);
  const heavy = Array.from({ length: 300 }, () => sampleTraits(rng, 'HEAVY_READER'));
  const low = Array.from({ length: 300 }, () => sampleTraits(rng, 'LOW_ENGAGEMENT'));
  const mean = (a, k) => a.reduce((s, t) => s + t[k], 0) / a.length;
  assert.ok(mean(heavy, 'activity_level') > mean(low, 'activity_level') + 0.5);
  assert.ok(new Set(heavy.map((t) => t.activity_level.toFixed(9))).size === heavy.length, 'profiles are individual');
  for (const t of [...heavy, ...low]) for (const k of ['punctuality', 'digital_affinity', 'exploration']) assert.ok(t[k] > 0 && t[k] < 1);
});

test('category preferences normalise: relative max 1, effective sums to 1 over catalog categories only', () => {
  const rng = createRng(5);
  const present = ['kinh-te', 'ky-nang-song', 'van-hoc-viet-nam'];
  const { relative, effective } = sampleCategoryPreferences(rng, 'TECH_FOCUSED_READER', 'IT_STUDENT', present);
  assert.equal(Math.max(...Object.values(relative)), 1);
  assert.deepEqual(Object.keys(effective).sort(), [...present].sort());
  assert.ok(Math.abs(Object.values(effective).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

// ── Book choice ─────────────────────────────────────────────────────────────

test('weighted book sampling follows taste, never returns a held book, keeps unavailable books possible', () => {
  const { catalog, user } = testUser();
  const heldBook = catalog.booksByCategory.get('kinh-te')[0];
  user.held.set(heldBook.id, Infinity);
  const rng = createRng(3);
  let inPref = 0; let unavailablePicked = 0;
  for (let i = 0; i < 3000; i += 1) {
    const { book } = chooseBook(rng, user, { catalog, now: 0, isAvailable: (b) => b.popularity_rank > 5 });
    assert.notEqual(book.id, heldBook.id);
    if (book.categories[0] === 'kinh-te') inPref += 1;
    if (book.popularity_rank <= 5) unavailablePicked += 1;
  }
  assert.ok(inPref / 3000 > 0.8, `preferred share ${inPref / 3000}`);
  assert.ok(unavailablePicked > 0);
});

test('exploration spreads choices across categories', () => {
  const diversity = (exploration) => {
    const { catalog, user } = testUser({ exploration });
    const rng = createRng(9);
    const outside = Array.from({ length: 2000 }, () => chooseBook(rng, user, { catalog, now: 0 }).book.categories[0]).filter((c) => c !== 'kinh-te').length;
    return outside / 2000;
  };
  assert.ok(diversity(0.6) > diversity(0.05) + 0.3);
});

// ── Temporal ────────────────────────────────────────────────────────────────

test('temporal sampling: walk-ins within opening hours, life stages differ, weekday factor is mean-one', () => {
  const rng = createRng(13);
  const student = { life_stage: 'STUDENT', preferred_hour: 20, hour_spread: 1 };
  const retired = { life_stage: 'RETIRED', preferred_hour: 9, hour_spread: 1 };
  const s = Array.from({ length: 2000 }, () => sampleLocalHour(rng, student, { walkIn: true }));
  const r = Array.from({ length: 2000 }, () => sampleLocalHour(rng, retired, { walkIn: true }));
  assert.ok([...s, ...r].every((h) => h >= 8 && h < 20));
  assert.ok(s.reduce((a, b) => a + b) / 2000 > r.reduce((a, b) => a + b) / 2000 + 4);
  for (const wa of [0.1, 0.5, 0.9]) {
    const avg = [0, 1, 2, 3, 4, 5, 6].reduce((acc, d) => acc + dayOfWeekFactor(wa, d), 0) / 7;
    assert.ok(Math.abs(avg - 1) < 1e-9);
  }
  assert.ok(dayOfWeekFactor(0.9, 6) > dayOfWeekFactor(0.1, 6));
});

test('event heap pops in time order, FIFO on ties', () => {
  const heap = new EventHeap();
  [5, 1, 3, 1, 2].forEach((t, i) => heap.push({ time: new Date(t), id: i }));
  const order = [];
  while (heap.peek()) order.push(heap.pop().id);
  assert.deepEqual(order, [1, 3, 4, 2, 0]);
});

// ── Full dataset: invariants and designed relationships ────────────────────

test('all sanity checks pass (temporal order, FKs, uniqueness, review causality)', () => {
  const { sanity } = fullDataset().report;
  assert.equal(sanity.passed, true, JSON.stringify(sanity.failed));
});

test('dataset size lands in the intended ranges', () => {
  const c = fullDataset().report.counts;
  assert.ok(c.loan_transactions >= 12000 && c.loan_transactions <= 18000, `loans ${c.loan_transactions}`);
  assert.ok(c.loan_items >= 17000 && c.loan_items <= 25000, `items ${c.loan_items}`);
  assert.ok(c.loan_reservations >= 3500 && c.loan_reservations <= 6000);
  assert.ok(c.book_wishlists >= 4000 && c.book_wishlists <= 8000);
  assert.ok(c.book_reviews >= 2000 && c.book_reviews <= 4000);
  assert.ok(c.availability_alerts >= 800 && c.availability_alerts <= 2000);
  assert.ok(c.loan_renewals >= 1500 && c.loan_renewals <= 3000);
});

test('activity: heavy > regular > casual > low engagement, with a long tail', () => {
  const rel = fullDataset().report.relationships;
  const lpy = Object.fromEntries(rel.persona_activity.map((p) => [p.persona, p.loans_per_year]));
  assert.ok(lpy.HEAVY_READER > lpy.LITERATURE_LOVER);
  assert.ok(lpy.LITERATURE_LOVER > lpy.CASUAL_READER);
  assert.ok(lpy.CASUAL_READER > lpy.LOW_ENGAGEMENT);
  assert.ok(rel.activity_concentration.top_10pct_customers_share_of_loan_items > 0.25);
});

test('late returns: lower punctuality -> higher late rate', () => {
  const rows = fullDataset().report.relationships.punctuality_vs_late_rate.filter((r) => r.returned_items >= 200);
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i].late_rate < rows[i - 1].late_rate, JSON.stringify(rows));
  assert.ok(lateProbability({ punctuality: 0.2, planCode: 'BASIC', maxLoanDays: 14, itemsInLoan: 1, unpaidFineFlag: false })
    > lateProbability({ punctuality: 0.9, planCode: 'BASIC', maxLoanDays: 14, itemsInLoan: 1, unpaidFineFlag: false }));
});

test('late behaviour is stable per person (repeat lateness), not an independent coin per loan', () => {
  const d = fullDataset();
  const loans = new Map(d.tables.loan_transactions.map((l) => [l.id, l]));
  const byCustomer = new Map();
  for (const i of d.tables.loan_items) {
    if (!i.return_date) continue;
    const cid = loans.get(i.loan_id).customer_id;
    const s = byCustomer.get(cid) || { n: 0, late: 0 };
    s.n += 1; s.late += i.return_date > i.due_date ? 1 : 0;
    byCustomer.set(cid, s);
  }
  const rates = [...byCustomer.values()].filter((s) => s.n >= 20).map((s) => s.late / s.n);
  const m = rates.reduce((a, b) => a + b) / rates.length;
  const sd = Math.sqrt(rates.reduce((a, b) => a + (b - m) ** 2, 0) / rates.length);
  // A shared coin would give sd ~ sqrt(m(1-m)/n) ~ 0.06 for n>=20; latent punctuality spreads it far wider.
  assert.ok(sd > 0.08, `between-customer sd ${sd}`);
});

test('reservations: WEB share rises with digital affinity; no-show rises with low punctuality', () => {
  const rows = fullDataset().report.relationships.digital_affinity_vs_web_reservations;
  assert.ok(rows[2].web_share > rows[1].web_share && rows[1].web_share > rows[0].web_share);
  const base = { leadHours: 5, holdHours: 24, channelWeb: false, priorNoShowRate: 0, activeLoans: 1 };
  assert.ok(noShowProbability({ ...base, punctuality: 0.2 }) > noShowProbability({ ...base, punctuality: 0.9 }));
  assert.ok(noShowProbability({ ...base, punctuality: 0.5, priorNoShowRate: 1 }) > noShowProbability({ ...base, punctuality: 0.5 }));
});

test('reservation chain: every conversion is a real loan at pickup time; nothing else becomes a loan', () => {
  const t = fullDataset().tables;
  const bySource = new Map(t.loan_transactions.filter((l) => l.source_reservation_id).map((l) => [l.source_reservation_id, l]));
  for (const r of t.loan_reservations) {
    const loan = bySource.get(r.id);
    if (r.status === 'CONVERTED_TO_LOAN') {
      assert.ok(loan, r.reservation_number);
      assert.equal(loan.borrow_date.getTime(), r.pickup_code_used_at.getTime());
    } else {
      assert.equal(loan, undefined);
    }
    if (r.status === 'CANCELLED') assert.equal(r.pickup_code_used_at, null);
  }
});

test('loan -> return -> review causality: reviews only after the reviewer returned that book', () => {
  assert.equal(fullDataset().report.sanity.checks.reviews_of_books_not_borrowed_and_returned_before_review, 0);
});

test('ratings are taste-driven and skewed positive, not uniform', () => {
  const { relationships, distributions } = fullDataset().report;
  const r = relationships.taste_match_vs_rating;
  assert.ok(r[2].avg_rating > r[1].avg_rating && r[1].avg_rating > r[0].avg_rating);
  const dist = distributions.rating_distribution;
  assert.ok(dist[4] + dist[5] > 2 * (dist[1] + dist[2]));
  assert.equal(ratingFromScore(-10), 1);
  assert.equal(ratingFromScore(10), 5);
});

test('wishlists: engaged personas save more books; one row per customer/book', () => {
  const { relationships, sanity } = fullDataset().report;
  const w = Object.fromEntries(relationships.persona_activity.map((p) => [p.persona, p.wishlists_per_year]));
  assert.ok(w.HEAVY_READER > w.CASUAL_READER && w.CASUAL_READER > w.LOW_ENGAGEMENT);
  assert.equal(sanity.checks.duplicate_wishlist_customer_book, 0);
});

test('taste shapes borrowing and exploration shapes diversity', () => {
  const rel = fullDataset().report.relationships;
  assert.ok(rel.preference_vs_borrowed_categories.mean_spearman_pref_vs_borrow_share > 0.4);
  const e = rel.exploration_vs_diversity;
  assert.ok(e[2].category_entropy > e[0].category_entropy);
});

test('gender is not an input: changing the gender mix leaves every generated row identical', () => {
  const original = { ...personas.GENDER_WEIGHTS };
  const before = snapshot(generateDataset(SMALL));
  try {
    for (const k of Object.keys(personas.GENDER_WEIGHTS)) personas.GENDER_WEIGHTS[k] = k === 'OTHER' ? 1 : 0;
    const after = generateDataset(SMALL);
    assert.equal(snapshot(after), before);
    assert.ok(after.customers.every((c) => c.demographics.gender === 'OTHER'));
  } finally {
    Object.assign(personas.GENDER_WEIGHTS, original);
  }
});

test('events use local-time counter hours for walk-in checkouts', () => {
  const t = fullDataset().tables;
  const walkIns = t.loan_transactions.filter((l) => !l.source_reservation_id);
  const hours = walkIns.map((l) => (((l.borrow_date.getTime() / HOUR_MS + LOCAL_TZ_OFFSET_HOURS) % 24) + 24) % 24);
  assert.ok(hours.every((h) => h >= 8 && h < 20));
});

// ── Idempotent cleanup ──────────────────────────────────────────────────────

test('cleanup deletes only SIM-/HIST- scoped rows and never issues an unscoped delete', async () => {
  const calls = [];
  const prisma = new Proxy({}, { get: (_, table) => ({ deleteMany: async (args) => { calls.push({ table, args }); } }) });
  await deleteSimulationRows(prisma);
  assert.ok(calls.length >= 22);
  for (const { table, args } of calls) {
    const where = JSON.stringify(args && args.where);
    assert.ok(where && /"startsWith":"(SIM-|HIST-)"/.test(where), `${table}: ${where}`);
  }
  const tables = new Set(calls.map((c) => c.table));
  for (const t of ['customers', 'loan_transactions', 'loan_reservations', 'book_reviews', 'book_wishlists', 'availability_alerts', 'fines']) assert.ok(tables.has(t));
});

// ── Recommendation V2 event log (input of ai-service/eval/eval_recommendation_v2.py) ──

test('recommendation event log is observable-only, point-in-time reconstructable and deterministic', () => {
  const { recommendationEventLog, recommendationOracleExport } = require('../prisma/simulation/evaluation');
  const small = generateDataset(SMALL);
  const log = recommendationEventLog(small);
  assert.equal(log.synthetic, true);
  // No latent truth leaks into the model input: persona, traits, preferences, popularity prior, quality.
  const text = JSON.stringify(log);
  for (const latent of ['persona', 'traits', 'prefs', 'authorAffinity', 'popularity', 'quality', 'exploration']) {
    assert.ok(!text.includes(`"${latent}"`), `latent key ${latent} in event log`);
  }
  assert.equal(log.events.filter((e) => e.kind === 'LOAN').length, small.tables.loan_items.length);
  assert.equal(log.events.filter((e) => e.kind === 'REVIEW').length, small.tables.book_reviews.length);
  // Removed wishlist rows are kept with their removal time; survivors equal the DB table.
  const wish = log.events.filter((e) => e.kind === 'WISHLIST');
  assert.equal(wish.filter((e) => e.until === null).length, small.tables.book_wishlists.length);
  for (const w of wish) if (w.until) assert.ok(w.until >= w.at, 'wishlist removed before it was created');
  assert.ok(wish.some((w) => w.until), 'some wishlist rows are removed on borrow');
  // Sorted by time, and identical on a rerun.
  for (let i = 1; i < log.events.length; i += 1) assert.ok(log.events[i - 1].at <= log.events[i].at);
  assert.equal(JSON.stringify(recommendationEventLog(generateDataset(SMALL))), text);
  // The oracle lives in a separate export, clearly labelled.
  const oracle = recommendationOracleExport(small);
  assert.equal(oracle.latent_truth, true);
  assert.equal(Object.keys(oracle.scores).length, small.customers.length);
});
