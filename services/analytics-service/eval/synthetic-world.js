// Loads the persona-conditioned SYNTHETIC dataset (services/borrow-service/
// prisma/simulation) into the shapes the offline evaluations need. Nothing
// here is real user data - see docs/SYNTHETIC_BEHAVIOR_DATASET.md.
//
// Two views of the same seeded population are used, for two different questions:
//
//  * observedDataset - the dataset that is written to borrow_db (generateDataset).
//    Its loans are what the production forecast reads, so the forecast-model
//    comparison runs on it (same series as GET /analytics/forecast-accuracy).
//
//  * demandWorld - the simulator's own *pilot* run of the same population with
//    unlimited stock (runSimulation({ copies: null })). Its loans are every
//    borrow request the population makes, before any stock-out censors it.
//    An inventory backtest needs exactly that: when a policy holds more copies
//    than the simulator did, requests the simulator turned away must still be
//    there to be served. The library's starting collection is the simulator's
//    own calibration from that pilot (calibrateCopies), i.e. the copies the
//    observed dataset was generated with.
//
// The simulation's latent truth (personas, traits, preferences,
// simulation-truth.json) is never read here.

const fs = require('fs');
const path = require('path');

const SIMULATION_DIR = path.resolve(__dirname, '../../borrow-service/prisma/simulation');
const DAY_MS = 24 * 60 * 60 * 1000;

function simulationModules() {
  return {
    config: require(path.join(SIMULATION_DIR, 'config.js')),
    catalog: require(path.join(SIMULATION_DIR, 'catalog.js')),
    simulate: require(path.join(SIMULATION_DIR, 'simulate.js')),
    manifestBuilder: require(path.join(SIMULATION_DIR, 'build-catalog-manifest.js')),
    random: require(path.join(SIMULATION_DIR, 'random.js')),
  };
}

function simulationOptions(overrides = {}) {
  const { config } = simulationModules();
  const end = overrides.end ?? config.DEFAULTS.end;
  const months = overrides.months ?? config.DEFAULTS.months;
  return {
    seed: overrides.seed ?? config.DEFAULTS.seed,
    customerCount: overrides.customerCount ?? config.DEFAULTS.customerCount,
    months,
    end,
    // Same derivation as generateDataset().
    windowStart: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months, end.getUTCDate())),
    plans: config.FALLBACK_PLANS.map((p) => ({ id: `FALLBACK-${p.code}`, ...p })),
  };
}

function provenance(options) {
  const { config } = simulationModules();
  return {
    synthetic: true,
    disclaimer_vi: 'Dữ liệu tổng hợp mô phỏng hành vi người dùng, không phải dữ liệu thu thập từ người dùng thực tế.',
    disclaimer_en: 'Synthetic data from a behavioural simulation. Not collected from real users.',
    generator: 'services/borrow-service/prisma/simulation',
    generator_version: config.GENERATOR_VERSION,
    seed: options.seed,
    customer_count: options.customerCount,
    simulation_start: options.windowStart.toISOString(),
    simulation_end: options.end.toISOString(),
  };
}

// unit_cost per variant from the same catalog SQL the inventory DB is seeded with.
function unitCostByVariant() {
  const { manifestBuilder } = simulationModules();
  const sql = fs.readFileSync(manifestBuilder.SQL_PATH, 'utf8');
  return new Map(manifestBuilder.parseInserts(sql, 'book_variants').map((row) => [row.id, Number(row.unit_cost)]));
}

function observedDataset(overrides = {}) {
  const { simulate, catalog } = simulationModules();
  const options = simulationOptions(overrides);
  const dataset = simulate.generateDataset({ ...options, catalog: catalog.buildCatalog(options.seed) });
  return { options, dataset };
}

const TERMINAL_RESERVATION = new Set(['CANCELLED', 'EXPIRED', 'CONVERTED_TO_LOAN']);

function buildDemandWorld(overrides = {}) {
  const { simulate, catalog: catalogModule } = simulationModules();
  const options = simulationOptions(overrides);
  const catalog = catalogModule.buildCatalog(options.seed);
  const pilot = simulate.runSimulation({ ...options, catalog, copies: null });
  const copies = simulate.calibrateCopies(pilot, catalog, options.windowStart, options.end, options.seed);
  const costs = unitCostByVariant();

  const borrowAt = new Map(pilot.tables.loan_transactions.map((l) => [l.id, l.borrow_date.getTime()]));
  const requestsByVariant = new Map();
  for (const item of pilot.tables.loan_items) {
    if (!requestsByVariant.has(item.variant_id)) requestsByVariant.set(item.variant_id, []);
    requestsByVariant.get(item.variant_id).push({
      at: borrowAt.get(item.loan_id),
      returnAt: item.return_date ? item.return_date.getTime() : null,
    });
  }

  // Reservation is "active" from reserved_at until its terminal transition
  // (updated_at of a CANCELLED / EXPIRED / CONVERTED_TO_LOAN row), which is what
  // production's status filter sees at that moment.
  const reservationsByVariant = new Map();
  for (const r of pilot.tables.loan_reservations) {
    if (!reservationsByVariant.has(r.variant_id)) reservationsByVariant.set(r.variant_id, []);
    reservationsByVariant.get(r.variant_id).push({
      reservedAt: r.reserved_at.getTime(),
      endAt: TERMINAL_RESERVATION.has(r.status) ? r.updated_at.getTime() : null,
    });
  }

  // Wishlist rows are hard-deleted by the DB once borrowed; the simulator keeps
  // removed_at in memory, so the list can be reconstructed as of any moment.
  const wishlistsByBook = new Map();
  for (const customer of pilot.customers) {
    for (const [bookId, w] of customer.wishlist) {
      if (!wishlistsByBook.has(bookId)) wishlistsByBook.set(bookId, []);
      wishlistsByBook.get(bookId).push({ createdAt: w.created_at.getTime(), removedAt: w.removed_at ? w.removed_at.getTime() : null });
    }
  }

  const variants = catalog.books.flatMap((book) => book.variants.map((v) => ({
    variantId: v.id,
    bookId: book.id,
    title: book.title,
    unitCost: costs.get(v.id),
    calibratedCopies: copies.get(v.id),
    requests: (requestsByVariant.get(v.id) || []).sort((a, b) => a.at - b.at),
    reservations: reservationsByVariant.get(v.id) || [],
  })));
  const missingCost = variants.filter((v) => !(v.unitCost > 0)).map((v) => v.variantId);
  if (missingCost.length) throw new Error(`unit_cost missing for variants: ${missingCost.join(', ')}`);

  return {
    options,
    provenance: provenance(options),
    variants,
    wishlistsByBook,
    copies,
    firstDay: Math.floor(options.windowStart.getTime() / DAY_MS),
    endDay: Math.floor(options.end.getTime() / DAY_MS), // exclusive
  };
}

module.exports = {
  DAY_MS,
  SIMULATION_DIR,
  simulationModules,
  simulationOptions,
  provenance,
  unitCostByVariant,
  observedDataset,
  buildDemandWorld,
};
