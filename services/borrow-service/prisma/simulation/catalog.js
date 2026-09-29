// The book catalog the simulation samples from: the real inventory catalog
// (catalog-manifest.json, built from data/smartbook_catalog_enrichment_seed.sql)
// plus simulation-only latent attributes (popularity prior, quality prior,
// imputed page count) that are recorded in the truth file, never in the DB.

const manifest = require('./catalog-manifest.json');
const { createRng, hashString } = require('./random');
const { POPULARITY, READING } = require('./config');

// Warehouse ids captured from the inventory demo seed (same list the original
// seed-history.js used). A DB run replaces them with live ids when
// INVENTORY_DATABASE_URL is available - see seed-simulation.js.
const FALLBACK_WAREHOUSE_IDS = [
  '7fda99eb-8bf0-4b50-9d64-fe195beb724d',
  'e6f76cd3-26c9-41a7-821f-525ea4639888',
  'd8e151d8-fd15-4477-bbfd-59d10f778ab5',
  '73318a97-5043-4338-b88b-797fa76e51b7',
];

function imputePageCount(book) {
  const [lo, hi] = READING.imputedPagesByCategory[book.categories[0]] || [150, 350];
  const u = hashString(book.id) / 4294967296;
  return Math.round(lo + u * (hi - lo));
}

/**
 * @param {number} seed - simulation seed (drives popularity ranking and quality)
 * @param {object} [source] - manifest-shaped object; defaults to catalog-manifest.json
 */
function buildCatalog(seed, source = manifest) {
  const rng = createRng((seed ^ 0x5eed_ca7a) >>> 0);
  const books = source.books.map((b) => ({
    id: b.id,
    book_code: b.book_code,
    title: b.title,
    categories: b.categories,
    authors: b.authors,
    page_count: b.page_count || imputePageCount(b),
    page_count_imputed: !b.page_count,
    variants: b.variants.map((v) => ({ id: v.id, sku: v.sku })),
  }));

  // Popularity prior: Zipf weight over a seeded permutation of the catalog.
  const order = books.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.forEach((bookIndex, rank) => {
    books[bookIndex].popularity_rank = rank + 1;
    books[bookIndex].popularity = 1 / (rank + 1) ** POPULARITY.zipfExponent;
  });
  // Latent quality (z-score), mildly correlated with popularity.
  const logPops = books.map((b) => Math.log(b.popularity));
  const mean = logPops.reduce((a, b) => a + b, 0) / logPops.length;
  const sd = Math.sqrt(logPops.reduce((a, b) => a + (b - mean) ** 2, 0) / logPops.length) || 1;
  books.forEach((b, i) => {
    b.quality = 0.4 * ((logPops[i] - mean) / sd) + rng.gaussian(0, 0.9);
  });

  const byId = new Map(books.map((b) => [b.id, b]));
  const variantToBook = new Map();
  for (const b of books) for (const v of b.variants) variantToBook.set(v.id, b);
  const booksByCategory = new Map();
  for (const b of books) {
    for (const c of b.categories) {
      if (!booksByCategory.has(c)) booksByCategory.set(c, []);
      booksByCategory.get(c).push(b);
    }
  }
  const categoryName = new Map(source.categories.map((c) => [c.slug, c.name]));

  return {
    books,
    byId,
    variantToBook,
    booksByCategory,
    categoriesPresent: Array.from(booksByCategory.keys()).sort(),
    categoryName,
    warehouseIds: [...FALLBACK_WAREHOUSE_IDS],
  };
}

/**
 * Re-points manifest ids at a live inventory database whose ids differ (the
 * inventory seed upserts the base books by book_code/sku without fixed ids, so
 * a freshly reset environment gets new uuids). Matching is by stable natural
 * keys: variant sku and book_code; a book without a book_code is accepted when
 * its manifest id already exists live. Returns what could not be resolved.
 */
function remapCatalog(catalog, { variantIdBySku, bookIdByCode, liveBookIds, warehouseIds }) {
  const unresolved = { books: [], variants: [] };
  for (const book of catalog.books) {
    const liveBookId = book.book_code ? bookIdByCode.get(book.book_code) : null;
    if (liveBookId) book.id = liveBookId;
    else if (!liveBookIds.has(book.id)) unresolved.books.push(book.book_code || book.id);
    for (const v of book.variants) {
      const liveVariantId = variantIdBySku.get(v.sku);
      if (liveVariantId) v.id = liveVariantId; else unresolved.variants.push(v.sku);
    }
  }
  catalog.byId = new Map(catalog.books.map((b) => [b.id, b]));
  catalog.variantToBook = new Map();
  for (const b of catalog.books) for (const v of b.variants) catalog.variantToBook.set(v.id, b);
  if (warehouseIds && warehouseIds.length) catalog.warehouseIds = [...warehouseIds];
  return unresolved;
}

module.exports = { buildCatalog, remapCatalog, imputePageCount, FALLBACK_WAREHOUSE_IDS };
