// Statistical validation of a generated dataset.
//
// Two parts:
//   sanityChecks()   - hard invariants (temporal order, FKs, uniqueness,
//                      causality). Every check must report 0 violations.
//   relationships()  - does each latent trait actually move the observable
//                      behaviour it is designed to move? (persona -> activity,
//                      punctuality -> late rate, digital affinity -> WEB share,
//                      exploration -> diversity, taste -> borrowing & rating,
//                      and gender -> nothing).
//
// Only the dataset tables plus the simulation truth are read here; this is an
// evaluation tool, never an input to a production model.

const { tasteMatch } = require('./preferences');
const { DAY_MS, HOUR_MS } = require('./temporal-model');
const { LOCAL_TZ_OFFSET_HOURS, PREFIX } = require('./config');

const YEAR_MS = 365 * DAY_MS;
const round = (x, d = 3) => (x === null || Number.isNaN(x) ? null : Number(x.toFixed(d)));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const utcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function sanityChecks(dataset) {
  const { tables: t, catalog, meta } = dataset;
  const end = meta.end.getTime();
  const customers = new Map(t.customers.map((c) => [c.id, c]));
  const loans = new Map(t.loan_transactions.map((l) => [l.id, l]));
  const items = new Map(t.loan_items.map((i) => [i.id, i]));
  const reservations = new Map(t.loan_reservations.map((r) => [r.id, r]));
  const fines = new Map(t.fines.map((f) => [f.id, f]));
  const checks = {};
  const count = (name, n) => { checks[name] = n; };

  // Returned (customer, book) pairs with the return time, for review causality.
  const returned = new Map();
  for (const i of t.loan_items) {
    if (!i.return_date) continue;
    const book = catalog.variantToBook.get(i.variant_id);
    const key = `${loans.get(i.loan_id).customer_id}|${book && book.id}`;
    const at = i.return_date.getTime();
    if (!returned.has(key) || returned.get(key) > at) returned.set(key, at);
  }
  count('reviews_of_books_not_borrowed_and_returned_before_review', t.book_reviews.filter((r) => {
    const at = returned.get(`${r.customer_id}|${r.book_id}`);
    return at === undefined || at > r.created_at.getTime();
  }).length);

  count('loans_before_customer_created_at', t.loan_transactions.filter((l) => l.borrow_date < customers.get(l.customer_id).created_at).length);
  count('reservations_before_customer_created_at', t.loan_reservations.filter((r) => r.reserved_at < customers.get(r.customer_id).created_at).length);
  count('wishlists_before_customer_created_at', t.book_wishlists.filter((w) => w.created_at < customers.get(w.customer_id).created_at).length);
  count('memberships_starting_before_customer_created_day', t.customer_memberships.filter((m) => m.start_date.getTime() < utcDay(customers.get(m.customer_id).created_at)).length);
  count('return_date_before_borrow_date', t.loan_items.filter((i) => i.return_date && i.return_date < loans.get(i.loan_id).borrow_date).length);
  count('pickup_before_reservation', t.loan_reservations.filter((r) => (r.pickup_code_used_at && r.pickup_code_used_at < r.reserved_at) || (r.pickup_code_issued_at && r.pickup_code_issued_at < r.reserved_at) || (r.pickup_code_used_at && r.pickup_code_used_at < r.pickup_code_issued_at)).length);
  count('rating_outside_1_5', t.book_reviews.filter((r) => !(Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)).length);
  count('impossible_due_dates', t.loan_transactions.filter((l) => l.due_date <= l.borrow_date).length
    + t.loan_items.filter((i) => i.due_date < loans.get(i.loan_id).due_date).length);
  count('renewals_out_of_order', t.loan_renewals.filter((r) => {
    const item = items.get(r.loan_item_id);
    const loan = item && loans.get(item.loan_id);
    return !loan || r.new_due_date <= r.old_due_date || r.renewed_at < loan.borrow_date || r.renewed_at > r.old_due_date;
  }).length);
  count('fines_paid_before_issued', t.fines.filter((f) => f.paid_at && f.paid_at < f.issued_at).length);
  count('fines_without_late_return', t.fines.filter((f) => {
    const i = items.get(f.loan_item_id);
    return !i || !i.return_date || i.return_date <= i.due_date || i.return_date.getTime() !== f.issued_at.getTime();
  }).length);
  count('late_returns_without_fine', t.loan_items.filter((i) => i.return_date && i.return_date > i.due_date && !(Number(i.fine_amount) > 0)).length);
  count('alert_notified_before_created', t.availability_alerts.filter((a) => a.notified_at && a.notified_at < a.created_at).length);
  count('converted_reservation_loan_mismatch', t.loan_transactions.filter((l) => {
    if (!l.source_reservation_id) return false;
    const r = reservations.get(l.source_reservation_id);
    return !r || r.status !== 'CONVERTED_TO_LOAN' || r.customer_id !== l.customer_id
      || r.pickup_code_used_at.getTime() !== l.borrow_date.getTime();
  }).length);
  const allDates = [
    ...t.loan_transactions.flatMap((l) => [l.borrow_date, l.closed_at]),
    ...t.loan_items.map((i) => i.return_date), ...t.loan_renewals.map((r) => r.renewed_at),
    ...t.loan_reservations.flatMap((r) => [r.reserved_at, r.pickup_code_issued_at, r.pickup_code_used_at]),
    ...t.fines.flatMap((f) => [f.issued_at, f.paid_at]), ...t.book_reviews.map((r) => r.created_at),
    ...t.book_wishlists.map((w) => w.created_at), ...t.availability_alerts.flatMap((a) => [a.created_at, a.notified_at]),
  ];
  count('events_after_simulation_end', allDates.filter((d) => d && d.getTime() > end).length);

  // Referential integrity (including cross-service ids against the catalog).
  let fk = 0;
  for (const l of t.loan_transactions) if (!customers.has(l.customer_id)) fk += 1;
  for (const i of t.loan_items) if (!loans.has(i.loan_id) || !catalog.variantToBook.has(i.variant_id)) fk += 1;
  for (const r of t.loan_renewals) if (!items.has(r.loan_item_id)) fk += 1;
  for (const r of t.loan_reservations) if (!customers.has(r.customer_id) || !catalog.variantToBook.has(r.variant_id)) fk += 1;
  for (const f of t.fines) if (!customers.has(f.customer_id) || !items.has(f.loan_item_id)) fk += 1;
  for (const p of t.fine_payments) if (!fines.has(p.fine_id)) fk += 1;
  for (const m of t.customer_memberships) if (!customers.has(m.customer_id)) fk += 1;
  for (const rows of [t.book_wishlists, t.book_reviews, t.availability_alerts]) {
    for (const r of rows) if (!customers.has(r.customer_id) || !catalog.byId.has(r.book_id)) fk += 1;
  }
  for (const l of t.loan_transactions) if (l.source_reservation_id && !reservations.has(l.source_reservation_id)) fk += 1;
  count('invalid_foreign_keys', fk);

  const dupes = (rows) => rows.length - new Set(rows.map((r) => `${r.customer_id}|${r.book_id}`)).size;
  count('duplicate_review_customer_book', dupes(t.book_reviews));
  count('duplicate_wishlist_customer_book', dupes(t.book_wishlists));
  count('duplicate_alert_customer_book', dupes(t.availability_alerts));
  const unique = (rows, key) => rows.length - new Set(rows.map((r) => r[key])).size;
  count('duplicate_natural_keys', unique(t.customers, 'customer_code') + unique(t.loan_transactions, 'loan_number')
    + unique(t.loan_reservations, 'reservation_number') + unique(t.customer_memberships, 'card_number')
    + unique(t.loan_reservations.filter((r) => r.pickup_code), 'pickup_code'));
  count('rows_without_simulation_prefix',
    t.customers.filter((c) => !c.customer_code.startsWith(PREFIX.customer)).length
    + t.loan_transactions.filter((l) => !l.loan_number.startsWith(PREFIX.loan)).length
    + t.loan_reservations.filter((r) => !r.reservation_number.startsWith(PREFIX.reservation)).length
    + t.customer_memberships.filter((m) => !m.card_number.startsWith(PREFIX.card)).length);

  const failed = Object.entries(checks).filter(([, n]) => n !== 0).map(([name]) => name);
  return { passed: failed.length === 0, failed, checks };
}

// ─────────────────────────────────────────────────────────────────────────────

function exposureYears(customer, meta) {
  const from = Math.max(customer.created_at.getTime(), meta.windowStart.getTime());
  return Math.max((meta.end.getTime() - from) / YEAR_MS, 1 / 12);
}

function bucketTable(rows, bucketOf, buckets, valueOf) {
  return buckets.map((label) => {
    const inBucket = rows.filter((r) => bucketOf(r) === label);
    const values = inBucket.map(valueOf).filter((v) => v !== null && v !== undefined);
    return { bucket: label, n: inBucket.length, value: round(mean(values)) };
  });
}

function gini(values) {
  const v = [...values].sort((a, b) => a - b);
  const n = v.length;
  const total = v.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let cum = 0;
  for (let i = 0; i < n; i += 1) cum += (2 * (i + 1) - n - 1) * v[i];
  return cum / (n * total);
}

function entropy(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total || counts.length < 2) return 0;
  const h = -counts.filter((c) => c > 0).reduce((s, c) => s + (c / total) * Math.log(c / total), 0);
  return h / Math.log(counts.length);
}

function spearman(xs, ys) {
  const rank = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

// Per-customer observable aggregates joined with truth.
function customerFacts(dataset) {
  const { tables: t, catalog, customers, meta } = dataset;
  const loansById = new Map(t.loan_transactions.map((l) => [l.id, l]));
  const itemsByCustomer = groupBy(t.loan_items, (i) => loansById.get(i.loan_id).customer_id);
  const loansByCustomer = groupBy(t.loan_transactions, (l) => l.customer_id);
  const resByCustomer = groupBy(t.loan_reservations, (r) => r.customer_id);
  const wishByCustomer = groupBy(t.book_wishlists, (w) => w.customer_id);
  const revByCustomer = groupBy(t.book_reviews, (r) => r.customer_id);
  return customers.map((c) => {
    const items = (itemsByCustomer.get(c.id) || []).sort((a, b) => loansById.get(a.loan_id).borrow_date - loansById.get(b.loan_id).borrow_date);
    const cats = items.map((i) => catalog.variantToBook.get(i.variant_id).categories[0]);
    const catCounts = catalog.categoriesPresent.map((s) => cats.filter((x) => x === s).length);
    const returned = items.filter((i) => i.return_date);
    const res = resByCustomer.get(c.id) || [];
    const years = exposureYears(c, meta);
    return {
      c,
      years,
      loans: (loansByCustomer.get(c.id) || []).length,
      items: items.length,
      cats,
      catCounts,
      returned: returned.length,
      late: returned.filter((i) => i.return_date > i.due_date).length,
      reservations: res.length,
      web: res.filter((r) => r.source_channel === 'WEB').length,
      wishlists: (wishByCustomer.get(c.id) || []).length,
      reviews: (revByCustomer.get(c.id) || []).length,
    };
  });
}

function relationships(dataset) {
  const { tables: t, catalog, customers, meta } = dataset;
  const facts = customerFacts(dataset);
  const byPersona = groupBy(facts, (f) => f.c.persona);
  const personaTable = Array.from(byPersona.entries()).map(([persona, fs]) => ({
    persona,
    customers: fs.length,
    loans_per_year: round(mean(fs.map((f) => f.loans / f.years)), 2),
    items_per_loan: round(fs.reduce((s, f) => s + f.items, 0) / Math.max(1, fs.reduce((s, f) => s + f.loans, 0)), 2),
    reservations_per_year: round(mean(fs.map((f) => f.reservations / f.years)), 2),
    wishlists_per_year: round(mean(fs.map((f) => f.wishlists / f.years)), 2),
    reviews_per_year: round(mean(fs.map((f) => f.reviews / f.years)), 2),
    late_rate: round(fs.reduce((s, f) => s + f.late, 0) / Math.max(1, fs.reduce((s, f) => s + f.returned, 0))),
    web_share: round(fs.reduce((s, f) => s + f.web, 0) / Math.max(1, fs.reduce((s, f) => s + f.reservations, 0))),
  })).sort((a, b) => b.loans_per_year - a.loans_per_year);

  // Activity long tail.
  const itemCounts = facts.map((f) => f.items).sort((a, b) => b - a);
  const totalItems = itemCounts.reduce((a, b) => a + b, 0);
  const top10 = itemCounts.slice(0, Math.ceil(itemCounts.length * 0.1)).reduce((a, b) => a + b, 0);

  // Punctuality -> late rate (item level, returned items).
  const puncBuckets = ['0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0'];
  const puncOf = (p) => puncBuckets[Math.min(4, Math.floor(p / 0.2))];
  const punctuality = puncBuckets.map((b) => {
    const fs = facts.filter((f) => puncOf(f.c.traits.punctuality) === b);
    const ret = fs.reduce((s, f) => s + f.returned, 0);
    return { bucket: b, customers: fs.length, returned_items: ret, late_rate: round(fs.reduce((s, f) => s + f.late, 0) / Math.max(1, ret)) };
  });

  // Digital affinity -> WEB share of reservations.
  const digOf = (d) => (d < 0.4 ? 'LOW (<0.4)' : d < 0.7 ? 'MEDIUM (0.4-0.7)' : 'HIGH (>=0.7)');
  const digital = ['LOW (<0.4)', 'MEDIUM (0.4-0.7)', 'HIGH (>=0.7)'].map((b) => {
    const fs = facts.filter((f) => digOf(f.c.traits.digital_affinity) === b);
    const res = fs.reduce((s, f) => s + f.reservations, 0);
    return { bucket: b, customers: fs.length, reservations: res, web_share: round(fs.reduce((s, f) => s + f.web, 0) / Math.max(1, res)) };
  });

  // Exploration -> diversity (customers with >= 10 borrowed items).
  const expOf = (e) => (e < 0.2 ? 'LOW (<0.2)' : e < 0.4 ? 'MEDIUM (0.2-0.4)' : 'HIGH (>=0.4)');
  const engaged = facts.filter((f) => f.items >= 10);
  const exploration = ['LOW (<0.2)', 'MEDIUM (0.2-0.4)', 'HIGH (>=0.4)'].map((b) => {
    const fs = engaged.filter((f) => expOf(f.c.traits.exploration) === b);
    return {
      bucket: b,
      customers: fs.length,
      unique_categories_first_10_items: round(mean(fs.map((f) => new Set(f.cats.slice(0, 10)).size)), 2),
      unique_categories_per_year: round(mean(fs.map((f) => new Set(f.cats).size / Math.max(f.years, 1))), 2),
      category_entropy: round(mean(fs.map((f) => entropy(f.catCounts)))),
      share_outside_top_preference: round(mean(fs.map((f) => {
        const top = catalog.categoriesPresent.reduce((a, b) => (f.c.prefs.effective[a] >= f.c.prefs.effective[b] ? a : b));
        return f.cats.filter((x) => x !== top).length / f.cats.length;
      }))),
    };
  });

  // Preference -> borrowed category alignment.
  const alignment = engaged.map((f) => {
    const prefs = catalog.categoriesPresent.map((s) => f.c.prefs.effective[s]);
    const shares = f.catCounts.map((n) => n / f.items);
    const top = catalog.categoriesPresent[prefs.indexOf(Math.max(...prefs))];
    const topShare = f.cats.filter((x) => x === top).length / f.items;
    return { rho: spearman(prefs, shares), topShare, topPref: Math.max(...prefs), mostBorrowedIsTop: shares.indexOf(Math.max(...shares)) === prefs.indexOf(Math.max(...prefs)) };
  });
  const catalogShare = (slug) => catalog.books.filter((b) => b.categories[0] === slug).length / catalog.books.length;
  const preference = {
    customers: alignment.length,
    mean_spearman_pref_vs_borrow_share: round(mean(alignment.map((a) => a.rho).filter((r) => r !== null))),
    mean_share_of_items_in_top_preferred_category: round(mean(alignment.map((a) => a.topShare))),
    mean_true_preference_of_top_category: round(mean(alignment.map((a) => a.topPref))),
    most_borrowed_category_is_top_preference_rate: round(mean(alignment.map((a) => (a.mostBorrowedIsTop ? 1 : 0)))),
    catalog_share_by_category: Object.fromEntries(catalog.categoriesPresent.map((s) => [s, round(catalogShare(s))])),
  };

  // Taste match -> rating.
  const custById = new Map(customers.map((c) => [c.id, c]));
  const tasteBuckets = ['LOW (<0.4)', 'MEDIUM (0.4-0.7)', 'HIGH (>=0.7)'];
  const tasteOf = (x) => (x < 0.4 ? tasteBuckets[0] : x < 0.7 ? tasteBuckets[1] : tasteBuckets[2]);
  const reviewTaste = t.book_reviews.map((r) => ({ r, taste: tasteMatch(custById.get(r.customer_id), catalog.byId.get(r.book_id)) }));
  const rating = bucketTable(reviewTaste, (x) => tasteOf(x.taste), tasteBuckets, (x) => x.r.rating)
    .map((row) => ({ bucket: row.bucket, reviews: row.n, avg_rating: row.value }));

  // Renewal vs page count.
  const renewedItems = new Set(t.loan_renewals.map((r) => r.loan_item_id));
  const pagesOf = (i) => catalog.variantToBook.get(i.variant_id).page_count;
  const pageBuckets = ['<250 pages', '250-400 pages', '>400 pages'];
  const pageOf = (p) => (p < 250 ? pageBuckets[0] : p <= 400 ? pageBuckets[1] : pageBuckets[2]);
  const renewal = bucketTable(t.loan_items, (i) => pageOf(pagesOf(i)), pageBuckets, (i) => (renewedItems.has(i.id) ? 1 : 0))
    .map((row) => ({ bucket: row.bucket, items: row.n, renewal_rate: row.value }));

  // Payment reliability -> fine paid share.
  const relBuckets = ['LOW (<0.5)', 'MEDIUM (0.5-0.8)', 'HIGH (>=0.8)'];
  const relOf = (x) => (x < 0.5 ? relBuckets[0] : x < 0.8 ? relBuckets[1] : relBuckets[2]);
  const payment = bucketTable(t.fines, (f) => relOf(custById.get(f.customer_id).traits.payment_reliability), relBuckets, (f) => (f.paid_at ? 1 : 0))
    .map((row) => ({ bucket: row.bucket, fines: row.n, paid_share: row.value }));

  // Membership plan vs latent activity quartile (and not gender - below).
  const actOf = (a) => (a < 0.3 ? 'Q1 (<0.3)' : a < 0.5 ? 'Q2 (0.3-0.5)' : a < 0.7 ? 'Q3 (0.5-0.7)' : 'Q4 (>=0.7)');
  const membership = ['Q1 (<0.3)', 'Q2 (0.3-0.5)', 'Q3 (0.5-0.7)', 'Q4 (>=0.7)'].map((b) => {
    const cs = customers.filter((c) => actOf(c.traits.activity_level) === b);
    const plans = {};
    for (const c of cs) plans[c.plan.code] = (plans[c.plan.code] || 0) + 1;
    return { activity: b, customers: cs.length, gold_or_vip_share: round(cs.filter((c) => ['GOLD', 'VIP'].includes(c.plan.code)).length / Math.max(1, cs.length)), plans };
  });

  // Gender: must NOT drive taste, lateness or membership.
  const gender = Array.from(groupBy(facts, (f) => f.c.demographics.gender).entries()).map(([g, fs]) => {
    const ret = fs.reduce((s, f) => s + f.returned, 0);
    const litShare = fs.reduce((s, f) => s + f.cats.filter((x) => x.startsWith('van-hoc') || x === 'truyen-ngan').length, 0) / Math.max(1, fs.reduce((s, f) => s + f.items, 0));
    return {
      gender: g,
      customers: fs.length,
      loans_per_year: round(mean(fs.map((f) => f.loans / f.years)), 2),
      late_rate: round(fs.reduce((s, f) => s + f.late, 0) / Math.max(1, ret)),
      literature_share_of_items: round(litShare),
      gold_or_vip_share: round(fs.filter((f) => ['GOLD', 'VIP'].includes(f.c.plan.code)).length / fs.length),
      mean_true_punctuality: round(mean(fs.map((f) => f.c.traits.punctuality))),
    };
  }).sort((a, b) => b.customers - a.customers);

  // Temporal: local hour of checkout by life stage; month profile by life stage.
  const loanCust = new Map(t.loan_transactions.map((l) => [l.id, custById.get(l.customer_id)]));
  const hourBins = ['08-11', '11-14', '14-17', '17-20'];
  const temporal = Array.from(groupBy(t.loan_transactions, (l) => loanCust.get(l.id).temporal.life_stage).entries()).map(([stage, ls]) => {
    const hours = ls.map((l) => (((l.borrow_date.getTime() / HOUR_MS + LOCAL_TZ_OFFSET_HOURS) % 24) + 24) % 24);
    const dist = Object.fromEntries(hourBins.map((b, i) => [b, round(hours.filter((h) => h >= 8 + 3 * i && h < 11 + 3 * i).length / hours.length)]));
    const months = new Array(12).fill(0);
    for (const l of ls) months[new Date(l.borrow_date.getTime() + LOCAL_TZ_OFFSET_HOURS * HOUR_MS).getUTCMonth()] += 1;
    const m = mean(months);
    return { life_stage: stage, loans: ls.length, hour_distribution: dist, month_index: months.map((x) => round(x / m, 2)) };
  });

  // Book long tail / turnover tiers.
  const perBook = new Map();
  for (const i of t.loan_items) {
    const b = catalog.variantToBook.get(i.variant_id).id;
    perBook.set(b, (perBook.get(b) || 0) + 1);
  }
  const bookCounts = catalog.books.map((b) => perBook.get(b.id) || 0).sort((a, b) => b - a);
  const lastQuarterStart = meta.end.getTime() - 90 * DAY_MS;
  const q = new Map();
  for (const i of t.loan_items) {
    if (loansDate(dataset, i) >= lastQuarterStart) q.set(i.variant_id, (q.get(i.variant_id) || 0) + 1);
  }
  const turnover90 = catalog.books.flatMap((b) => b.variants.map((v) => q.get(v.id) || 0));
  const tier = (n) => (n >= 30 ? 'HIGH (>=30)' : n >= 8 ? 'MEDIUM (8-29)' : 'LOW (<8)');
  const turnoverTiers = {};
  for (const n of turnover90) turnoverTiers[tier(n)] = (turnoverTiers[tier(n)] || 0) + 1;

  // Event chains observed in the rows.
  const reservationLoans = t.loan_transactions.filter((l) => l.source_reservation_id).length;
  const wishThenBorrow = (() => {
    const firstBorrow = new Map();
    for (const i of t.loan_items) {
      const l = dataset._loansById.get(i.loan_id);
      const key = `${l.customer_id}|${catalog.variantToBook.get(i.variant_id).id}`;
      if (!firstBorrow.has(key) || firstBorrow.get(key) > l.borrow_date.getTime()) firstBorrow.set(key, l.borrow_date.getTime());
    }
    return t.book_wishlists.filter((w) => (firstBorrow.get(`${w.customer_id}|${w.book_id}`) || 0) > w.created_at.getTime()).length;
  })();

  return {
    persona_activity: personaTable,
    activity_concentration: {
      top_10pct_customers_share_of_loan_items: round(top10 / Math.max(1, totalItems)),
      gini_loan_items_per_customer: round(gini(itemCounts)),
      customers_with_zero_loans: itemCounts.filter((n) => n === 0).length,
    },
    punctuality_vs_late_rate: punctuality,
    digital_affinity_vs_web_reservations: digital,
    exploration_vs_diversity: exploration,
    preference_vs_borrowed_categories: preference,
    taste_match_vs_rating: rating,
    page_count_vs_renewal: renewal,
    payment_reliability_vs_fine_paid: payment,
    activity_vs_membership_plan: membership,
    gender_fairness: gender,
    temporal_by_life_stage: temporal,
    book_popularity: {
      books: bookCounts.length,
      top_10_books_share_of_items: round(bookCounts.slice(0, 10).reduce((a, b) => a + b, 0) / Math.max(1, bookCounts.reduce((a, b) => a + b, 0))),
      median_items_per_book: bookCounts[Math.floor(bookCounts.length / 2)],
      max_items_per_book: bookCounts[0],
      min_items_per_book: bookCounts[bookCounts.length - 1],
      gini_items_per_book: round(gini(bookCounts)),
      variant_turnover_tiers_last_90_days: turnoverTiers,
    },
    event_chains: {
      loans_created_from_reservation_pickup: reservationLoans,
      alerts_notified: t.availability_alerts.filter((a) => a.status === 'NOTIFIED').length,
      wishlists_later_borrowed: wishThenBorrow,
    },
  };
}

function loansDate(dataset, item) {
  return dataset._loansById.get(item.loan_id).borrow_date.getTime();
}

function distributionSummary(dataset) {
  const { tables: t, customers } = dataset;
  const tally = (values) => {
    const out = {};
    for (const v of values) out[v] = (out[v] || 0) + 1;
    return out;
  };
  const returned = t.loan_items.filter((i) => i.return_date);
  return {
    persona_distribution: tally(customers.map((c) => c.persona)),
    age_distribution: tally(customers.map((c) => c.demographics.age_bucket)),
    gender_distribution: tally(customers.map((c) => c.demographics.gender)),
    occupation_distribution: tally(customers.map((c) => c.demographics.occupation)),
    membership_distribution: tally(customers.map((c) => c.plan.code)),
    tenure_distribution: tally(customers.map((c) => c.tenure_segment)),
    reservation_status: tally(t.loan_reservations.map((r) => r.status)),
    reservation_channel: tally(t.loan_reservations.map((r) => r.source_channel)),
    alert_status: tally(t.availability_alerts.map((a) => a.status)),
    rating_distribution: tally(t.book_reviews.map((r) => r.rating)),
    late_return_rate: round(returned.filter((i) => i.return_date > i.due_date).length / Math.max(1, returned.length)),
    avg_loans_per_customer: round(t.loan_transactions.length / customers.length, 2),
    fine_paid_share: round(t.fines.filter((f) => f.status === 'PAID').length / Math.max(1, t.fines.length)),
  };
}

function validateDataset(dataset) {
  dataset._loansById = new Map(dataset.tables.loan_transactions.map((l) => [l.id, l]));
  return {
    counts: Object.fromEntries(Object.entries(dataset.tables).map(([k, v]) => [k, v.length])),
    distributions: distributionSummary(dataset),
    sanity: sanityChecks(dataset),
    relationships: relationships(dataset),
  };
}

module.exports = { validateDataset, sanityChecks, relationships, spearman, gini, entropy };
