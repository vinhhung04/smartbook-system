import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  NATURAL_KEYS,
  parseInsertRows,
  remapCatalogIds,
} from '../scripts/lib/catalog-enrichment-remap.mjs';

const readSeed = (service) =>
  readFile(new URL(`../services/${service}/prisma/seed.js`, import.meta.url), 'utf8');

test('demo seeds include representative cross-service enrichment scenarios', async () => {
  const [auth, inventory, borrow] = await Promise.all([
    readSeed('auth-service'),
    readSeed('inventory-service'),
    readSeed('borrow-service'),
  ]);

  assert.match(auth, /curator01/);
  assert.match(inventory, /BK-EXT-001/);
  assert.match(inventory, /PO-EXT-001/);
  assert.match(inventory, /GR-EXT-001/);
  assert.match(inventory, /MOV-EXT-001/);
  assert.match(inventory, /READY_FOR_PUTAWAY/);
  assert.match(inventory, /SUP-DEL-EXT-001/);
  assert.match(inventory, /OUT-EXT-001/);
  assert.match(inventory, /TR-EXT-001/);
  assert.match(inventory, /AUD-EXT-001/);
  assert.match(inventory, /PUR-REQ-EXT-001/);
  assert.match(inventory, /EXC-EXT-001/);
  assert.match(inventory, /Chuẩn bị khu vực xuất hàng/);
  assert.match(borrow, /CUST-EXT-001/);
  assert.match(borrow, /LOAN-EXT-OVERDUE/);
  assert.match(borrow, /PAYMENT-EXT-WALLET/);
});

test('every audited operational queue route has a representative inventory seed', async () => {
  const [routes, inventory] = await Promise.all([
    readFile(new URL('../apps/web/src/app/routes.ts', import.meta.url), 'utf8'),
    readSeed('inventory-service'),
  ]);

  const requiredCoverage = [
    ['supplier-deliveries', 'SUP-DEL-EXT-001'],
    ['picking', 'OUT-EXT-001'],
    ['packing', 'PACK-EXT-001'],
    ['outbound', 'OUT-EXT-001'],
    ['transfer-receiving', 'TR-EXT-001'],
    ['stock-audits', 'AUD-EXT-001'],
    ['purchase-requests', 'PUR-REQ-EXT-001'],
    ['exception-reports', 'EXC-EXT-001'],
    ['staff-tasks', 'Chuẩn bị khu vực xuất hàng'],
  ];

  for (const [route, seedMarker] of requiredCoverage) {
    assert.match(routes, new RegExp(`path: ["']${route}["']`));
    assert.match(inventory, new RegExp(seedMarker));
  }
});

// The enrichment dump re-includes rows the base `prisma db seed` already creates,
// under the dev database's random ids. authors.full_name, books.book_code, etc. are
// unique, so those inserts hit ON CONFLICT DO NOTHING and the dump's ids never
// exist - every child row (book_authors, book_categories, book_variants) that
// still names them then fails its foreign key. remapCatalogIds points them at the
// ids that really exist.

const enrichmentSeed = () =>
  readFile(new URL('../data/smartbook_catalog_enrichment_seed.sql', import.meta.url), 'utf8');

const insert = (table, values) =>
  `INSERT INTO public.${table} (${Object.keys(values).join(', ')}) VALUES (${Object.values(values)
    .map((v) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replaceAll("'", "''")}'`))
    .join(', ')}) ON CONFLICT DO NOTHING;`;

test('parseInsertRows reads quoted values, escaped quotes, commas and NULL', () => {
  const [row] = parseInsertRows(
    insert('authors', { id: 'a-1', full_name: "O'Brien, Tim (ed.)", biography: null }),
  );
  assert.equal(row.table, 'authors');
  assert.deepEqual(row.values, { id: 'a-1', full_name: "O'Brien, Tim (ed.)", biography: null });
});

test('remapCatalogIds points child rows at the id that already exists for the same natural key', () => {
  const sql = [
    insert('authors', { id: 'dump-nam-cao', full_name: 'Nam Cao' }),
    insert('authors', { id: 'dump-new', full_name: 'Someone New' }),
    insert('book_authors', { book_id: 'b-1', author_id: 'dump-nam-cao', author_order: 1 }),
    insert('book_authors', { book_id: 'b-1', author_id: 'dump-new', author_order: 2 }),
  ].join('\n');

  const { sql: out, remapped } = remapCatalogIds(sql, {
    authors: [{ id: 'seeded-nam-cao', full_name: 'Nam Cao' }],
  });

  assert.deepEqual([...remapped], [['dump-nam-cao', 'seeded-nam-cao']]);
  assert.doesNotMatch(out, /dump-nam-cao/);
  assert.match(out, /'b-1', 'seeded-nam-cao', 1/);
  assert.match(out, /'b-1', 'dump-new', 2/); // no collision: untouched
});

test('remapCatalogIds matches on any unique column and is a no-op once ids agree', () => {
  const variant = insert('book_variants', { id: 'v-dump', sku: 'SKU-OTHER', isbn13: '9780000000002' });
  const byIsbn = remapCatalogIds(variant, {
    book_variants: [{ id: 'v-real', sku: 'SKU-REAL', isbn13: '9780000000002' }],
  });
  assert.deepEqual([...byIsbn.remapped], [['v-dump', 'v-real']]);

  const settled = remapCatalogIds(variant, {
    book_variants: [{ id: 'v-dump', sku: 'SKU-OTHER', isbn13: '9780000000002' }],
  });
  assert.equal(settled.remapped.size, 0);
  assert.equal(settled.sql, variant);
});

test('every parent id the enrichment dump references is defined in the dump itself', async () => {
  const rows = parseInsertRows(await enrichmentSeed());
  const defined = (table) => new Set(rows.filter((r) => r.table === table).map((r) => r.values.id));
  const [books, authors, categories, publishers] = ['books', 'authors', 'categories', 'publishers'].map(defined);

  const dangling = [];
  for (const { table, values } of rows) {
    const refs = {
      book_authors: [['book_id', books], ['author_id', authors]],
      book_categories: [['book_id', books], ['category_id', categories]],
      book_variants: [['book_id', books]],
      books: [['publisher_id', publishers]],
    }[table] ?? [];
    for (const [column, ids] of refs) {
      if (values[column] && !ids.has(values[column])) dangling.push(`${table}.${column}=${values[column]}`);
    }
  }
  assert.deepEqual(dangling, []);
});

test('remapping the real dump onto an already-seeded catalog leaves no dump id behind', async () => {
  const seed = await enrichmentSeed();
  const rows = parseInsertRows(seed);

  // Pretend every row already exists under a different (random-looking) id.
  const existing = {};
  for (const [table, keys] of Object.entries(NATURAL_KEYS)) {
    existing[table] = rows
      .filter((r) => r.table === table)
      .map((r, i) => ({ ...Object.fromEntries(keys.map((k) => [k, r.values[k]])), id: `existing-${table}-${i}` }));
  }

  const { sql, remapped } = remapCatalogIds(seed, existing);
  // Rows with every natural key NULL (AI-imported books have no book_code) cannot collide.
  const expected = rows.filter(
    (r) => r.table in NATURAL_KEYS && NATURAL_KEYS[r.table].some((k) => r.values[k] != null),
  ).length;
  assert.equal(remapped.size, expected);
  for (const dumpId of remapped.keys()) assert.ok(!sql.includes(dumpId), `${dumpId} survived remapping`);
});

