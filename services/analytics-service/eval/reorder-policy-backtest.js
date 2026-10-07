// Reorder-policy backtest: replays the synthetic borrow-request timeline
// against independent virtual inventories, one per policy, and scores them
// with business metrics (fill rate, stock-outs, inventory, procurement cost).
//
// PROTOCOL (fixed before looking at any result; see
// docs/ANALYSIS/REORDER_DECISION_EVALUATION.md):
//  * Demand: every borrow request of the simulator's unlimited-stock pilot run
//    (synthetic-world.js). Loan durations come from the same rows.
//  * Warm-up: the first WARM_UP_DAYS days are simulated with no reordering,
//    identically for every policy - it builds the borrow history the first
//    decision needs (production's seasonal index looks back 365 + 30 days).
//  * Scoring window: every day after warm-up until the end of the dataset.
//  * Reviews: every REVIEW_PERIOD_DAYS days, starting on the first scored day.
//  * Scenarios (same for every policy inside a scenario):
//      BASE            starting collection = simulator's calibrated copies,
//                      every order arrives after exactly 14 days
//      SUPPLIER_DELAY  same collection, each order arrives after 14..28 days
//                      (deterministic hash of variant + order day, so every
//                      policy that orders on the same day waits the same time)
//      LEAN_START      half the calibrated copies (min 1), 14-day delivery
//    These are simulation assumptions, not measured supplier behaviour.
//  * Budget-matched run: SmartBook with a per-review budget equal to the total
//    spend of the cheaper of the two simple baselines (REORDER_POINT,
//    MA30_FIXED_LT) in the same scenario, divided by the number of reviews;
//    candidates funded in production order via allocateBudget().
//  * Secondary "steady-state" window: scoring days from STEADY_STATE_OFFSET_DAYS
//    (the longest lead time any scenario can produce) onward. Before that no
//    order placed in the scoring window can have arrived, so every policy is
//    still running on the same warm-up stock. Added after the first run showed
//    that most stock-out days fell inside that transient; reported next to,
//    never instead of, the full-window metrics.

const { hashString } = require('../../borrow-service/prisma/simulation/random');
const { runInventoryBacktest } = require('./inventory-simulator');
const { noReorderPolicy, reorderPointPolicy, ma30FixedLeadTimePolicy, smartbookPolicy, LOW_STOCK_THRESHOLD } = require('./reorder-policies');
const { DEFAULT_LEAD_TIME_DAYS } = require('../src/utils/lead-time');

const WARM_UP_DAYS = 395;
const REVIEW_PERIOD_DAYS = 7;
const SUPPLIER_DELAY_MAX_EXTRA_DAYS = 14;
const STEADY_STATE_OFFSET_DAYS = DEFAULT_LEAD_TIME_DAYS + SUPPLIER_DELAY_MAX_EXTRA_DAYS;

function scenarios(seed) {
  const fixed = () => DEFAULT_LEAD_TIME_DAYS;
  return [
    {
      id: 'BASE',
      description: 'Calibrated starting collection, every order delivered after 14 days.',
      initial_stock_rule: 'simulator calibrated copies',
      lead_time_rule: '14 days',
      initialCopies: (v) => v.calibratedCopies,
      leadTimeDays: fixed,
    },
    {
      id: 'SUPPLIER_DELAY',
      description: 'Calibrated starting collection, each order delivered after 14-28 days (supplier slower than its declared 14 days).',
      initial_stock_rule: 'simulator calibrated copies',
      lead_time_rule: `14 + (hash(seed, variant, order day) mod ${SUPPLIER_DELAY_MAX_EXTRA_DAYS + 1}) days`,
      initialCopies: (v) => v.calibratedCopies,
      leadTimeDays: (variantId, orderDay) => DEFAULT_LEAD_TIME_DAYS
        + (hashString(`${seed}|${variantId}|${orderDay}`) % (SUPPLIER_DELAY_MAX_EXTRA_DAYS + 1)),
    },
    {
      id: 'LEAN_START',
      description: 'Half of the calibrated starting collection (at least 1 copy), 14-day delivery.',
      initial_stock_rule: 'max(1, floor(calibrated copies / 2))',
      lead_time_rule: '14 days',
      initialCopies: (v) => Math.max(1, Math.floor(v.calibratedCopies / 2)),
      leadTimeDays: fixed,
    },
  ];
}

function ablationPolicies(world) {
  const common = { reservationsByVariant: new Map(world.variants.map((v) => [v.variantId, v.reservations])), wishlistsByBook: world.wishlistsByBook };
  return {
    SMARTBOOK_FULL: smartbookPolicy({ ...common, name: 'SMARTBOOK_FULL' }),
    SMARTBOOK_NO_SEASONALITY: smartbookPolicy({ ...common, name: 'SMARTBOOK_NO_SEASONALITY', seasonality: false }),
    SMARTBOOK_FIXED_LEAD_TIME: smartbookPolicy({ ...common, name: 'SMARTBOOK_FIXED_LEAD_TIME', learnedLeadTime: false }),
    SMARTBOOK_NO_SAFETY_STOCK: smartbookPolicy({ ...common, name: 'SMARTBOOK_NO_SAFETY_STOCK', safetyStock: false }),
    SMARTBOOK_NO_DEMAND_SIGNALS: smartbookPolicy({ ...common, name: 'SMARTBOOK_NO_DEMAND_SIGNALS', demandSignals: false }),
  };
}

function runReorderBacktest(world, { timelinePolicies = ['NO_REORDER', 'REORDER_POINT', 'MA30_FIXED_LT', 'SMARTBOOK'] } = {}) {
  const firstDay = world.firstDay;
  const evalStartDay = firstDay + WARM_UP_DAYS;
  const endDay = world.endDay;
  if (evalStartDay >= endDay) throw new Error(`dataset too short: needs more than ${WARM_UP_DAYS} days`);

  // Example timeline: the variant with the most requests in the scoring window
  // (rule fixed in advance, independent of any policy's result).
  const scoredDemand = (v) => v.requests.filter((r) => r.at >= evalStartDay * 86400000 && r.at < endDay * 86400000).length;
  const example = [...world.variants].sort((a, b) => scoredDemand(b) - scoredDemand(a) || a.variantId.localeCompare(b.variantId))[0];

  const ablation = ablationPolicies(world);
  const policies = [];
  const ablationRows = [];
  const perVariant = [];
  const timeline = { scenario: 'BASE', variant_id: example.variantId, title: example.title, selection_rule: 'variant with the most borrow requests in the scoring window', policies: {} };
  const scenarioRows = [];

  for (const scenario of scenarios(world.options.seed)) {
    const variants = world.variants.map((v) => ({ ...v, initialCopies: scenario.initialCopies(v) }));
    const run = (policy, extra = {}) => runInventoryBacktest({
      variants, firstDay, evalStartDay, endDay, reviewPeriodDays: REVIEW_PERIOD_DAYS, policy,
      leadTimeDays: scenario.leadTimeDays, rankCandidates: policy.rankCandidates || null,
      steadyStartDay: evalStartDay + STEADY_STATE_OFFSET_DAYS,
      timelineVariantIds: scenario.id === 'BASE' ? [example.variantId] : [],
      ...extra,
    });
    const record = (role, policy, result, extra = {}) => {
      policies.push({ scenario: scenario.id, policy: extra.name || policy.name, role, params: { ...(policy.params || {}), ...(extra.params || {}) }, metrics: result.metrics, steady_state_metrics: result.steadyStateMetrics, decision_stats: result.decisionStats });
      if (scenario.id === 'BASE') {
        for (const row of result.perVariant) perVariant.push({ scenario: scenario.id, policy: extra.name || policy.name, ...row });
        const name = extra.name || policy.name;
        if (timelinePolicies.includes(name)) timeline.policies[name] = result.timelines[example.variantId];
      }
      return result;
    };

    record('reference', noReorderPolicy(), run(noReorderPolicy()));
    const rp = record('baseline', reorderPointPolicy(), run(reorderPointPolicy()));
    const ma = record('baseline', ma30FixedLeadTimePolicy(), run(ma30FixedLeadTimePolicy()));
    const full = run(ablation.SMARTBOOK_FULL);
    record('smartbook', ablation.SMARTBOOK_FULL, full, { name: 'SMARTBOOK' });

    const reviews = full.decisionStats.reviews;
    const budgetPerReview = Math.min(rp.metrics.procurement_cost, ma.metrics.procurement_cost) / reviews;
    const budgetFull = run(ablation.SMARTBOOK_FULL, { budgetPerReview });
    record('smartbook', ablation.SMARTBOOK_FULL, budgetFull, { name: 'SMARTBOOK_BUDGET_MATCHED', params: { budget_per_review_vnd: budgetPerReview } });

    for (const [name, policy] of Object.entries(ablation)) {
      const result = name === 'SMARTBOOK_FULL' ? full : run(policy);
      ablationRows.push({ scenario: scenario.id, variant: name, budget_constrained: false, params: policy.params, metrics: result.metrics, steady_state_metrics: result.steadyStateMetrics, decision_stats: result.decisionStats });
    }
    // Demand signals only change the demand score (and, via reservations, the
    // priority); the score only matters when a budget forces a ranking.
    ablationRows.push({ scenario: scenario.id, variant: 'SMARTBOOK_FULL', budget_constrained: true, params: { ...ablation.SMARTBOOK_FULL.params, budget_per_review_vnd: budgetPerReview }, metrics: budgetFull.metrics, steady_state_metrics: budgetFull.steadyStateMetrics, decision_stats: budgetFull.decisionStats });
    const budgetNoSignals = run(ablation.SMARTBOOK_NO_DEMAND_SIGNALS, { budgetPerReview });
    ablationRows.push({ scenario: scenario.id, variant: 'SMARTBOOK_NO_DEMAND_SIGNALS', budget_constrained: true, params: { ...ablation.SMARTBOOK_NO_DEMAND_SIGNALS.params, budget_per_review_vnd: budgetPerReview }, metrics: budgetNoSignals.metrics, steady_state_metrics: budgetNoSignals.steadyStateMetrics, decision_stats: budgetNoSignals.decisionStats });

    scenarioRows.push({
      id: scenario.id,
      description: scenario.description,
      initial_stock_rule: scenario.initial_stock_rule,
      lead_time_rule: scenario.lead_time_rule,
      initial_catalog_copies: variants.reduce((s, v) => s + v.initialCopies, 0),
      budget_per_review_vnd: budgetPerReview,
    });
  }

  const day = (d) => new Date(d * 86400000).toISOString().slice(0, 10);
  return {
    provenance: world.provenance,
    protocol: {
      demand_source: 'pilot run of the synthetic simulator with unlimited stock (uncensored borrow requests); same seed as the observed dataset',
      inventory_model: 'circulating copies: a served borrow holds one copy until the loan return day; purchases add copies permanently; unmet requests are lost',
      simulation_start: day(firstDay),
      scoring_start: day(evalStartDay),
      scoring_end_exclusive: day(endDay),
      warm_up_days: WARM_UP_DAYS,
      evaluated_days: endDay - evalStartDay,
      steady_state_start: day(evalStartDay + STEADY_STATE_OFFSET_DAYS),
      steady_state_days: endDay - evalStartDay - STEADY_STATE_OFFSET_DAYS,
      review_period_days: REVIEW_PERIOD_DAYS,
      inventory_position: 'shelf copies + copies on order (copies on loan excluded, as in production available_qty)',
      reorder_point_policy: { reorder_point: LOW_STOCK_THRESHOLD, order_up_to: 2 * LOW_STOCK_THRESHOLD },
      declared_lead_time_days: DEFAULT_LEAD_TIME_DAYS,
      budget_rule: 'per review = min(total cost of REORDER_POINT, total cost of MA30_FIXED_LT) / number of reviews, same scenario',
      variants: world.variants.length,
    },
    scenarios: scenarioRows,
    policies,
    ablation: ablationRows,
    per_variant_base: perVariant,
    timeline_example: timeline,
  };
}

module.exports = { WARM_UP_DAYS, REVIEW_PERIOD_DAYS, STEADY_STATE_OFFSET_DAYS, scenarios, runReorderBacktest };
