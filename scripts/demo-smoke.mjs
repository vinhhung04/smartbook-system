import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const flows = [
  "rbac-role-access-integration.mjs",
  "purchase-supplier-receiving-integration.mjs",
  "borrow-phase2-integration.mjs",
];

for (const flow of flows) {
  console.log(`\n=== ${flow} ===`);
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, flow)], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log("\nAll three SmartBook demo flows passed.");
