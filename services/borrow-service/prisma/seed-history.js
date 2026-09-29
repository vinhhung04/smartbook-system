/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SmartBook — synthetic borrow-history generator (legacy entry point)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This file used to generate the risk-prediction corpus itself (400 customers
 * who differed only in a latent punctuality, loans spread uniformly across
 * customers, books drawn from one global Zipf). It is now a thin wrapper around
 * the unified persona-conditioned behavioural simulation in
 * prisma/simulation/ - so there is exactly ONE synthetic population.
 *
 * Everything that made the old generator valuable is preserved there:
 *   - one seeded PRNG (mulberry32), fixed anchor date -> reproducible dataset;
 *     HISTORY_SEED is still honoured as an alias of SIMULATION_SEED;
 *   - the published logistic late-return and no-show processes (same functional
 *     forms and slope coefficients; intercepts re-calibrated, see config.js);
 *   - Bayes-optimal AUC ceilings, written to prisma/seed-history-truth.json with
 *     the same keys as before (plus simulation/simulation-truth.json);
 *   - enough per-title daily history for the forecast backtest;
 *   - chunked createMany inserts and prefix-scoped idempotent cleanup (new rows
 *     use SIM-; old HIST- rows are removed as legacy on every run).
 *
 * THIS IS A SIMULATION STUDY, NOT REAL DATA - see docs/SYNTHETIC_BEHAVIOR_DATASET.md.
 *
 * USAGE
 *   node prisma/seed-history.js                    (or: npm run prisma:seed-history)
 *   HISTORY_SEED=123 node prisma/seed-history.js   (different draw, still deterministic)
 *   node prisma/seed-history.js --dry-run          (no DB: generate, validate, evaluate)
 */

const { main } = require('./simulation/seed-simulation');

main().catch((error) => {
  console.error('[seed-history] failed', error);
  process.exitCode = 1;
});
