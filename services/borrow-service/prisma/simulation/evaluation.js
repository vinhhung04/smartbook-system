// Offline evaluation of SmartBook's AI components on the synthetic dataset.
//
// LEAKAGE GUARD. Models here only see what the real system can see - rows of
// loans / reservations / wishlists / reviews / fines, each restricted to what
// existed before the prediction time. The latent truth (persona, traits,
// preferences) is used ONLY (a) as the label-generating process whose
// Bayes-optimal AUC is the ceiling, (b) for the clearly labelled
// ORACLE_TRUE_PREFERENCE reference ranker, and (c) for preference recovery,
// which compares what a model inferred against what the simulator knows.
//
// Risk and forecast use analytics-service's own pure modules (risk-features,
// risk-model, forecast) - the production code, not a re-implementation. They
// are required lazily so the seed still runs in the borrow-service container,
// where analytics-service is not present.

const path = require('path');
const fs = require('fs');
const { createRng } = require('./random');
const { spearman } = require('./validation');
const { DAY_MS } = require('./temporal-model');

const ANALYTICS_UTILS = path.resolve(__dirname, '../../../analytics-service/src/utils');

function loadAnalytics() {
  if (!fs.existsSync(path.join(ANALYTICS_UTILS, 'risk-model.js'))) return null;
  return {
    features: require(path.join(ANALYTICS_UTILS, 'risk-features.js')),
    model: require(path.join(ANALYTICS_UTILS, 'risk-model.js')),
    forecast: require(path.join(ANALYTICS_UTILS, 'forecast.js')),
  };
}

// Mann-Whitney AUC with average ranks for ties.
function bayesAuc(labels, scores) {
  const n = labels.length;
  const positives = labels.filter((l) => l === 1).length;
  const negatives = n - positives;
  if (!positives || !negatives) return null;
  const idx = scores.map((s, i) => ({ s, l: labels[i] })).sort((a, b) => a.s - b.s);
  let rankSum = 0;
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && idx[j + 1].s === idx[i].s) j += 1;
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k += 1) if (idx[k].l === 1) rankSum += avg;
    i = j + 1;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

const r4 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Number(Number(x).toFixed(4)));

// ── Risk rows, shaped like analytics.controller.js's SQL output ───────────────
// semantics 'point_in_time': history strictly known at checkout/reservation
//   time (what analytics.controller.js computes after the leakage fix).
// semantics 'legacy_sql': the pre-fix SQL - prior loans counted by borrow_date
//   only (their outcome may lie in the future), fines/active loans by CURRENT
//   status. Kept to quantify how much the leak inflated AUC.
function lateReturnRows(dataset, semantics) {
  const { tables: t } = dataset;
  const customers = new Map(t.customers.map((c) => [c.id, c]));
  const planByCustomer = new Map(dataset.customers.map((c) => [c.id, c.plan]));
  const loans = new Map(t.loan_transactions.map((l) => [l.id, l]));
  const renewalsByItem = new Map();
  for (const r of t.loan_renewals) {
    if (!renewalsByItem.has(r.loan_item_id)) renewalsByItem.set(r.loan_item_id, []);
    renewalsByItem.get(r.loan_item_id).push(r);
  }
  const itemsByCustomer = new Map();
  for (const i of t.loan_items) {
    const cid = loans.get(i.loan_id).customer_id;
    if (!itemsByCustomer.has(cid)) itemsByCustomer.set(cid, []);
    itemsByCustomer.get(cid).push(i);
  }
  const finesByCustomer = new Map();
  for (const f of t.fines) {
    if (!finesByCustomer.has(f.customer_id)) finesByCustomer.set(f.customer_id, []);
    finesByCustomer.get(f.customer_id).push(f);
  }
  const strict = semantics === 'point_in_time';

  return t.loan_items.filter((i) => i.return_date).map((li) => {
    const lt = loans.get(li.loan_id);
    const at = lt.borrow_date.getTime();
    const renewals = renewalsByItem.get(li.id) || [];
    let prior = 0; let late = 0; let renewed = 0;
    for (const li2 of itemsByCustomer.get(lt.customer_id)) {
      const lt2 = loans.get(li2.loan_id);
      if (lt2.borrow_date.getTime() >= at || !li2.return_date) continue;
      if (strict && li2.return_date.getTime() >= at) continue;
      prior += 1;
      if (li2.return_date > li2.due_date) late += 1;
      if (renewalsByItem.has(li2.id)) renewed += 1;
    }
    const unpaid = (finesByCustomer.get(lt.customer_id) || [])
      .filter((f) => f.issued_at.getTime() < at && (strict ? (!f.paid_at || f.paid_at.getTime() > at) : f.status === 'UNPAID'))
      .reduce((s, f) => s + f.amount - f.waived_amount, 0);
    const plan = planByCustomer.get(lt.customer_id);
    return {
      borrow_date: lt.borrow_date,
      original_due_date: renewals.length ? new Date(Math.min(...renewals.map((r) => r.old_due_date.getTime()))) : li.due_date,
      due_date: li.due_date,
      return_date: li.return_date,
      items_in_loan: lt.total_items,
      prior_loans: prior,
      prior_late_count: late,
      prior_renewal_count: renewed,
      customer_created_at: customers.get(lt.customer_id).created_at,
      unpaid_fines_at_checkout: unpaid,
      plan_max_loan_days: plan.max_loan_days,
      plan_fine_per_day: plan.fine_per_day,
      from_reservation: Boolean(lt.source_reservation_id),
      condition_worn_at_checkout: li.item_condition_on_checkout !== 'GOOD',
    };
  });
}

function noShowRows(dataset, semantics) {
  const { tables: t } = dataset;
  const customers = new Map(t.customers.map((c) => [c.id, c]));
  const strict = semantics === 'point_in_time';
  const byCustomer = new Map();
  for (const r of t.loan_reservations) {
    if (!byCustomer.has(r.customer_id)) byCustomer.set(r.customer_id, []);
    byCustomer.get(r.customer_id).push(r);
  }
  const loansByCustomer = new Map();
  for (const l of t.loan_transactions) {
    if (!loansByCustomer.has(l.customer_id)) loansByCustomer.set(l.customer_id, []);
    loansByCustomer.get(l.customer_id).push(l);
  }
  const finesByCustomer = new Map();
  for (const f of t.fines) {
    if (!finesByCustomer.has(f.customer_id)) finesByCustomer.set(f.customer_id, []);
    finesByCustomer.get(f.customer_id).push(f);
  }
  const terminal = (r) => r.pickup_code_issued_at && r.status !== 'CANCELLED' && (r.pickup_code_used_at || r.status === 'EXPIRED');
  const outcomeAt = (r) => (r.pickup_code_used_at || r.expires_at).getTime();

  return t.loan_reservations.filter(terminal).map((r) => {
    const at = r.reserved_at.getTime();
    let prior = 0; let noShow = 0;
    for (const r2 of byCustomer.get(r.customer_id)) {
      if (!terminal(r2) || r2.reserved_at.getTime() >= at) continue;
      if (strict && outcomeAt(r2) >= at) continue;
      prior += 1;
      if (!r2.pickup_code_used_at && r2.status === 'EXPIRED') noShow += 1;
    }
    const unpaid = (finesByCustomer.get(r.customer_id) || [])
      .filter((f) => f.issued_at.getTime() < at && (strict ? (!f.paid_at || f.paid_at.getTime() > at) : f.status === 'UNPAID'))
      .reduce((s, f) => s + f.amount - f.waived_amount, 0);
    const active = (loansByCustomer.get(r.customer_id) || []).filter((l) => l.borrow_date.getTime() < at
      && (strict ? (!l.closed_at || l.closed_at.getTime() > at) : ['BORROWED', 'OVERDUE'].includes(l.status))).length;
    return {
      status: r.status,
      reserved_at: r.reserved_at,
      expires_at: r.expires_at,
      pickup_code_issued_at: r.pickup_code_issued_at,
      pickup_code_used_at: r.pickup_code_used_at,
      quantity: r.quantity,
      source_channel: r.source_channel,
      customer_created_at: customers.get(r.customer_id).created_at,
      prior_reservations: prior,
      prior_no_show_count: noShow,
      unpaid_fines_at_reservation: unpaid,
      active_loans_at_reservation: active,
    };
  });
}

function summarizeRisk(result) {
  if (result.status !== 'OK') return result;
  const e = result.evaluation;
  return {
    status: 'OK',
    train_size: result.trainSize,
    test_size: result.testSize,
    split_at: result.splitAt,
    test_auc: r4(e.auc),
    test_brier: r4(e.brier),
    test_ece: r4(e.ece),
    test_base_rate: r4(e.base_rate),
    best_threshold: e.best_threshold,
    lift: e.lift,
    weights: Object.fromEntries(result.model.feature_names.map((n, i) => [n, r4(result.model.weights[i])])),
  };
}

function evaluateRisk(dataset, analytics) {
  const late = dataset.samples.late;
  const noShow = dataset.samples.noShow;
  const out = {
    late_return: {
      bayes_auc_ceiling: r4(bayesAuc(late.map((s) => s.label), late.map((s) => s.trueProb))),
      labelled_samples: late.length,
    },
    no_show: {
      bayes_auc_ceiling: r4(bayesAuc(noShow.map((s) => s.label), noShow.map((s) => s.trueProb))),
      labelled_samples: noShow.length,
    },
  };
  if (!analytics) {
    out.note = 'analytics-service not found next to borrow-service - model evaluation skipped';
    return out;
  }
  const { toLateReturnSample, toNoShowSample, LATE_RETURN_FEATURES, NO_SHOW_FEATURES } = analytics.features;
  for (const semantics of ['point_in_time', 'legacy_sql']) {
    const lateSamples = lateReturnRows(dataset, semantics).map(toLateReturnSample).filter((s) => s.label !== null);
    out.late_return[semantics] = summarizeRisk(analytics.model.trainAndEvaluate(lateSamples, { featureNames: LATE_RETURN_FEATURES }));
    const nsSamples = noShowRows(dataset, semantics).map(toNoShowSample).filter(Boolean);
    out.no_show[semantics] = summarizeRisk(analytics.model.trainAndEvaluate(nsSamples, { featureNames: NO_SHOW_FEATURES }));
  }
  return out;
}

// ── Forecast: same series + backtest as GET /analytics/forecast-accuracy ─────
function evaluateForecast(dataset, analytics, { days = 180, horizonDays = 7, minTrainDays = 30 } = {}) {
  if (!analytics) return { note: 'analytics-service not found - skipped' };
  const end = dataset.meta.end.getTime();
  const firstDay = Math.floor((end - days * DAY_MS) / DAY_MS) * DAY_MS;
  const nDays = Math.floor(end / DAY_MS) - firstDay / DAY_MS + 1;
  const loans = new Map(dataset.tables.loan_transactions.map((l) => [l.id, l]));
  const series = new Map();
  for (const i of dataset.tables.loan_items) {
    const at = loans.get(i.loan_id).borrow_date.getTime();
    if (at < end - days * DAY_MS || at > end) continue;
    if (!series.has(i.variant_id)) series.set(i.variant_id, new Array(nDays).fill(0));
    series.get(i.variant_id)[Math.floor(at / DAY_MS) - firstDay / DAY_MS] += 1;
  }
  const backtests = Array.from(series.entries()).map(([variantId, s]) => ({
    variantId, total: s.reduce((a, b) => a + b, 0), zeroDays: s.filter((x) => x === 0).length / s.length,
    backtest: analytics.forecast.rollingBacktest(s, { horizonDays, minTrainDays }),
  }));
  const ok = backtests.filter((b) => b.backtest.status === 'OK');
  const agg = new Map();
  const votes = {};
  for (const b of ok) {
    for (const m of b.backtest.models) {
      const a = agg.get(m.model) || { model: m.model, mae: 0, rmse: 0, wape: 0, samples: 0 };
      a.mae += m.mae * m.samples; a.rmse += m.rmse * m.samples; a.wape += (m.wape ?? 0) * m.samples; a.samples += m.samples;
      agg.set(m.model, a);
    }
    votes[b.backtest.bestModel] = (votes[b.backtest.bestModel] || 0) + 1;
  }
  const overall = Array.from(agg.values()).map((a) => ({ model: a.model, mae: r4(a.mae / a.samples), rmse: r4(a.rmse / a.samples), wape: r4(a.wape / a.samples), samples: a.samples }))
    .sort((a, b) => a.mae - b.mae);
  const byDemand = [...ok].sort((a, b) => b.total - a.total);
  return {
    window_days: days,
    horizon_days: horizonDays,
    min_train_days: minTrainDays,
    variants_with_demand: backtests.length,
    variants_backtested_ok: ok.length,
    variants_insufficient_data: backtests.length - ok.length,
    mean_zero_demand_day_share: r4(backtests.reduce((s, b) => s + b.zeroDays, 0) / Math.max(1, backtests.length)),
    overall_models: overall,
    best_model_votes: votes,
    top_5_demand_variants: byDemand.slice(0, 5).map((b) => ({ variant_id: b.variantId, borrows: b.total, best_model: b.backtest.bestModel, models: b.backtest.models.map((m) => ({ model: m.model, mae: r4(m.mae) })) })),
  };
}

// ── Recommendation: temporal hold-out ────────────────────────────────────────
// Cutoff = the time by which 80% of loan items had been borrowed. Profiles use
// only interactions before the cutoff; relevance = books first borrowed after
// it that the reader had not borrowed, wishlisted or rated before it (the
// production recommender excludes those, so they are not valid targets).
function recommendationSplit(dataset, { trainFraction = 0.8, minTrainLoans = 3 } = {}) {
  const { tables: t, catalog } = dataset;
  const loans = new Map(t.loan_transactions.map((l) => [l.id, l]));
  const itemTimes = t.loan_items.map((i) => loans.get(i.loan_id).borrow_date.getTime()).sort((a, b) => a - b);
  const cutoff = itemTimes[Math.floor(itemTimes.length * trainFraction)];
  const users = new Map();
  const u = (id) => {
    if (!users.has(id)) users.set(id, { customer_id: id, train_loans: [], train_wishlist: [], train_reviews: [], seen: new Set(), test: new Set() });
    return users.get(id);
  };
  for (const i of t.loan_items) {
    const l = loans.get(i.loan_id);
    const bookId = catalog.variantToBook.get(i.variant_id).id;
    if (l.borrow_date.getTime() < cutoff) {
      const x = u(l.customer_id);
      x.train_loans.push({ variant_id: i.variant_id, book_id: bookId, at: l.borrow_date.getTime() });
      x.seen.add(bookId);
    }
  }
  for (const w of t.book_wishlists) if (w.created_at.getTime() < cutoff) { const x = u(w.customer_id); x.train_wishlist.push(w.book_id); x.seen.add(w.book_id); }
  for (const r of t.book_reviews) if (r.created_at.getTime() < cutoff) { const x = u(r.customer_id); x.train_reviews.push({ book_id: r.book_id, rating: r.rating }); x.seen.add(r.book_id); }
  for (const i of t.loan_items) {
    const l = loans.get(i.loan_id);
    if (l.borrow_date.getTime() < cutoff) continue;
    const bookId = catalog.variantToBook.get(i.variant_id).id;
    const x = users.get(l.customer_id);
    if (x && !x.seen.has(bookId)) x.test.add(bookId);
  }
  const eligible = Array.from(users.values()).filter((x) => x.train_loans.length >= minTrainLoans && x.test.size > 0);
  // Book-level rating stats from train reviews only (the quality signal).
  const ratingStats = {};
  for (const r of t.book_reviews) {
    if (r.created_at.getTime() >= cutoff) continue;
    const s = ratingStats[r.book_id] || { sum: 0, totalReviews: 0 };
    s.sum += r.rating; s.totalReviews += 1;
    ratingStats[r.book_id] = s;
  }
  for (const s of Object.values(ratingStats)) s.averageRating = s.sum / s.totalReviews;
  return { cutoff: new Date(cutoff), users: eligible, ratingStats };
}

// Catalog in the shape inventory-service's book list returns (what
// ai-service's recommendation.py consumes): primary category NAME, first author.
function productionCatalog(catalog) {
  return catalog.books.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.authors[0] || 'Chưa cập nhật',
    category: catalog.categoryName.get(b.categories[0]) || 'Chưa phân loại',
    variant_ids: b.variants.map((v) => v.id),
    available_quantity: 1,
  }));
}

function rankingMetrics(rankings, split, catalogSize, k) {
  const byUser = new Map(split.users.map((x) => [x.customer_id, x]));
  let hit = 0; let recall = 0; let ndcg = 0; let mrr = 0; let n = 0;
  const recommended = new Set();
  const lists = [];
  for (const [customerId, ranked] of rankings) {
    const x = byUser.get(customerId);
    if (!x) continue;
    const top = ranked.slice(0, k);
    lists.push(new Set(top));
    top.forEach((b) => recommended.add(b));
    const rel = top.map((b) => (x.test.has(b) ? 1 : 0));
    const hits = rel.reduce((a, b) => a + b, 0);
    hit += hits > 0 ? 1 : 0;
    recall += hits / x.test.size;
    let dcg = 0;
    rel.forEach((r, i) => { dcg += r / Math.log2(i + 2); });
    let idcg = 0;
    for (let i = 0; i < Math.min(k, x.test.size); i += 1) idcg += 1 / Math.log2(i + 2);
    ndcg += dcg / idcg;
    const first = ranked.findIndex((b) => x.test.has(b));
    mrr += first >= 0 ? 1 / (first + 1) : 0;
    n += 1;
  }
  // Personalization = 1 - mean pairwise Jaccard overlap of top-K lists.
  let overlap = 0; let pairs = 0;
  for (let i = 0; i < lists.length; i += 1) {
    for (let j = i + 1; j < lists.length; j += 1) {
      let inter = 0;
      for (const b of lists[i]) if (lists[j].has(b)) inter += 1;
      overlap += inter / (lists[i].size + lists[j].size - inter || 1);
      pairs += 1;
    }
  }
  return {
    users: n,
    [`hit_rate@${k}`]: r4(hit / n),
    [`recall@${k}`]: r4(recall / n),
    [`ndcg@${k}`]: r4(ndcg / n),
    mrr: r4(mrr / n),
    [`catalog_coverage@${k}`]: r4(recommended.size / catalogSize),
    [`personalization@${k}`]: r4(pairs ? 1 - overlap / pairs : null),
  };
}

function baselineRankings(dataset, split) {
  const { catalog } = dataset;
  // Train-window loan items of ALL customers, each counted once. (An earlier
  // version also added the eligible users' train loans a second time.)
  const popularity = new Map();
  const loans = new Map(dataset.tables.loan_transactions.map((l) => [l.id, l]));
  for (const i of dataset.tables.loan_items) {
    const l = loans.get(i.loan_id);
    if (l.borrow_date.getTime() >= split.cutoff.getTime()) continue;
    const b = catalog.variantToBook.get(i.variant_id).id;
    popularity.set(b, (popularity.get(b) || 0) + 1);
  }
  const truthById = new Map(dataset.customers.map((c) => [c.id, c]));
  const rng = createRng((dataset.meta.seed ^ 0xe7a1) >>> 0);
  const out = { POPULARITY: new Map(), RANDOM: new Map(), ORACLE_TRUE_PREFERENCE: new Map() };
  for (const x of split.users) {
    const candidates = catalog.books.filter((b) => !x.seen.has(b.id));
    out.POPULARITY.set(x.customer_id, [...candidates].sort((a, b) => (popularity.get(b.id) || 0) - (popularity.get(a.id) || 0) || a.id.localeCompare(b.id)).map((b) => b.id));
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng.next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    out.RANDOM.set(x.customer_id, shuffled.map((b) => b.id));
    // Reference ceiling that READS THE LATENT TRUTH - not a deployable model.
    const c = truthById.get(x.customer_id);
    const score = (b) => {
      const pref = Math.max(...b.categories.map((s) => c.prefs.effective[s] || 0));
      const catSize = Math.max(...b.categories.map((s) => catalog.booksByCategory.get(s).length));
      const author = Math.max(1, ...b.authors.map((a) => c.authorAffinity[a] || 1));
      return (pref / catSize) * b.popularity * author;
    };
    out.ORACLE_TRUE_PREFERENCE.set(x.customer_id, [...candidates].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id)).map((b) => b.id));
  }
  return out;
}

// Category profile inferred from observable train signals, with the same
// weights as ai-service/recommendation.py (loan 1, wishlist 1.5, liked 2,
// disliked -1.5), compared with the simulator's true preference vector.
function preferenceRecovery(dataset, split) {
  const { catalog } = dataset;
  const truthById = new Map(dataset.customers.map((c) => [c.id, c]));
  const rhos = [];
  let top1 = 0;
  for (const x of split.users) {
    const w = Object.fromEntries(catalog.categoriesPresent.map((s) => [s, 0]));
    const add = (bookId, weight) => { w[catalog.byId.get(bookId).categories[0]] += weight; };
    x.train_loans.forEach((l) => add(l.book_id, 1));
    x.train_wishlist.forEach((b) => add(b, 1.5));
    x.train_reviews.forEach((r) => { if (r.rating >= 4) add(r.book_id, 2); else if (r.rating <= 2) add(r.book_id, -1.5); });
    const truth = truthById.get(x.customer_id).prefs.effective;
    const inferred = catalog.categoriesPresent.map((s) => w[s]);
    const actual = catalog.categoriesPresent.map((s) => truth[s]);
    const rho = spearman(inferred, actual);
    if (rho !== null) rhos.push(rho);
    if (inferred.indexOf(Math.max(...inferred)) === actual.indexOf(Math.max(...actual))) top1 += 1;
  }
  return {
    users: split.users.length,
    mean_spearman_inferred_vs_true_category_preference: r4(rhos.reduce((a, b) => a + b, 0) / Math.max(1, rhos.length)),
    top_category_agreement: r4(top1 / Math.max(1, split.users.length)),
    note: 'Inferred from observable history only; the truth vector is used solely as the comparison target.',
  };
}

function evaluateRecommendation(dataset, { productionRankings = null, ks = [5, 10] } = {}) {
  const split = recommendationSplit(dataset);
  const models = baselineRankings(dataset, split);
  if (productionRankings) models.SMARTBOOK_PRODUCTION_RANKER = productionRankings;
  const results = {};
  for (const [name, rankings] of Object.entries(models)) {
    results[name] = Object.assign({}, ...ks.map((k) => rankingMetrics(rankings, split, dataset.catalog.books.length, k)));
  }
  return {
    protocol: 'temporal hold-out: global cutoff at the 80th percentile of loan-item borrow times; relevance = books first borrowed after the cutoff that were not borrowed/wishlisted/rated before it',
    cutoff: split.cutoff.toISOString(),
    eligible_users: split.users.length,
    models: results,
    production_ranker_included: Boolean(productionRankings),
    preference_recovery: preferenceRecovery(dataset, split),
  };
}

// Input file for services/ai-service/eval/eval_recommendation_synthetic.py,
// which runs the production recommendation.py over each user's train history.
function recommendationEvalInput(dataset) {
  const split = recommendationSplit(dataset);
  return {
    synthetic: true,
    cutoff: split.cutoff.toISOString(),
    catalog: productionCatalog(dataset.catalog),
    rating_stats: Object.fromEntries(Object.entries(split.ratingStats).map(([k, v]) => [k, { averageRating: v.averageRating, totalReviews: v.totalReviews }])),
    users: split.users.map((x) => ({
      customer_id: x.customer_id,
      loans: [{ loan_items: [...x.train_loans].sort((a, b) => b.at - a.at).map((l) => ({ variant_id: l.variant_id })) }],
      wishlist_book_ids: x.train_wishlist,
      reviews: x.train_reviews,
    })),
  };
}

// ── Recommendation V2 input: a timestamped, point-in-time-reconstructable event log ──
// Everything here is observable by the real system (rows of loans, wishlists,
// reviews, reservations, copies per variant) plus wishlist removal times that
// the DB loses when it hard-deletes a row. No latent truth. The Python harness
// (services/ai-service/eval/eval_recommendation_v2.py) applies the cutoffs
// itself, so train / validation / test windows are chosen in one place.
const iso = (d) => (d ? d.toISOString() : null);

function recommendationEventLog(dataset) {
  const { tables: t, catalog } = dataset;
  const loans = new Map(t.loan_transactions.map((l) => [l.id, l]));
  const events = [];
  for (const i of t.loan_items) {
    const l = loans.get(i.loan_id);
    events.push({
      kind: 'LOAN', customer_id: l.customer_id, book_id: catalog.variantToBook.get(i.variant_id).id,
      variant_id: i.variant_id, at: iso(l.borrow_date), until: iso(i.return_date),
    });
  }
  for (const c of dataset.customers) {
    for (const [bookId, w] of c.wishlist) {
      events.push({ kind: 'WISHLIST', customer_id: c.id, book_id: bookId, at: iso(w.created_at), until: iso(w.removed_at || null) });
    }
  }
  for (const r of t.book_reviews) {
    events.push({ kind: 'REVIEW', customer_id: r.customer_id, book_id: r.book_id, rating: r.rating, at: iso(r.created_at) });
  }
  const terminal = new Set(['CANCELLED', 'EXPIRED', 'CONVERTED_TO_LOAN']);
  for (const r of t.loan_reservations) {
    events.push({
      kind: 'RESERVATION', customer_id: r.customer_id, book_id: catalog.variantToBook.get(r.variant_id).id,
      variant_id: r.variant_id, at: iso(r.reserved_at), until: terminal.has(r.status) ? iso(r.updated_at) : null,
    });
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind)
    || a.customer_id.localeCompare(b.customer_id) || a.book_id.localeCompare(b.book_id));
  return {
    synthetic: true,
    seed: dataset.meta.seed,
    window_start: iso(dataset.meta.windowStart),
    window_end: iso(dataset.meta.end),
    catalog: catalog.books.map((b) => ({
      id: b.id,
      title: b.title,
      author: b.authors[0] || 'Chưa cập nhật',
      category: catalog.categoryName.get(b.categories[0]) || 'Chưa phân loại',
      description: b.description || '',
      variant_ids: b.variants.map((v) => v.id),
      is_active: true,
    })),
    copies: Object.fromEntries(Array.from(dataset.copies.entries()).sort(([a], [b]) => a.localeCompare(b))),
    customers: t.customers.map((c) => ({ id: c.id, created_at: iso(c.created_at) })),
    events,
  };
}

// Per-customer ORACLE_TRUE_PREFERENCE scores - READS THE LATENT TRUTH, so it is
// written to its own file and only the clearly labelled oracle baseline loads it.
function recommendationOracleExport(dataset) {
  const { catalog } = dataset;
  const scores = {};
  for (const c of dataset.customers) {
    const row = {};
    for (const b of catalog.books) {
      const pref = Math.max(...b.categories.map((s) => c.prefs.effective[s] || 0));
      const catSize = Math.max(...b.categories.map((s) => catalog.booksByCategory.get(s).length));
      const author = Math.max(1, ...b.authors.map((a) => c.authorAffinity[a] || 1));
      row[b.id] = (pref / catSize) * b.popularity * author;
    }
    scores[c.id] = row;
  }
  return { synthetic: true, latent_truth: true, note: 'Reference ceiling only - never a model input.', scores };
}

function evaluateAll(dataset, { productionRankings = null } = {}) {
  const analytics = loadAnalytics();
  return {
    risk: evaluateRisk(dataset, analytics),
    forecast: evaluateForecast(dataset, analytics),
    recommendation: evaluateRecommendation(dataset, { productionRankings }),
  };
}

module.exports = {
  bayesAuc,
  lateReturnRows,
  noShowRows,
  evaluateRisk,
  evaluateForecast,
  recommendationSplit,
  evaluateRecommendation,
  recommendationEvalInput,
  recommendationEventLog,
  recommendationOracleExport,
  rankingMetrics,
  evaluateAll,
  loadAnalytics,
};
