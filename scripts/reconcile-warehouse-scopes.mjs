// One-time alignment of auth_db.user_warehouse_scopes with the real warehouse
// ids of an EXISTING inventory database.
//
// Why: the auth seed scopes demo users with fixed warehouse ids
// (00000000-...-0002 = WH-HCM-01, ...-0003 = WH-HN-01, ...-0004 = BR-HCM-01).
// Databases seeded before inventory-service created warehouses with those same
// ids have random warehouse ids, so every scope row pointed nowhere. That was
// invisible while the scope check failed open; it is fail-closed now, so the
// rows must point at the real warehouses (matched by warehouse code).
//
// Idempotent; only rewrites rows still carrying a placeholder id, and brings the
// demo manager (manager01) from READ to FULL like the current seed. Runs as part
// of `pnpm demo:upgrade`.
//
// Node rather than bash so it works the same from PowerShell, cmd, or bash (on
// Windows `bash` can resolve to WSL) — same approach as seed-catalog-enrichment.mjs.
// Usage: node scripts/reconcile-warehouse-scopes.mjs   (stack running via docker compose)
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");

function readEnvVar(name, fallback) {
  if (!existsSync(envPath)) return fallback;
  const contents = readFileSync(envPath, "utf8");
  const match = contents.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : fallback;
}

const dbUser = readEnvVar("DB_USER", "user");
const inventoryDb = readEnvVar("INVENTORY_DB_NAME", "inventory_db");
const authDb = readEnvVar("AUTH_DB_NAME", "auth_db");

function psql(database, sql) {
  const result = spawnSync(
    "docker",
    ["compose", "exec", "-T", "db", "psql", "-U", dbUser, "-d", database, "-v", "ON_ERROR_STOP=1", "-tA", "-c", sql],
    { cwd: root, encoding: "utf8" },
  );
  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

const PLACEHOLDER = {
  "WH-HCM-01": "00000000-0000-0000-0000-000000000002",
  "WH-HN-01": "00000000-0000-0000-0000-000000000003",
  "BR-HCM-01": "00000000-0000-0000-0000-000000000004",
};

for (const [code, placeholder] of Object.entries(PLACEHOLDER)) {
  const realId = psql(inventoryDb, `SELECT id FROM warehouses WHERE code = '${code}'`);
  if (!realId) {
    console.error(`skip ${code}: no such warehouse in ${inventoryDb}`);
    continue;
  }
  if (realId === placeholder) {
    console.log(`${code}: already uses the seeded id`);
    continue;
  }
  const updated = psql(authDb, `WITH moved AS (
      UPDATE user_warehouse_scopes s SET warehouse_id = '${realId}'
      WHERE s.warehouse_id = '${placeholder}'
        AND NOT EXISTS (SELECT 1 FROM user_warehouse_scopes t WHERE t.user_id = s.user_id AND t.warehouse_id = '${realId}')
      RETURNING 1) SELECT count(*) FROM moved`);
  console.log(`${code}: ${updated} scope row(s) ${placeholder} -> ${realId}`);
}

const promoted = psql(authDb, `WITH up AS (
    UPDATE user_warehouse_scopes s SET access_level = 'FULL'
    FROM users u WHERE u.id = s.user_id AND u.username = 'manager01' AND s.access_level = 'READ'
    RETURNING 1) SELECT count(*) FROM up`);
console.log(`manager01: ${promoted} READ row(s) -> FULL`);
