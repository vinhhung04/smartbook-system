// Guards around the simulation's inputs and outputs:
//  - the committed catalog manifest must match the real inventory catalog dump;
//  - no production service code may read the simulation ground truth.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildManifest, SQL_PATH } = require('../prisma/simulation/build-catalog-manifest');
const manifest = require('../prisma/simulation/catalog-manifest.json');

test('catalog-manifest.json is in sync with data/smartbook_catalog_enrichment_seed.sql', { skip: !fs.existsSync(SQL_PATH) && 'catalog SQL not present (container build)' }, () => {
  assert.deepEqual(buildManifest(fs.readFileSync(SQL_PATH, 'utf8')), manifest);
});

test('catalog manifest has unique ids and every book has a borrowable variant', () => {
  const variantIds = manifest.books.flatMap((b) => b.variants.map((v) => v.id));
  assert.equal(new Set(variantIds).size, variantIds.length);
  assert.equal(new Set(manifest.books.map((b) => b.id)).size, manifest.books.length);
  assert.ok(manifest.books.every((b) => b.variants.length > 0 && b.categories.length > 0));
});

function sourceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(js|ts|tsx|py)$/.test(e.name) ? [p] : [];
  });
}

test('no production service source reads the simulation truth (leakage guard)', () => {
  const services = path.resolve(__dirname, '../..');
  const offenders = [];
  for (const svc of fs.readdirSync(services)) {
    const roots = [path.join(services, svc, 'src')];
    if (svc === 'ai-service') roots.push(path.join(services, svc)); // flat layout; eval/ is excluded below
    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        if (file.includes(`${path.sep}eval${path.sep}`) || /test_|\.test\./.test(path.basename(file))) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (/simulation-truth|prisma[\\/]simulation/.test(text)) offenders.push(file);
      }
    }
  }
  assert.deepEqual(offenders, []);
});
