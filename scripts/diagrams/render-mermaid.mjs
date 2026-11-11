// Renders Mermaid sources (docs/diagrams/source/**/*.mmd) to SVG + PNG (and PDF with --pdf).
//
//   pnpm diagrams:render                                   # every .mmd under docs/diagrams/source
//   pnpm diagrams:render docs/diagrams/source/sequence/x.mmd
//   pnpm diagrams:render -- --pdf                          # also write PDFs
//
// Output mirrors the source sub-folder: source/sequence/x.mmd -> exports/svg/sequence/x.svg.
// pnpm 10 does not run puppeteer's postinstall, so no Chromium is downloaded; this script
// points puppeteer at an installed Edge/Chrome unless PUPPETEER_EXECUTABLE_PATH is set.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..", "..");
const diagramsDir = join(root, "docs", "diagrams");
const sourceDir = join(diagramsDir, "source");
const exportsDir = join(diagramsDir, "exports");
const configFile = join(diagramsDir, "mermaid.config.json");
// The package only exports "." (src/index.js); the CLI entry sits next to it.
const mmdc = join(dirname(fileURLToPath(import.meta.resolve("@mermaid-js/mermaid-cli"))), "cli.js");

const BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/microsoft-edge",
];

function findMmdFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return findMmdFiles(path);
    return entry.name.endsWith(".mmd") ? [path] : [];
  });
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const withPdf = args.includes("--pdf");
const inputs = args.filter((arg) => !arg.startsWith("--")).map((arg) => resolve(arg));
const files = inputs.length ? inputs : findMmdFiles(sourceDir);

if (!files.length) {
  console.error(`No .mmd files found under ${relative(root, sourceDir)}`);
  process.exit(1);
}

const env = { ...process.env };
if (!env.PUPPETEER_EXECUTABLE_PATH) {
  const browser = BROWSER_CANDIDATES.find((path) => existsSync(path));
  if (browser) env.PUPPETEER_EXECUTABLE_PATH = browser;
}

const formats = [
  { ext: "svg", flags: [] },
  // scale 3 keeps text sharp when the PNG is pasted into Word at page width.
  { ext: "png", flags: ["--scale", "3"] },
  // mmdc fits the PDF page to the diagram unless --pdf-paper-format is given.
  ...(withPdf ? [{ ext: "pdf", flags: [] }] : []),
];

let failed = 0;
for (const file of files) {
  const rel = relative(sourceDir, file);
  const subPath = rel.startsWith("..") ? relative(root, file) : rel;
  const base = subPath.replace(/\.mmd$/, "");
  for (const { ext, flags } of formats) {
    const output = join(exportsDir, ext, `${base}.${ext}`);
    mkdirSync(dirname(output), { recursive: true });
    const result = spawnSync(
      process.execPath,
      [mmdc, "--quiet", "--input", file, "--output", output, "--configFile", configFile, "--backgroundColor", "white", ...flags],
      { cwd: root, env, encoding: "utf8" },
    );
    if (result.status === 0) {
      console.log(`ok   ${relative(root, output)}`);
    } else {
      failed += 1;
      console.error(`FAIL ${relative(root, file)} -> ${ext}\n${(result.stderr || result.stdout || "").trim()}`);
    }
  }
}

process.exit(failed ? 1 : 0);
