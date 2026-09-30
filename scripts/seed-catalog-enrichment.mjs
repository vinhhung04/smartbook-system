// Applies data/smartbook_catalog_enrichment_seed.sql (real book metadata + real
// cover_image_url values accumulated during development via the "Nhap bang AI"
// ISBN-lookup flow) against the running inventory_db. Idempotent (every INSERT
// uses ON CONFLICT DO NOTHING) — safe to run after every `pnpm demo:seed`,
// including on a freshly reset database. Without this, the "Tim sach bang anh
// bia" cover-search feature has an empty image gallery to match against.
//
// Cross-platform (Node, no shell-specific env-var syntax) so it works the same
// from PowerShell, cmd, or bash — mirrors scripts/init-demo-env.mjs's approach
// of reading .env directly instead of relying on the invoking shell to export it.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { existingRowsQuery, remapCatalogIds } from "./lib/catalog-enrichment-remap.mjs";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env");
const seedPath = resolve(root, "data", "smartbook_catalog_enrichment_seed.sql");

function readEnvVar(name, fallback) {
  if (!existsSync(envPath)) return fallback;
  const contents = readFileSync(envPath, "utf8");
  const match = contents.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim() : fallback;
}

const dbUser = readEnvVar("DB_USER", "user");
const dbName = readEnvVar("INVENTORY_DB_NAME", "inventory_db");
const psqlArgs = ["compose", "exec", "-T", "db", "psql", "-U", dbUser, "-d", dbName, "-v", "ON_ERROR_STOP=1"];

// The dump was taken from a different database than the one `prisma db seed` just
// filled, so the rows they share carry different ids (see lib/catalog-enrichment-remap.mjs).
// Re-point the dump at the ids that actually exist before applying it.
const existing = spawnSync("docker", [...psqlArgs, "-At", "-c", existingRowsQuery()], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (existing.error || existing.status !== 0) {
  console.error(existing.error?.message ?? existing.stderr);
  process.exit(existing.status ?? 1);
}
const { sql, remapped } = remapCatalogIds(readFileSync(seedPath, "utf8"), JSON.parse(existing.stdout));

console.log(`Seeding catalog enrichment data into ${dbName} as ${dbUser} (${remapped.size} ids remapped onto existing rows)...`);
const result = spawnSync("docker", psqlArgs, { cwd: root, input: sql, stdio: ["pipe", "inherit", "inherit"] });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
