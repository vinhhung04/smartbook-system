// Read model for the anonymous SmartBook website (/public/catalog).
//
// Deliberately NOT built on book.controller's mapBookSummary: that shape is for
// staff and customers behind a JWT and carries unit_cost, list_price, SKU /
// internal barcode and shelf location codes. Everything here is an explicit
// whitelist — a new column on books/book_variants never reaches the public API
// unless it is added below on purpose.

const { RECEIVING_LOCATION_TYPES } = require('../utils/constants');

const ANALYTICS_SERVICE_URL = String(process.env.ANALYTICS_SERVICE_URL || 'http://analytics-service:3006').replace(/\/$/, '');
const INTERNAL_SERVICE_KEY = String(process.env.INTERNAL_SERVICE_KEY || 'smartbook_internal_key').trim();
const SNAPSHOT_TTL_MS = Number(process.env.PUBLIC_CATALOG_CACHE_TTL_MS || 60_000);
const SIGNALS_TTL_MS = Number(process.env.PUBLIC_CATALOG_SIGNALS_TTL_MS || 5 * 60_000);
const SIGNALS_FAILURE_TTL_MS = 30_000;
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 48;
const HOME_SECTION_SIZE = 10;
const TOP_RATED_MIN_REVIEWS = 2;
const SORTS = new Set(['relevance', 'popular', 'newest', 'rating', 'title']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PUBLIC_BOOK_SELECT = {
  id: true,
  title: true,
  subtitle: true,
  description: true,
  edition: true,
  published_date: true,
  page_count: true,
  default_language: true,
  metadata: true,
  created_at: true,
  publishers: { select: { name: true } },
  book_authors: { orderBy: { author_order: 'asc' }, select: { authors: { select: { full_name: true } } } },
  book_categories: { select: { categories: { select: { name: true, slug: true } } } },
  book_variants: {
    where: { is_active: true },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      isbn13: true,
      isbn10: true,
      language_code: true,
      publish_year: true,
      cover_image_url: true,
      is_borrowable: true,
      stock_balances: {
        select: {
          warehouse_id: true,
          available_qty: true,
          on_hand_qty: true,
          locations: { select: { location_type: true } },
          warehouses: { select: { name: true, is_active: true } },
        },
      },
    },
  },
};

const PUBLIC_BOOK_WHERE = { is_active: true };

// Branches (warehouses) as visitors see them: a name and a street address.
// No code, type, manager, settings, locations or capacity — same whitelist rule
// as books. Every active warehouse is a pickup point for reservations.
const PUBLIC_BRANCH_SELECT = {
  id: true,
  name: true,
  address_line1: true,
  address_line2: true,
  ward: true,
  district: true,
  province: true,
};
const BRANCH_FEATURED_SIZE = 12;
const BRANCH_CATEGORY_SIZE = 8;

// Books created as placeholders during receiving ("Chưa có tiêu đề", no author)
// are not ready for readers. Checked in JS: a Prisma NOT on a JSON path would
// also drop every row whose metadata lacks the key (NULL comparison).
function isPublishable(book) {
  return Boolean(book) && !(book.metadata && book.metadata.is_incomplete === true);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function readMetadataString(metadata, key) {
  const value = metadata && typeof metadata === 'object' ? metadata[key] : null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Per-variant shelf stock grouped by branch. Receiving/staging stock is not
 *  reservable yet, so it only feeds the "đang nhập kho" status. */
function summarizeVariantStock(variant) {
  const branches = new Map();
  let available = 0;
  let incoming = 0;
  for (const stock of variant.stock_balances || []) {
    if (stock.warehouses && stock.warehouses.is_active === false) continue;
    if (RECEIVING_LOCATION_TYPES.includes(stock.locations?.location_type)) {
      incoming += Math.max(0, stock.on_hand_qty || 0);
      continue;
    }
    const qty = Math.max(0, stock.available_qty || 0);
    if (qty <= 0) continue;
    available += qty;
    const existing = branches.get(stock.warehouse_id);
    if (existing) existing.available_quantity += qty;
    else branches.set(stock.warehouse_id, { warehouse_id: stock.warehouse_id, warehouse_name: stock.warehouses?.name || 'Thư viện', available_quantity: qty });
  }
  return {
    available,
    incoming,
    branches: Array.from(branches.values()).sort((a, b) => b.available_quantity - a.available_quantity),
  };
}

function toPublicBook(book) {
  const variants = (book.book_variants || []).filter((variant) => variant.is_borrowable !== false);
  const primary = (book.book_variants || [])[0] || null;
  const authors = (book.book_authors || []).map((row) => row.authors?.full_name).filter(Boolean);
  const categories = (book.book_categories || [])
    .map((row) => row.categories)
    .filter((category) => category?.name)
    .map((category) => ({ name: category.name, slug: category.slug }));

  let availableQuantity = 0;
  let incomingQuantity = 0;
  let reserveVariant = null;
  for (const variant of variants) {
    const stock = summarizeVariantStock(variant);
    availableQuantity += stock.available;
    incomingQuantity += stock.incoming;
    // A reservation names one variant + one branch, so offer the edition with
    // the most copies on the shelf and only the branches that hold it.
    if (stock.available > 0 && (!reserveVariant || stock.available > reserveVariant.available)) {
      reserveVariant = { id: variant.id, available: stock.available, branches: stock.branches };
    }
  }

  let availabilityStatus = 'UNAVAILABLE';
  if (availableQuantity > 0) availabilityStatus = 'AVAILABLE';
  else if (incomingQuantity > 0) availabilityStatus = 'INCOMING';

  return {
    id: book.id,
    title: book.title,
    subtitle: book.subtitle || null,
    author: authors[0] || null,
    authors,
    category: categories[0]?.name || null,
    category_slug: categories[0]?.slug || null,
    categories,
    publisher: book.publishers?.name || null,
    isbn: primary?.isbn13 || primary?.isbn10 || null,
    language: primary?.language_code || book.default_language || null,
    publish_year: primary?.publish_year || (book.published_date ? new Date(book.published_date).getUTCFullYear() : null),
    cover_image_url: primary?.cover_image_url || null,
    available_quantity: availableQuantity,
    availability_status: availabilityStatus,
    reservable: Boolean(reserveVariant),
    variant_id: reserveVariant?.id || null,
    pickup_branches: reserveVariant?.branches || [],
    created_at: book.created_at,
  };
}

/** Branches holding a shelf copy of any borrowable edition, lent out or not —
 *  "sách của chi nhánh". What is reservable there now is `pickup_branches`. */
function branchHoldings(book) {
  const held = new Set();
  for (const variant of book.book_variants || []) {
    if (variant.is_borrowable === false) continue;
    for (const stock of variant.stock_balances || []) {
      if (stock.warehouses && stock.warehouses.is_active === false) continue;
      if (RECEIVING_LOCATION_TYPES.includes(stock.locations?.location_type)) continue;
      if ((stock.on_hand_qty || 0) > 0 || (stock.available_qty || 0) > 0) held.add(stock.warehouse_id);
    }
  }
  return held;
}

function toPublicBranch(row) {
  const address = [row.address_line1, row.address_line2, row.ward, row.district, row.province]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(', ');
  return { id: row.id, name: row.name, address: address || null };
}

function toPublicBookDetail(book) {
  return {
    ...toPublicBook(book),
    description: book.description || null,
    summary_vi: readMetadataString(book.metadata, 'summary_vi'),
    page_count: book.page_count || null,
    published_date: book.published_date || null,
    edition: book.edition || null,
  };
}

function signalFields(signal) {
  if (!signal) return null;
  return {
    borrow_count: signal.borrow_count || 0,
    recent_activity: (signal.recent_borrow_count || 0) + (signal.recent_reservation_count || 0) + (signal.recent_wishlist_count || 0),
    rating_avg: signal.rating_avg || 0,
    rating_count: signal.rating_count || 0,
  };
}

function withSignals(book, signalsByBook) {
  return { ...book, signals: signalFields(signalsByBook?.get(book.id)) };
}

const byPopular = (a, b) => (b.signals?.borrow_count || 0) - (a.signals?.borrow_count || 0)
  || (b.signals?.recent_activity || 0) - (a.signals?.recent_activity || 0)
  || (b.signals?.rating_count || 0) - (a.signals?.rating_count || 0)
  || a.title.localeCompare(b.title, 'vi');
const byNewest = (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || a.title.localeCompare(b.title, 'vi');
const byRating = (a, b) => (b.signals?.rating_avg || 0) - (a.signals?.rating_avg || 0)
  || (b.signals?.rating_count || 0) - (a.signals?.rating_count || 0)
  || a.title.localeCompare(b.title, 'vi');
const byTitle = (a, b) => a.title.localeCompare(b.title, 'vi');

function relevanceScore(book, query) {
  const title = normalizeText(book.title);
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 60;
  if (book.authors.some((author) => normalizeText(author).includes(query))) return 40;
  if (normalizeText(book.subtitle).includes(query)) return 30;
  return 10;
}

function matchesQuery(book, query) {
  const haystack = [book.title, book.subtitle, book.publisher, book.isbn, ...book.authors, ...book.categories.map((c) => c.name)]
    .map(normalizeText);
  const terms = query.split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.some((field) => field.includes(term)));
}

function parseCatalogQuery(raw = {}) {
  const page = Math.max(1, Number.parseInt(raw.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(raw.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const q = normalizeText(raw.q || raw.search).slice(0, 120);
  const requestedSort = String(raw.sort || '').toLowerCase();
  const year = Number.parseInt(raw.year, 10);
  // Lets ai-service ground its discovery hits against the live public catalog.
  const ids = String(raw.ids || '').split(',').map((id) => id.trim()).filter((id) => UUID_PATTERN.test(id)).slice(0, MAX_PAGE_SIZE);
  return {
    q,
    ids,
    category: String(raw.category || '').trim().toLowerCase(),
    // Kept even when malformed so the caller can answer "no such branch"
    // instead of silently dropping the filter and listing every book.
    branch: String(raw.branch || '').trim().toLowerCase().slice(0, 64),
    author: normalizeText(raw.author),
    publisher: normalizeText(raw.publisher),
    language: String(raw.language || '').trim().toLowerCase(),
    year: Number.isInteger(year) ? year : null,
    availableOnly: String(raw.availability || '').toLowerCase() === 'available',
    sort: SORTS.has(requestedSort) ? requestedSort : (q ? 'relevance' : 'popular'),
    page,
    pageSize,
  };
}

/** At a branch, "available" means reservable there — the same branches the
 *  book page offers for pickup — so a branch listing never shows a book the
 *  reader then can't reserve at that branch. */
function isAtBranch(book, branchId, heldAt, availableOnly) {
  if (availableOnly) return book.pickup_branches.some((branch) => branch.warehouse_id === branchId);
  return Boolean(heldAt?.get(book.id)?.has(branchId));
}

function searchCatalog(books, query, heldAt = null) {
  let rows = books;
  if (query.ids?.length) {
    const wanted = new Set(query.ids);
    rows = rows.filter((book) => wanted.has(book.id));
  }
  if (query.q) rows = rows.filter((book) => matchesQuery(book, query.q));
  if (query.branch) rows = rows.filter((book) => isAtBranch(book, query.branch, heldAt, query.availableOnly));
  if (query.category) rows = rows.filter((book) => book.categories.some((c) => c.slug === query.category));
  if (query.author) rows = rows.filter((book) => book.authors.some((author) => normalizeText(author) === query.author));
  if (query.publisher) rows = rows.filter((book) => normalizeText(book.publisher) === query.publisher);
  if (query.language) rows = rows.filter((book) => String(book.language || '').toLowerCase() === query.language);
  if (query.year) rows = rows.filter((book) => book.publish_year === query.year);
  if (query.availableOnly) rows = rows.filter((book) => book.available_quantity > 0);

  const sorters = { popular: byPopular, newest: byNewest, rating: byRating, title: byTitle };
  rows = query.sort === 'relevance' && query.q
    ? [...rows].sort((a, b) => relevanceScore(b, query.q) - relevanceScore(a, query.q) || byPopular(a, b))
    : [...rows].sort(sorters[query.sort] || byPopular);

  const total = rows.length;
  const start = (query.page - 1) * query.pageSize;
  return {
    data: rows.slice(start, start + query.pageSize),
    meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)), sort: query.sort },
  };
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) if (value) counts.set(value, (counts.get(value) || 0) + 1);
  return Array.from(counts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value), 'vi'));
}

function buildCategories(books) {
  const map = new Map();
  for (const book of books) {
    for (const category of book.categories) {
      const entry = map.get(category.slug) || { name: category.name, slug: category.slug, book_count: 0, available_count: 0, covers: [] };
      entry.book_count += 1;
      if (book.available_quantity > 0) entry.available_count += 1;
      if (book.cover_image_url && entry.covers.length < 3) entry.covers.push(book.cover_image_url);
      map.set(category.slug, entry);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.book_count - a.book_count || a.name.localeCompare(b.name, 'vi'));
}

/** Per-branch counts in one pass over the catalog: titles the branch holds,
 *  titles reservable there today and the copies on its shelves. */
function summarizeBranches(books, branches, heldAt) {
  const stats = new Map(branches.map((branch) => [branch.id, { title_count: 0, available_title_count: 0, available_copies: 0 }]));
  for (const book of books) {
    for (const branchId of heldAt?.get(book.id) || []) {
      const entry = stats.get(branchId);
      if (entry) entry.title_count += 1;
    }
    for (const pickup of book.pickup_branches) {
      const entry = stats.get(pickup.warehouse_id);
      if (!entry) continue;
      entry.available_title_count += 1;
      entry.available_copies += pickup.available_quantity;
    }
  }
  return stats;
}

function buildBranchList(books, branches, heldAt) {
  const stats = summarizeBranches(books, branches, heldAt);
  return branches.map((branch) => ({ ...branch, stats: stats.get(branch.id) }));
}

/** Branch page: what the branch has on its shelves, built from the same
 *  snapshot as the catalog so the counts agree with /books?branch=. */
function buildBranchDetail(books, branch, heldAt) {
  const stats = summarizeBranches(books, [branch], heldAt).get(branch.id);
  const held = books.filter((book) => isAtBranch(book, branch.id, heldAt, false));
  const available = held.filter((book) => isAtBranch(book, branch.id, heldAt, true));
  return {
    ...branch,
    stats,
    available_books: [...available].sort(byPopular).slice(0, BRANCH_FEATURED_SIZE),
    new_arrivals: [...held].sort(byNewest).slice(0, BRANCH_FEATURED_SIZE),
    categories: buildCategories(held).slice(0, BRANCH_CATEGORY_SIZE).map(({ name, slug, book_count, available_count }) => ({ name, slug, book_count, available_count })),
  };
}

/** Filter options built from what the catalog actually holds. */
function buildFacets(books, branches = [], heldAt = null) {
  const branchStats = summarizeBranches(books, branches, heldAt);
  return {
    categories: buildCategories(books).map(({ name, slug, book_count }) => ({ name, slug, count: book_count })),
    branches: branches
      .map((branch) => ({ id: branch.id, name: branch.name, count: branchStats.get(branch.id).title_count }))
      .filter((branch) => branch.count > 0),
    authors: countBy(books.flatMap((book) => book.authors)).slice(0, 40),
    publishers: countBy(books.map((book) => book.publisher)).slice(0, 40),
    languages: countBy(books.map((book) => book.language)),
    years: countBy(books.map((book) => book.publish_year)).sort((a, b) => b.value - a.value),
  };
}

function takeRanked(books, keep, sorter) {
  return books.filter(keep).sort(sorter).slice(0, HOME_SECTION_SIZE);
}

function buildHome(books, signalsMeta) {
  const ratedEnough = (book) => (book.signals?.rating_count || 0) >= TOP_RATED_MIN_REVIEWS;
  const mostBorrowed = takeRanked(books, (book) => (book.signals?.borrow_count || 0) > 0, byPopular);
  // Recent activity tracks loans closely, so without this the two home sections
  // would list the same titles; "trending" skips what the ranking already shows.
  const ranked = new Set(mostBorrowed.map((book) => book.id));
  return {
    stats: {
      total_titles: books.length,
      available_titles: books.filter((book) => book.available_quantity > 0).length,
      category_count: buildCategories(books).length,
    },
    signals_available: Boolean(signalsMeta),
    windows: signalsMeta?.windows || null,
    // What a reader can actually reserve today, most borrowed first.
    available_now: takeRanked(books, (book) => book.reservable, byPopular),
    trending: takeRanked(books, (book) => !ranked.has(book.id) && (book.signals?.recent_activity || 0) > 0, (a, b) => b.signals.recent_activity - a.signals.recent_activity || byPopular(a, b)),
    most_borrowed: mostBorrowed,
    top_rated: takeRanked(books, ratedEnough, byRating),
    new_arrivals: [...books].sort(byNewest).slice(0, HOME_SECTION_SIZE),
    categories: buildCategories(books).slice(0, 8),
  };
}

function relatedBooks(books, detail, limit = 6) {
  const slugs = new Set(detail.categories.map((category) => category.slug));
  return books
    .filter((book) => book.id !== detail.id && book.categories.some((category) => slugs.has(category.slug)))
    .sort(byPopular)
    .slice(0, limit);
}

// ── caches ──────────────────────────────────────────────────────────────────
// One catalog query per TTL for every anonymous visitor instead of one per
// request; stock shown in lists can be up to SNAPSHOT_TTL_MS old, while the
// detail page always reads fresh availability.

function createCachedLoader(load, ttlMs, failureTtlMs = 0, now = Date.now) {
  let value;
  let expiresAt = 0;
  let inFlight = null;
  return async function get() {
    if (now() < expiresAt) return value;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        value = await load();
        expiresAt = now() + ttlMs;
      } catch (error) {
        if (!failureTtlMs) throw error;
        console.warn('[public-catalog] loader failed, serving without it:', error.message);
        value = null;
        expiresAt = now() + failureTtlMs;
      } finally {
        inFlight = null;
      }
      return value;
    })();
    return inFlight;
  };
}

async function fetchCatalogSignals() {
  const response = await fetch(`${ANALYTICS_SERVICE_URL}/analytics/catalog-signals`, {
    signal: AbortSignal.timeout(5000),
    headers: { 'x-internal-service-key': INTERNAL_SERVICE_KEY },
  });
  if (!response.ok) throw new Error(`analytics-service responded ${response.status}`);
  const body = await response.json();
  const books = Array.isArray(body?.data?.books) ? body.data.books : [];
  return { windows: body?.data?.windows || null, byBook: new Map(books.map((signal) => [String(signal.book_id), signal])) };
}

function createPublicCatalog(prisma, { fetchSignals = fetchCatalogSignals } = {}) {
  const getSignals = createCachedLoader(fetchSignals, SIGNALS_TTL_MS, SIGNALS_FAILURE_TTL_MS);
  const getBooks = createCachedLoader(async () => {
    const rows = (await prisma.books.findMany({ where: PUBLIC_BOOK_WHERE, select: PUBLIC_BOOK_SELECT })).filter(isPublishable);
    return { books: rows.map(toPublicBook), heldAt: new Map(rows.map((row) => [row.id, branchHoldings(row)])) };
  }, SNAPSHOT_TTL_MS);
  const getBranches = createCachedLoader(async () => {
    const rows = await prisma.warehouses.findMany({ where: { is_active: true }, select: PUBLIC_BRANCH_SELECT, orderBy: { name: 'asc' } });
    return rows.map(toPublicBranch);
  }, SNAPSHOT_TTL_MS);

  async function getSnapshot() {
    const [{ books, heldAt }, signals, branches] = await Promise.all([getBooks(), getSignals(), getBranches()]);
    return { books: books.map((book) => withSignals(book, signals?.byBook)), heldAt, signals, branches };
  }

  return {
    async home() {
      const { books, signals } = await getSnapshot();
      return { generated_at: new Date().toISOString(), ...buildHome(books, signals) };
    },
    async list(rawQuery) {
      const { books, heldAt, signals, branches } = await getSnapshot();
      const query = parseCatalogQuery(rawQuery);
      // Without signals a popularity/rating order would be arbitrary — say so.
      if (!signals && (query.sort === 'popular' || query.sort === 'rating')) query.sort = query.q ? 'relevance' : 'newest';
      const branch = query.branch ? branches.find((item) => item.id === query.branch) || null : null;
      const facets = buildFacets(books, branches, heldAt);
      const extra = { facets, signals_available: Boolean(signals), branch: branch ? { id: branch.id, name: branch.name } : null };
      // Unknown or closed branch: an empty page the UI can explain, not the whole catalog.
      if (query.branch && !branch) {
        return { data: [], meta: { page: 1, pageSize: query.pageSize, total: 0, totalPages: 1, sort: query.sort }, ...extra };
      }
      return { ...searchCatalog(books, query, heldAt), ...extra };
    },
    async branches() {
      const { books, heldAt, branches } = await getSnapshot();
      return buildBranchList(books, branches, heldAt);
    },
    async branch(id) {
      const branchId = String(id || '').toLowerCase();
      if (!UUID_PATTERN.test(branchId)) return null;
      const { books, heldAt, branches } = await getSnapshot();
      const branch = branches.find((item) => item.id === branchId);
      return branch ? buildBranchDetail(books, branch, heldAt) : null;
    },
    async categories() {
      const { books } = await getSnapshot();
      return buildCategories(books);
    },
    async detail(id) {
      if (!UUID_PATTERN.test(String(id || ''))) return null;
      const row = await prisma.books.findFirst({ where: { ...PUBLIC_BOOK_WHERE, id }, select: PUBLIC_BOOK_SELECT });
      if (!isPublishable(row)) return null;
      const { books, signals } = await getSnapshot();
      const detail = withSignals(toPublicBookDetail(row), signals?.byBook);
      return { ...detail, related: relatedBooks(books, detail) };
    },
  };
}

module.exports = {
  PUBLIC_BOOK_SELECT,
  PUBLIC_BRANCH_SELECT,
  isPublishable,
  branchHoldings,
  buildBranchDetail,
  buildBranchList,
  buildCategories,
  buildFacets,
  buildHome,
  createCachedLoader,
  createPublicCatalog,
  normalizeText,
  parseCatalogQuery,
  relatedBooks,
  searchCatalog,
  toPublicBook,
  toPublicBookDetail,
  toPublicBranch,
  withSignals,
};
