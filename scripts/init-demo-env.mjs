import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, ".env");
const force = process.argv.includes("--force");

if (existsSync(target) && !force) {
  console.error(".env already exists. Use --force only when you intend to rotate local demo secrets.");
  process.exit(1);
}

const secret = (bytes = 36) => randomBytes(bytes).toString("base64url");
const databasePassword = secret(24);
const replacements = {
  GENERATE_POSTGRES_PASSWORD: databasePassword,
  GENERATE_ANALYTICS_PASSWORD: secret(24),
  GENERATE_JWT_SECRET: secret(48),
  GENERATE_INTERNAL_KEY: secret(48),
  GENERATE_PGADMIN_PASSWORD: secret(24),
};

let contents = readFileSync(resolve(root, ".env.example"), "utf8");
for (const [placeholder, value] of Object.entries(replacements)) {
  contents = contents.replaceAll(placeholder, value);
}
writeFileSync(target, contents, { encoding: "utf8", flag: force ? "w" : "wx" });
console.log("Created .env with random local-only secrets.");
