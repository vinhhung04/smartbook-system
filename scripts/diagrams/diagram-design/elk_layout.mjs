// Read an ELK JSON graph on stdin, write the laid-out graph on stdout.
// ELK only computes geometry (positions, orthogonal routes); rendering stays in the SmartBook generators.
// elkjs ships with mermaid in this workspace (node_modules/.pnpm/elkjs@*/...).
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const store = join(root, "node_modules", ".pnpm");
const pkg = readdirSync(store).find((d) => d.startsWith("elkjs@"));
if (!pkg) throw new Error("elkjs not found under node_modules/.pnpm");
const require = createRequire(import.meta.url);
const ELK = require(join(store, pkg, "node_modules", "elkjs", "lib", "elk.bundled.js"));

const graph = JSON.parse(readFileSync(0, "utf8"));
const out = await new ELK().layout(graph);
process.stdout.write(JSON.stringify(out));
