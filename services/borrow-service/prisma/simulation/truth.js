// Ground truth + provenance for a generated dataset.
//
// simulation-truth.json is for EVALUATION ONLY (thesis experiments, simulation
// analysis). No production model may read it - see docs/SYNTHETIC_BEHAVIOR_DATASET.md
// ("Data leakage prevention"); test/simulation-leakage.test.js enforces that no
// service source file references it.

const {
  GENERATOR_VERSION, LATE_COEFFICIENTS, NO_SHOW_COEFFICIENTS, TIER_EFFECT, BASE_RATE_TARGETS,
} = require('./config');
const { bayesAuc } = require('./evaluation');

const r3 = (x) => Number(x.toFixed(3));

function provenance(dataset) {
  return {
    synthetic: true,
    dataset_name: 'SmartBook Persona-conditioned Synthetic Behavioral Dataset',
    disclaimer_vi: 'Đây là dữ liệu tổng hợp mô phỏng hành vi người dùng, không phải dữ liệu thu thập từ người dùng thực tế.',
    disclaimer_en: 'Synthetic data from a behavioural simulation. Not collected from real users.',
    generator: 'services/borrow-service/prisma/simulation',
    generator_version: GENERATOR_VERSION,
    seed: dataset.meta.seed,
    customer_count: dataset.meta.customerCount,
    simulation_start: dataset.meta.windowStart.toISOString(),
    simulation_end: dataset.meta.end.toISOString(),
    simulation_months: dataset.meta.months,
  };
}

function customerTruth(c) {
  return {
    customer_id: c.id,
    customer_code: c.customer_code,
    demographics: { age: c.demographics.age, age_bucket: c.demographics.age_bucket, gender: c.demographics.gender, occupation: c.demographics.occupation, life_stage: c.demographics.life_stage },
    persona: c.persona,
    traits: Object.fromEntries(Object.entries(c.traits).map(([k, v]) => [k, r3(v)])),
    temporal: { preferred_hour_local: c.temporal.preferred_hour, hour_spread: r3(c.temporal.hour_spread), weekend_affinity: r3(c.traits.weekend_affinity) },
    category_preferences: Object.fromEntries(Object.entries(c.prefs.relative).map(([k, v]) => [k, r3(v)])),
    effective_category_preferences: Object.fromEntries(Object.entries(c.prefs.effective).map(([k, v]) => [k, r3(v)])),
    favourite_authors: Object.fromEntries(Object.entries(c.authorAffinity).map(([k, v]) => [k, r3(v)])),
    membership_plan: c.plan.code,
    tenure_segment: c.tenure_segment,
    created_at: c.created_at.toISOString(),
    churned_at: c.churnAt ? new Date(c.churnAt).toISOString() : null,
  };
}

function buildTruth(dataset) {
  const { samples, catalog, copies } = dataset;
  const lateRate = samples.late.filter((s) => s.label).length / Math.max(1, samples.late.length);
  const noShowRate = samples.noShow.filter((s) => s.label).length / Math.max(1, samples.noShow.length);
  return {
    provenance: provenance(dataset),
    generative_processes: {
      late_return: { form: 'sigmoid(b0 + b1*(1-punctuality) + b2*(max_loan_days-20)/8 + b3*(items_in_loan-1.5)/0.7 + b4*unpaid_fine_flag_at_checkout + b5*tier_effect)', coefficients: LATE_COEFFICIENTS, tier_effect: TIER_EFFECT },
      no_show: { form: 'sigmoid(c0 + c1*(1-punctuality) + c2*lead_hours_z + c3*(hold_hours-30)/10 + c4*channel_web + c5*prior_no_show_rate + c6*(active_loans-1)/1.5)', coefficients: NO_SHOW_COEFFICIENTS },
      base_rates: { late_return: r3(lateRate), no_show: r3(noShowRate), targets: BASE_RATE_TARGETS },
      bayes_auc_late: Number(bayesAuc(samples.late.map((s) => s.label), samples.late.map((s) => s.trueProb)).toFixed(4)),
      bayes_auc_no_show: Number(bayesAuc(samples.noShow.map((s) => s.label), samples.noShow.map((s) => s.trueProb)).toFixed(4)),
    },
    catalog: catalog.books.map((b) => ({
      book_id: b.id,
      book_code: b.book_code,
      categories: b.categories,
      popularity_rank: b.popularity_rank,
      latent_quality_z: r3(b.quality),
      page_count: b.page_count,
      page_count_imputed: b.page_count_imputed,
      simulated_copies: Object.fromEntries(b.variants.map((v) => [v.id, copies.get(v.id)])),
    })),
    customers: dataset.customers.map(customerTruth),
  };
}

// Backward-compatible summary at prisma/seed-history-truth.json (same keys the
// original seed-history.js wrote, so existing thesis tooling keeps working).
function legacyTruth(dataset, truth) {
  const t = dataset.tables;
  return {
    synthetic: true,
    generator_version: GENERATOR_VERSION,
    seed: dataset.meta.seed,
    window: { start: dataset.meta.windowStart.toISOString(), end: dataset.meta.end.toISOString(), days: Math.round((dataset.meta.end - dataset.meta.windowStart) / 86400000) },
    late_coefficients: LATE_COEFFICIENTS,
    no_show_coefficients: NO_SHOW_COEFFICIENTS,
    base_rates: { late_return: truth.generative_processes.base_rates.late_return, no_show: truth.generative_processes.base_rates.no_show, target_late: BASE_RATE_TARGETS.late_return, target_no_show: BASE_RATE_TARGETS.no_show },
    row_counts: {
      customers: t.customers.length, loan_transactions: t.loan_transactions.length, loan_items: t.loan_items.length,
      loan_items_returned: dataset.samples.late.length, loan_renewals: t.loan_renewals.length, fines: t.fines.length,
      fine_payments: t.fine_payments.length, loan_reservations: t.loan_reservations.length,
      reservations_with_terminal_outcome: dataset.samples.noShow.length,
      book_wishlists: t.book_wishlists.length, book_reviews: t.book_reviews.length, availability_alerts: t.availability_alerts.length,
    },
    bayes_auc_late: truth.generative_processes.bayes_auc_late,
    bayes_auc_no_show: truth.generative_processes.bayes_auc_no_show,
    generated_at: new Date().toISOString(),
  };
}

module.exports = { provenance, buildTruth, legacyTruth };
