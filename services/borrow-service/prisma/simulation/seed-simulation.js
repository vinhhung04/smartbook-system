/**
 * SmartBook — persona-conditioned synthetic behavioural dataset: CLI + DB loader.
 *
 * THIS IS A SIMULATION, NOT REAL DATA. See docs/SYNTHETIC_BEHAVIOR_DATASET.md.
 *
 * USAGE (from services/borrow-service):
 *   node prisma/simulation/seed-simulation.js              generate, validate, write borrow_db
 *   node prisma/simulation/seed-simulation.js --dry-run    generate + validate + evaluate, no DB
 *   node prisma/seed-history.js                            same as the first line (legacy entry point)
 *
 * ENV: SIMULATION_SEED (alias HISTORY_SEED), CUSTOMER_COUNT, SIMULATION_MONTHS,
 *      SIMULATION_END, INVENTORY_DATABASE_URL (optional: re-map catalog ids by
 *      sku/book_code against a live inventory_db whose ids differ from the manifest).
 *
 * IDEMPOTENCE: every row carries a SIM- natural-key prefix (customer_code,
 * card_number, loan_number, reservation_number) or belongs to a SIM- customer.
 * Each run deletes SIM- rows and legacy HIST- rows (from the previous
 * single-trait generator) and regenerates. Hand-written demo data (CUST-,
 * LOAN-, RSV-, CARD-) is never touched.
 *
 * OUTPUTS (prisma/simulation/): simulation-truth.json, simulation-report.json,
 * simulation-report.md, output/recommendation-eval-input.json; plus the
 * backward-compatible prisma/seed-history-truth.json.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { DEFAULTS, SIM_PREFIX, LEGACY_PREFIX } = require('./config');
const { buildCatalog, remapCatalog } = require('./catalog');
const { generateDataset } = require('./simulate');
const { validateDataset } = require('./validation');
const { evaluateAll, recommendationEvalInput } = require('./evaluation');
const { buildTruth, legacyTruth, provenance } = require('./truth');
const { renderMarkdown } = require('./report');

const OUT_DIR = __dirname;
const EVAL_DIR = path.join(__dirname, 'output');
const AI_EVAL_SCRIPT = path.resolve(__dirname, '../../../ai-service/eval/eval_recommendation_synthetic.py');

const SIM_PREFIXES = [SIM_PREFIX, LEGACY_PREFIX];

// Deletes every generator-owned row, children first. Scoped strictly by the
// SIM-/HIST- prefixes, so hand-written demo rows survive.
async function deleteSimulationRows(prisma) {
  for (const prefix of SIM_PREFIXES) {
    const simCustomer = { customer_code: { startsWith: prefix } };
    await prisma.fine_payments.deleteMany({ where: { fines: { customers: simCustomer } } });
    await prisma.fines.deleteMany({ where: { customers: simCustomer } });
    await prisma.loan_renewals.deleteMany({ where: { loan_items: { loan_transactions: { loan_number: { startsWith: prefix } } } } });
    await prisma.loan_items.deleteMany({ where: { loan_transactions: { loan_number: { startsWith: prefix } } } });
    await prisma.loan_transactions.deleteMany({ where: { loan_number: { startsWith: prefix } } });
    await prisma.loan_reservations.deleteMany({ where: { reservation_number: { startsWith: prefix } } });
    await prisma.book_reviews.deleteMany({ where: { customers: simCustomer } });
    await prisma.book_wishlists.deleteMany({ where: { customers: simCustomer } });
    await prisma.availability_alerts.deleteMany({ where: { customers: simCustomer } });
    await prisma.customer_memberships.deleteMany({ where: { card_number: { startsWith: prefix } } });
    await prisma.customers.deleteMany({ where: simCustomer });
  }
}

async function insertInChunks(model, rows, chunkSize = 1000) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await model.createMany({ data: rows.slice(i, i + chunkSize) });
  }
}

// FK order: parents first.
const INSERT_ORDER = [
  'customers', 'customer_memberships', 'loan_reservations', 'loan_transactions', 'loan_items',
  'loan_renewals', 'fines', 'fine_payments', 'book_wishlists', 'book_reviews', 'availability_alerts',
];

async function remapFromInventory(catalog, url) {
  const { PrismaClient } = require('@prisma/client');
  const inventory = new PrismaClient({ datasources: { db: { url } } });
  try {
    const variants = await inventory.$queryRawUnsafe('SELECT id::text AS id, sku FROM book_variants');
    const books = await inventory.$queryRawUnsafe('SELECT id::text AS id, book_code FROM books');
    const warehouses = await inventory.$queryRawUnsafe("SELECT id::text AS id FROM warehouses WHERE is_active ORDER BY code");
    return remapCatalog(catalog, {
      variantIdBySku: new Map(variants.map((v) => [v.sku, v.id])),
      bookIdByCode: new Map(books.filter((b) => b.book_code).map((b) => [b.book_code, b.id])),
      liveBookIds: new Set(books.map((b) => b.id)),
      warehouseIds: warehouses.map((w) => w.id),
    });
  } finally {
    await inventory.$disconnect();
  }
}

// Runs the production recommender (ai-service/recommendation.py) over the
// hold-out input, if Python and the ai-service sources are available.
function productionRankings(inputPath) {
  if (!fs.existsSync(AI_EVAL_SCRIPT)) return { rankings: null, note: 'ai-service not found - production ranker skipped' };
  const outPath = path.join(EVAL_DIR, 'recommendation-rankings.json');
  for (const python of ['python', 'python3']) {
    const res = spawnSync(python, [AI_EVAL_SCRIPT, inputPath, outPath], { encoding: 'utf8' });
    if (res.status === 0) {
      return { rankings: new Map(Object.entries(JSON.parse(fs.readFileSync(outPath, 'utf8')))), note: res.stdout.trim() };
    }
  }
  return { rankings: null, note: 'python not available or ranker failed - production ranker skipped' };
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const skipEvaluation = argv.includes('--no-evaluate');
  const seed = DEFAULTS.seed;
  let prisma = null;
  try {
    await run({ dryRun, skipEvaluation, seed, setPrisma: (p) => { prisma = p; } });
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

async function run({ dryRun, skipEvaluation, seed, setPrisma }) {
  let prisma = null;
  let plans;
  const catalog = buildCatalog(seed);

  if (!dryRun) {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient();
    setPrisma(prisma);
    plans = await prisma.membership_plans.findMany({ where: { is_active: true } });
    if (!plans.length) throw new Error('No membership_plans found - run the base seed first (pnpm demo:seed).');
    if (process.env.INVENTORY_DATABASE_URL) {
      const unresolved = await remapFromInventory(catalog, process.env.INVENTORY_DATABASE_URL);
      console.log(`[simulation] catalog re-mapped against inventory_db; unresolved books=${unresolved.books.length} variants=${unresolved.variants.length}`);
    }
  }

  console.log(`[simulation] seed=${seed} customers=${DEFAULTS.customerCount} months=${DEFAULTS.months} end=${DEFAULTS.end.toISOString()}${dryRun ? ' (dry run)' : ''}`);
  const t0 = Date.now();
  const dataset = generateDataset({ seed, customerCount: DEFAULTS.customerCount, months: DEFAULTS.months, end: DEFAULTS.end, plans, catalog });
  console.log(`[simulation] generated in ${Date.now() - t0} ms:`, JSON.stringify(Object.fromEntries(Object.entries(dataset.tables).map(([k, v]) => [k, v.length]))));

  const validation = validateDataset(dataset);
  if (!validation.sanity.passed) {
    throw new Error(`sanity checks failed: ${validation.sanity.failed.join(', ')} - nothing written`);
  }
  console.log('[simulation] all sanity checks passed');

  if (prisma) {
    console.log('[simulation] deleting SIM-/HIST- rows...');
    await deleteSimulationRows(prisma);
    for (const table of INSERT_ORDER) await insertInChunks(prisma[table], dataset.tables[table]);
    console.log('[simulation] inserted into borrow_db');
  }

  const truth = buildTruth(dataset);
  writeJson(path.join(OUT_DIR, 'simulation-truth.json'), truth);
  writeJson(path.join(__dirname, '..', 'seed-history-truth.json'), legacyTruth(dataset, truth));

  let evaluation = null;
  if (!skipEvaluation) {
    fs.mkdirSync(EVAL_DIR, { recursive: true });
    const inputPath = path.join(EVAL_DIR, 'recommendation-eval-input.json');
    writeJson(inputPath, recommendationEvalInput(dataset));
    const prod = productionRankings(inputPath);
    console.log(`[simulation] ${prod.note}`);
    evaluation = evaluateAll(dataset, { productionRankings: prod.rankings });
  }

  const report = {
    provenance: provenance(dataset),
    generated_at: new Date().toISOString(),
    generator_counters: dataset.counters,
    validation,
    evaluation,
  };
  writeJson(path.join(OUT_DIR, 'simulation-report.json'), report);
  fs.writeFileSync(path.join(OUT_DIR, 'simulation-report.md'), renderMarkdown(report));
  console.log(`[simulation] bayes_auc_late=${truth.generative_processes.bayes_auc_late} bayes_auc_no_show=${truth.generative_processes.bayes_auc_no_show}`);
  console.log('[simulation] wrote simulation-truth.json, simulation-report.{json,md}, ../seed-history-truth.json');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[simulation] failed', error);
    process.exitCode = 1;
  });
}

module.exports = { main, deleteSimulationRows, SIM_PREFIXES, INSERT_ORDER };
