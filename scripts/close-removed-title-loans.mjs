// Cleans borrow_db up after titles were removed from the catalog
// (data/smartbook_borrow_removed_titles.sql): closes their loan lines still out,
// waives the fines still owed on them, drops wishlists / reviews / availability
// alerts of those books, and recomputes every reader's fine balance.
//
// borrow_db cannot see inventory_db, so this reads every variant and book id
// that still exists in inventory_db and hands them to the SQL, in the same
// transaction, as the temp tables sb_live_variants / sb_live_books. Anything
// pointing at an id outside those lists belongs to a removed title. Idempotent —
// safe after every `pnpm demo:seed` / `demo:upgrade` / `demo:seed:history`.
// `--dry-run` reports what would change and rolls back.
//
// Cross-platform (Node, reads .env directly) like scripts/seed-catalog-enrichment.mjs.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");
const sqlPath = resolve(root, "data", "smartbook_borrow_removed_titles.sql");
// A catalog this small means inventory_db was not seeded (or the query failed):
// every loan would look like it belongs to a removed title, so refuse to run.
const MIN_LIVE_ROWS = 20;
const dryRun = process.argv.includes("--dry-run");

function readEnvVar(name, fallback) {
  if (!existsSync(envPath)) return fallback;
  const match = readFileSync(envPath, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  return match && match[1].trim() ? match[1].trim() : fallback;
}

const dbUser = readEnvVar("DB_USER", "user");
const inventoryDb = readEnvVar("INVENTORY_DB_NAME", "inventory_db");
const borrowDb = readEnvVar("BORROW_DB_NAME", "borrow_db");
const psql = (db, extra = []) => ["compose", "exec", "-T", "db", "psql", "-U", dbUser, "-d", db, "-v", "ON_ERROR_STOP=1", ...extra];

function liveIds(table) {
  const live = spawnSync("docker", [...psql(inventoryDb, ["-At", "-c", `SELECT id FROM ${table}`])], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (live.error || live.status !== 0) {
    console.error(live.error?.message ?? live.stderr);
    process.exit(live.status ?? 1);
  }
  const ids = live.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[0-9a-f-]{36}$/i.test(line));
  if (ids.length < MIN_LIVE_ROWS) {
    console.error(`Only ${ids.length} rows in ${inventoryDb}.${table}; refusing to clean borrow data against an unseeded catalog.`);
    process.exit(1);
  }
  return ids;
}

const variantIds = liveIds("book_variants");
const bookIds = liveIds("books");
const values = (ids) => ids.map((id) => `('${id}')`).join(",\n");

const sql = [
  "BEGIN;",
  "CREATE TEMP TABLE sb_live_variants (id uuid PRIMARY KEY) ON COMMIT DROP;",
  `INSERT INTO sb_live_variants (id) VALUES\n${values(variantIds)};`,
  "CREATE TEMP TABLE sb_live_books (id uuid PRIMARY KEY) ON COMMIT DROP;",
  `INSERT INTO sb_live_books (id) VALUES\n${values(bookIds)};`,
  readFileSync(sqlPath, "utf8"),
  dryRun ? "ROLLBACK;" : "COMMIT;",
].join("\n");

console.log(`${dryRun ? "[dry run] " : ""}Cleaning ${borrowDb} after removed titles (${bookIds.length} books / ${variantIds.length} variants still in the catalog)...`);
const run = spawnSync("docker", [...psql(borrowDb, ["-q", "-P", "footer=off"])], {
  cwd: root,
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
});
if (run.error) {
  console.error(run.error.message);
  process.exit(1);
}
process.exit(run.status ?? 1);
