const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PUBLIC_BOOK_SELECT,
  PUBLIC_BRANCH_SELECT,
  PUBLIC_BRANCH_WHERE,
  branchHoldings,
  buildHome,
  createCachedLoader,
  createPublicCatalog,
  isPublicPickupWarehouse,
  isPublishable,
  parseCatalogQuery,
  searchCatalog,
  toPublicBook,
  toPublicBookDetail,
  toPublicBranch,
  withSignals,
} = require('../src/services/public-catalog.service');
const publicCatalogRoutes = require('../src/routes/public-catalog.routes');
const { PUBLIC_PICKUP_WAREHOUSE_TYPES } = require('../src/utils/constants');

function makeBook(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Trí tuệ nhân tạo cho người mới',
    subtitle: null,
    description: 'Giới thiệu AI',
    edition: null,
    published_date: null,
    page_count: 240,
    default_language: 'vi',
    metadata: { summary_vi: 'Tóm tắt', provenance: { secret: 'internal' } },
    created_at: new Date('2026-01-01T00:00:00Z'),
    publishers: { name: 'NXB Trẻ' },
    book_authors: [{ authors: { full_name: 'Nguyễn Văn A' } }],
    book_categories: [{ categories: { name: 'Công nghệ', slug: 'cong-nghe' } }],
    book_variants: [{
      id: 'variant-1',
      isbn13: '9786041234567',
      isbn10: null,
      language_code: 'vi',
      publish_year: 2024,
      cover_image_url: 'https://covers.example/1.jpg',
      is_borrowable: true,
      // Internal fields a careless mapper could leak; the public shape must drop them.
      unit_cost: 50000,
      list_price: 90000,
      sku: 'SKU-001',
      internal_barcode: 'INT-001',
      stock_balances: [
        { warehouse_id: 'wh-1', available_qty: 3, on_hand_qty: 3, locations: { location_type: 'SHELF_COMPARTMENT', location_code: 'A-01-02' }, warehouses: { name: 'Chi nhánh Q1', is_active: true, warehouse_type: 'BRANCH' } },
        { warehouse_id: 'wh-2', available_qty: 1, on_hand_qty: 1, locations: { location_type: 'SHELF_COMPARTMENT', location_code: 'B-09' }, warehouses: { name: 'Chi nhánh Q3', is_active: true, warehouse_type: 'BRANCH' } },
        { warehouse_id: 'wh-1', available_qty: 0, on_hand_qty: 5, locations: { location_type: 'RECEIVING', location_code: 'RCV' }, warehouses: { name: 'Chi nhánh Q1', is_active: true, warehouse_type: 'BRANCH' } },
      ],
    }],
    ...overrides,
  };
}

const FORBIDDEN_KEYS = ['unit_cost', 'list_price', 'replacement_cost', 'sku', 'internal_barcode', 'location_code', 'location_id', 'locations', 'metadata', 'supplier', 'provenance'];

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys));
  else if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

test('public router exposes GET handlers only', () => {
  const endpoints = publicCatalogRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.deepEqual(endpoints, ['GET /home', 'GET /categories', 'GET /books', 'GET /books/:id', 'GET /branches', 'GET /branches/:id']);
});

test('Prisma select never asks the database for cost, SKU, barcode or location codes', () => {
  const selected = collectKeys(PUBLIC_BOOK_SELECT);
  for (const key of ['unit_cost', 'list_price', 'replacement_cost', 'sku', 'internal_barcode', 'location_code', 'supplier_variants']) {
    assert.equal(selected.has(key), false, `select must not include ${key}`);
  }
});

test('public book shape is a whitelist: no internal fields even if the row carries them', () => {
  const keys = collectKeys(toPublicBookDetail(makeBook()));
  for (const key of FORBIDDEN_KEYS) assert.equal(keys.has(key), false, `leaked ${key}`);
});

test('availability counts shelf stock only and groups pickup branches by warehouse name', () => {
  const book = toPublicBook(makeBook());
  assert.equal(book.available_quantity, 4);
  assert.equal(book.availability_status, 'AVAILABLE');
  assert.equal(book.reservable, true);
  assert.equal(book.variant_id, 'variant-1');
  assert.deepEqual(book.pickup_branches, [
    { warehouse_id: 'wh-1', warehouse_name: 'Chi nhánh Q1', available_quantity: 3 },
    { warehouse_id: 'wh-2', warehouse_name: 'Chi nhánh Q3', available_quantity: 1 },
  ]);
});

test('stock only in receiving is reported as incoming, not reservable', () => {
  const book = toPublicBook(makeBook({
    book_variants: [{ ...makeBook().book_variants[0], stock_balances: [makeBook().book_variants[0].stock_balances[2]] }],
  }));
  assert.equal(book.available_quantity, 0);
  assert.equal(book.availability_status, 'INCOMING');
  assert.equal(book.reservable, false);
  assert.deepEqual(book.pickup_branches, []);
});

test('non-borrowable editions and inactive branches do not count as available', () => {
  const base = makeBook().book_variants[0];
  const book = toPublicBook(makeBook({
    book_variants: [
      { ...base, is_borrowable: false },
      { ...base, id: 'variant-2', stock_balances: [{ ...base.stock_balances[0], warehouses: { name: 'Đóng cửa', is_active: false, warehouse_type: 'BRANCH' } }] },
    ],
  }));
  assert.equal(book.available_quantity, 0);
  assert.equal(book.reservable, false);
});

test('placeholder books from receiving are not publishable; books without the flag are', () => {
  assert.equal(isPublishable(makeBook({ metadata: { is_incomplete: true } })), false);
  assert.equal(isPublishable(makeBook({ metadata: {} })), true);
  assert.equal(isPublishable(makeBook({ metadata: null })), true);
});

test('detail adds description, AI summary and ISBN-13 but never the raw metadata blob', () => {
  const detail = toPublicBookDetail(makeBook());
  assert.equal(detail.summary_vi, 'Tóm tắt');
  assert.equal(detail.isbn, '9786041234567');
  assert.equal(detail.page_count, 240);
  assert.equal('metadata' in detail, false);
});

function catalogFixture() {
  const a = withSignals(toPublicBook(makeBook()), new Map([['11111111-1111-4111-8111-111111111111', { borrow_count: 2, recent_borrow_count: 1, rating_avg: 4.5, rating_count: 2 }]]));
  const b = withSignals(toPublicBook(makeBook({
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Lập trình Python',
    created_at: new Date('2026-05-01T00:00:00Z'),
    book_categories: [{ categories: { name: 'Lập trình', slug: 'lap-trinh' } }],
    book_authors: [{ authors: { full_name: 'Trần B' } }],
  })), new Map([['22222222-2222-4222-8222-222222222222', { borrow_count: 9, recent_wishlist_count: 4, rating_avg: 3, rating_count: 3 }]]));
  const c = withSignals(toPublicBook(makeBook({
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Đắc nhân tâm',
    created_at: new Date('2025-01-01T00:00:00Z'),
    book_variants: [{ ...makeBook().book_variants[0], isbn13: '8935086830000', stock_balances: [] }],
  })), new Map());
  return [a, b, c];
}

test('search is accent-insensitive and matches author or ISBN', () => {
  const books = catalogFixture();
  assert.deepEqual(searchCatalog(books, parseCatalogQuery({ q: 'dac nhan tam' })).data.map((b) => b.title), ['Đắc nhân tâm']);
  assert.deepEqual(searchCatalog(books, parseCatalogQuery({ q: 'tran b' })).data.map((b) => b.title), ['Lập trình Python']);
  assert.deepEqual(searchCatalog(books, parseCatalogQuery({ q: '8935086830000' })).data.map((b) => b.title), ['Đắc nhân tâm']);
});

test('filters by category slug and availability, sorts by real signals, paginates', () => {
  const books = catalogFixture();
  assert.equal(searchCatalog(books, parseCatalogQuery({ category: 'lap-trinh' })).meta.total, 1);
  assert.equal(searchCatalog(books, parseCatalogQuery({ availability: 'available' })).meta.total, 2);
  assert.deepEqual(searchCatalog(books, parseCatalogQuery({ sort: 'popular' })).data.map((b) => b.title)[0], 'Lập trình Python');
  assert.deepEqual(searchCatalog(books, parseCatalogQuery({ sort: 'rating' })).data.map((b) => b.title)[0], 'Trí tuệ nhân tạo cho người mới');
  assert.deepEqual(searchCatalog(books, parseCatalogQuery({ sort: 'newest' })).data.map((b) => b.title)[0], 'Lập trình Python');
  const paged = searchCatalog(books, parseCatalogQuery({ sort: 'title', page: 2, pageSize: 2 }));
  assert.equal(paged.data.length, 1);
  assert.deepEqual(paged.meta, { page: 2, pageSize: 2, total: 3, totalPages: 2, sort: 'title' });
});

test('page size is capped and unknown sort falls back safely', () => {
  const query = parseCatalogQuery({ pageSize: '5000', sort: 'unit_cost' });
  assert.equal(query.pageSize, 48);
  assert.equal(query.sort, 'popular');
});

test('home sections only rank books that have the signal — nothing is padded with zeros', () => {
  const home = buildHome(catalogFixture(), { windows: { borrow_days: 365, recent_days: 90 } });
  assert.deepEqual(home.most_borrowed.map((b) => b.title), ['Lập trình Python', 'Trí tuệ nhân tạo cho người mới']);
  // Both active books are already in the most-borrowed ranking, so trending doesn't repeat them.
  assert.deepEqual(home.trending, []);
  assert.deepEqual(home.top_rated.map((b) => b.title), ['Trí tuệ nhân tạo cho người mới', 'Lập trình Python']);
  assert.equal(home.new_arrivals[0].title, 'Lập trình Python');
  assert.equal(home.stats.total_titles, 3);
  assert.equal(home.stats.available_titles, 2);
  assert.equal(home.signals_available, true);
});

test('when analytics is down the catalog still serves and does not pretend to sort by popularity', async () => {
  const prisma = { books: { findMany: async () => [makeBook()], findFirst: async () => makeBook() }, warehouses: { findMany: async () => [] } };
  const catalog = createPublicCatalog(prisma, { fetchSignals: async () => { throw new Error('analytics down'); } });
  const list = await catalog.list({ sort: 'popular' });
  assert.equal(list.signals_available, false);
  assert.equal(list.meta.sort, 'newest');
  assert.equal(list.data[0].signals, null);
  const home = await catalog.home();
  assert.deepEqual(home.most_borrowed, []);
  assert.equal(home.new_arrivals.length, 1);
});

test('detail rejects non-UUID ids without querying the database', async () => {
  let queried = false;
  const prisma = { books: { findMany: async () => [], findFirst: async () => { queried = true; return null; } }, warehouses: { findMany: async () => [] } };
  const catalog = createPublicCatalog(prisma, { fetchSignals: async () => ({ windows: null, byBook: new Map() }) });
  assert.equal(await catalog.detail("1' OR '1'='1"), null);
  assert.equal(queried, false);
});

test('cached loader shares one in-flight load and refreshes after the TTL', async () => {
  let clock = 0;
  let calls = 0;
  const get = createCachedLoader(async () => { calls += 1; return calls; }, 1000, 0, () => clock);
  const [first, second] = await Promise.all([get(), get()]);
  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.equal(calls, 1);
  clock = 1500;
  assert.equal(await get(), 2);
});

test('ids filter returns only catalog books, ignores non-UUIDs and is capped', () => {
  const books = catalogFixture();
  const query = parseCatalogQuery({ ids: '22222222-2222-4222-8222-222222222222,not-a-uuid,99999999-9999-4999-8999-999999999999' });
  assert.deepEqual(query.ids, ['22222222-2222-4222-8222-222222222222', '99999999-9999-4999-8999-999999999999']);
  assert.deepEqual(searchCatalog(books, query).data.map((b) => b.title), ['Lập trình Python']);
  const many = Array.from({ length: 60 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',');
  assert.equal(parseCatalogQuery({ ids: many }).ids.length, 48);
});

test('trending lists recent activity outside the most-borrowed ranking', () => {
  const ranked = Array.from({ length: 10 }, (_, i) => withSignals(
    toPublicBook(makeBook({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`, title: `Top ${i}` })),
    new Map([[`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`, { borrow_count: 100 - i, recent_borrow_count: 50 }]]),
  ));
  const rising = withSignals(toPublicBook(makeBook({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Rising' })),
    new Map([['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { borrow_count: 3, recent_wishlist_count: 7 }]]));
  const home = buildHome([...ranked, rising], { windows: null });
  assert.equal(home.most_borrowed.length, 10);
  assert.deepEqual(home.trending.map((b) => b.title), ['Rising']);
});

test('available_now lists only reservable books, most borrowed first', () => {
  const home = buildHome(catalogFixture(), { windows: null });
  // "Đắc nhân tâm" has no shelf stock, so it never appears here.
  assert.deepEqual(home.available_now.map((b) => b.title), ['Lập trình Python', 'Trí tuệ nhân tạo cho người mới']);
  assert.ok(home.available_now.every((b) => b.reservable));
});

// ── branches ────────────────────────────────────────────────────────────────

const WH_Q1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const WH_Q3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const WH_CLOSED = 'aaaaaaaa-0000-4000-8000-000000000009';
const WH_LIBRARY = 'aaaaaaaa-0000-4000-8000-000000000005';
const WH_CENTRAL = 'aaaaaaaa-0000-4000-8000-000000000007';
const WH_STORE = 'aaaaaaaa-0000-4000-8000-000000000008';

const WAREHOUSE_ROWS = [
  // Columns a careless select could pass through; the public shape must drop them.
  { id: WH_Q1, code: 'BR-HCM-01', warehouse_type: 'BRANCH', manager_user_id: 'staff-1', name: 'Chi nhánh Quận 1', address_line1: '78 Lê Duẩn', address_line2: null, ward: 'Bến Nghé', district: 'Quận 1', province: 'TP. Hồ Chí Minh', is_active: true },
  { id: WH_Q3, code: 'BR-HCM-02', warehouse_type: 'BRANCH', manager_user_id: 'staff-2', name: 'Chi nhánh Quận 3', address_line1: '  ', address_line2: null, ward: null, district: null, province: null, is_active: true },
  { id: WH_CLOSED, code: 'BR-OLD', warehouse_type: 'BRANCH', manager_user_id: null, name: 'Chi nhánh đã đóng', address_line1: '1 Cũ', is_active: false },
  { id: WH_LIBRARY, code: 'LIB-01', warehouse_type: 'LIBRARY', manager_user_id: null, name: 'Thư viện Trung tâm', address_line1: '1 Thư Viện', is_active: true },
  // Internal, active and holding the most stock: must never become public.
  { id: WH_CENTRAL, code: 'WH-HCM-01', warehouse_type: 'WAREHOUSE', manager_user_id: 'staff-9', name: 'Kho HCM Chinh', address_line1: '123 Nguyễn Huệ', is_active: true },
  { id: WH_STORE, code: 'ST-01', warehouse_type: 'STORE', manager_user_id: null, name: 'Cửa hàng Q5', address_line1: '5 Trần Hưng Đạo', is_active: true },
];

const WAREHOUSE_BY_ID = new Map(WAREHOUSE_ROWS.map((row) => [row.id, row]));

/** A stock_balances row as PUBLIC_BOOK_SELECT reads it, joined to its warehouse. */
function shelf(warehouseId, available, onHand = available) {
  const warehouse = WAREHOUSE_BY_ID.get(warehouseId);
  return {
    warehouse_id: warehouseId,
    available_qty: available,
    on_hand_qty: onHand,
    locations: { location_type: 'SHELF_COMPARTMENT', location_code: 'A-01' },
    warehouses: { name: warehouse.name, is_active: warehouse.is_active, warehouse_type: warehouse.warehouse_type },
  };
}

function branchFixtureRows() {
  const variant = makeBook().book_variants[0];
  return [
    // Reservable at Q1 only.
    makeBook({ id: '11111111-1111-4111-8111-111111111111', title: 'Sách có ở Q1', book_variants: [{ ...variant, stock_balances: [shelf(WH_Q1, 2)] }] }),
    // Every Q3 copy is lent out: Q3 holds it, nothing is reservable.
    makeBook({ id: '22222222-2222-4222-8222-222222222222', title: 'Sách Q3 đang được mượn', created_at: new Date('2026-06-01T00:00:00Z'), book_variants: [{ ...variant, stock_balances: [shelf(WH_Q3, 0, 1)] }] }),
    // Only in Q1's receiving area: not on any shelf yet.
    makeBook({ id: '33333333-3333-4333-8333-333333333333', title: 'Sách đang nhập kho', book_variants: [{ ...variant, stock_balances: [{ ...shelf(WH_Q1, 0, 4), locations: { location_type: 'RECEIVING' } }] }] }),
    // Only in the central warehouse (shelf + receiving) and a store: nothing a reader can pick up.
    makeBook({ id: '44444444-4444-4444-8444-444444444444', title: 'Sách chỉ có ở kho tổng', book_variants: [{ ...variant, stock_balances: [shelf(WH_CENTRAL, 100), shelf(WH_STORE, 7), { ...shelf(WH_CENTRAL, 0, 30), locations: { location_type: 'RECEIVING' } }] }] }),
    // Central warehouse 10 + library 2: only the library's 2 copies are public.
    makeBook({ id: '55555555-5555-4555-8555-555555555555', title: 'Sách ở thư viện và kho tổng', book_variants: [{ ...variant, stock_balances: [shelf(WH_CENTRAL, 10), shelf(WH_LIBRARY, 2)] }] }),
  ];
}

function branchCatalog(rows = branchFixtureRows()) {
  const calls = { warehouses: [] };
  const prisma = {
    books: { findMany: async () => rows, findFirst: async () => rows[0] },
    warehouses: {
      findMany: async (args) => {
        calls.warehouses.push(args);
        const types = args.where?.warehouse_type?.in;
        return WAREHOUSE_ROWS.filter((row) => (!args.where?.is_active || row.is_active) && (!types || types.includes(row.warehouse_type)));
      },
    },
  };
  return { catalog: createPublicCatalog(prisma, { fetchSignals: async () => ({ windows: null, byBook: new Map() }) }), calls };
}

const FORBIDDEN_BRANCH_KEYS = ['code', 'warehouse_type', 'manager_user_id', 'is_active', 'locations', 'location_code', 'location_id', 'on_hand_qty', 'reserved_qty', 'capacity', 'warehouse_settings', 'stock_movements'];

test('branch select only asks for name, address and the fields the pickup rule needs', () => {
  assert.deepEqual(Object.keys(PUBLIC_BRANCH_SELECT).sort(), ['address_line1', 'address_line2', 'district', 'id', 'is_active', 'name', 'province', 'ward', 'warehouse_type']);
  for (const key of ['code', 'manager_user_id', 'warehouse_settings', 'locations', 'capacity']) assert.equal(key in PUBLIC_BRANCH_SELECT, false);
});

test('pickup rule: active BRANCH and LIBRARY only; WAREHOUSE, STORE, inactive or untyped never', () => {
  assert.deepEqual([...PUBLIC_PICKUP_WAREHOUSE_TYPES].sort(), ['BRANCH', 'LIBRARY']);
  assert.equal(isPublicPickupWarehouse({ warehouse_type: 'BRANCH', is_active: true }), true);
  assert.equal(isPublicPickupWarehouse({ warehouse_type: 'library', is_active: true }), true);
  assert.equal(isPublicPickupWarehouse({ warehouse_type: 'WAREHOUSE', is_active: true }), false);
  assert.equal(isPublicPickupWarehouse({ warehouse_type: 'STORE', is_active: true }), false);
  assert.equal(isPublicPickupWarehouse({ warehouse_type: 'BRANCH', is_active: false }), false);
  assert.equal(isPublicPickupWarehouse({ name: 'no type', is_active: true }), false);
  assert.equal(isPublicPickupWarehouse(null), false);
  // The database query filters on the same constant.
  assert.deepEqual(PUBLIC_BRANCH_WHERE, { is_active: true, warehouse_type: { in: PUBLIC_PICKUP_WAREHOUSE_TYPES } });
});

test('internal warehouse stock is never public availability (WAREHOUSE 10 + BRANCH 0 / BRANCH 2)', () => {
  const variant = makeBook().book_variants[0];
  const centralOnly = toPublicBook(makeBook({ book_variants: [{ ...variant, stock_balances: [shelf(WH_CENTRAL, 10), shelf(WH_Q1, 0)] }] }));
  assert.equal(centralOnly.available_quantity, 0);
  assert.equal(centralOnly.reservable, false);
  assert.equal(centralOnly.variant_id, null);
  assert.deepEqual(centralOnly.pickup_branches, []);
  assert.equal(centralOnly.availability_status, 'UNAVAILABLE');

  const mixed = toPublicBook(makeBook({ book_variants: [{ ...variant, stock_balances: [shelf(WH_CENTRAL, 10), shelf(WH_Q1, 2)] }] }));
  assert.equal(mixed.available_quantity, 2);
  assert.equal(mixed.reservable, true);
  assert.deepEqual(mixed.pickup_branches, [{ warehouse_id: WH_Q1, warehouse_name: 'Chi nhánh Quận 1', available_quantity: 2 }]);
});

test('receiving stock only reads as "incoming" when it is at a public branch', () => {
  const variant = makeBook().book_variants[0];
  const receiving = (warehouseId) => ({ ...shelf(warehouseId, 0, 6), locations: { location_type: 'RECEIVING' } });
  assert.equal(toPublicBook(makeBook({ book_variants: [{ ...variant, stock_balances: [receiving(WH_CENTRAL)] }] })).availability_status, 'UNAVAILABLE');
  assert.equal(toPublicBook(makeBook({ book_variants: [{ ...variant, stock_balances: [receiving(WH_Q1)] }] })).availability_status, 'INCOMING');
});

test('a WAREHOUSE with 100 copies is invisible everywhere on the public catalog', async () => {
  const { catalog } = branchCatalog();
  const branches = await catalog.branches();
  assert.deepEqual(branches.map((b) => b.name).sort(), ['Chi nhánh Quận 1', 'Chi nhánh Quận 3', 'Thư viện Trung tâm']);

  const list = await catalog.list({});
  const centralOnly = list.data.find((b) => b.title === 'Sách chỉ có ở kho tổng');
  assert.equal(centralOnly.reservable, false);
  assert.equal(centralOnly.available_quantity, 0);
  assert.deepEqual(centralOnly.pickup_branches, []);
  assert.deepEqual(list.facets.branches.map((b) => b.id).sort(), [WH_Q1, WH_Q3, WH_LIBRARY].sort());
  const json = JSON.stringify([branches, list]);
  for (const hidden of [WH_CENTRAL, WH_STORE, 'Kho HCM Chinh', 'Cửa hàng Q5', 'warehouse_type', 'WAREHOUSE']) {
    assert.equal(json.includes(hidden), false, `public JSON mentions ${hidden}`);
  }

  const home = await catalog.home();
  assert.equal(home.available_now.some((b) => b.title === 'Sách chỉ có ở kho tổng'), false);

  const filtered = await catalog.list({ branch: WH_CENTRAL });
  assert.deepEqual(filtered.data, []);
  assert.equal(filtered.meta.total, 0);
  assert.equal(filtered.branch, null);
  assert.equal((await catalog.list({ branch: WH_STORE })).meta.total, 0);
  assert.equal(await catalog.branch(WH_CENTRAL), null);
  assert.equal(await catalog.branch(WH_STORE), null);
});

test('an active LIBRARY is a pickup branch like a BRANCH: listed, filterable, counted', async () => {
  const { catalog } = branchCatalog();
  const library = await catalog.branch(WH_LIBRARY);
  assert.deepEqual(library.stats, { title_count: 1, available_title_count: 1, available_copies: 2 });
  assert.deepEqual(library.available_books.map((b) => b.title), ['Sách ở thư viện và kho tổng']);
  const atLibrary = await catalog.list({ branch: WH_LIBRARY, availability: 'available' });
  assert.deepEqual(atLibrary.data.map((b) => b.title), ['Sách ở thư viện và kho tổng']);
  assert.equal(atLibrary.data[0].available_quantity, 2);
  assert.deepEqual(atLibrary.branch, { id: WH_LIBRARY, name: 'Thư viện Trung tâm' });
});

test('the branch list re-checks the rule even if the query returned an internal warehouse', async () => {
  const prisma = {
    books: { findMany: async () => [], findFirst: async () => null },
    // A query that ignores its where clause.
    warehouses: { findMany: async () => WAREHOUSE_ROWS },
  };
  const catalog = createPublicCatalog(prisma, { fetchSignals: async () => ({ windows: null, byBook: new Map() }) });
  assert.deepEqual((await catalog.branches()).map((b) => b.id).sort(), [WH_Q1, WH_Q3, WH_LIBRARY].sort());
});

test('public branch shape joins the address and drops internal columns', () => {
  assert.deepEqual(toPublicBranch(WAREHOUSE_ROWS[0]), { id: WH_Q1, name: 'Chi nhánh Quận 1', address: '78 Lê Duẩn, Bến Nghé, Quận 1, TP. Hồ Chí Minh' });
  // No address on file stays null rather than an empty string.
  assert.equal(toPublicBranch(WAREHOUSE_ROWS[1]).address, null);
});

test('branch holdings count shelf copies (lent out too) but not receiving, closed branches or non-borrowable editions', () => {
  const variant = makeBook().book_variants[0];
  const held = branchHoldings(makeBook({
    book_variants: [
      { ...variant, stock_balances: [shelf(WH_Q1, 0, 2), { ...shelf(WH_Q3, 0, 3), locations: { location_type: 'STAGING' } }] },
      { ...variant, id: 'v-closed', stock_balances: [{ ...shelf(WH_CLOSED, 5), warehouses: { name: 'x', is_active: false, warehouse_type: 'BRANCH' } }] },
      { ...variant, id: 'v-reference', is_borrowable: false, stock_balances: [shelf(WH_Q3, 5)] },
    ],
  }));
  assert.deepEqual([...held], [WH_Q1]);
});

test('anonymous branch list: only active branches, real counts, no internal fields', async () => {
  const { catalog, calls } = branchCatalog();
  const branches = await catalog.branches();
  assert.deepEqual(calls.warehouses[0].where, { is_active: true, warehouse_type: { in: ['BRANCH', 'LIBRARY'] } });
  assert.deepEqual(branches.map((b) => b.name), ['Chi nhánh Quận 1', 'Chi nhánh Quận 3', 'Thư viện Trung tâm']);
  assert.deepEqual(branches[0].stats, { title_count: 1, available_title_count: 1, available_copies: 2 });
  assert.deepEqual(branches[1].stats, { title_count: 1, available_title_count: 0, available_copies: 0 });
  const keys = collectKeys(branches);
  for (const key of FORBIDDEN_BRANCH_KEYS) assert.equal(keys.has(key), false, `leaked ${key}`);
});

test('branch detail lists what is reservable there and rejects unknown, closed or malformed ids', async () => {
  const { catalog } = branchCatalog();
  const q1 = await catalog.branch(WH_Q1);
  assert.equal(q1.name, 'Chi nhánh Quận 1');
  assert.deepEqual(q1.available_books.map((b) => b.title), ['Sách có ở Q1']);
  assert.deepEqual(q1.categories, [{ name: 'Công nghệ', slug: 'cong-nghe', book_count: 1, available_count: 1 }]);
  const keys = collectKeys(q1);
  for (const key of FORBIDDEN_BRANCH_KEYS) assert.equal(keys.has(key), false, `leaked ${key}`);

  // Ids are matched case-insensitively, like Postgres UUIDs.
  const q3 = await catalog.branch(WH_Q3.toUpperCase());
  assert.deepEqual(q3.available_books, []);
  assert.deepEqual(q3.new_arrivals.map((b) => b.title), ['Sách Q3 đang được mượn']);

  assert.equal(await catalog.branch(WH_CLOSED), null);
  assert.equal(await catalog.branch('bbbbbbbb-0000-4000-8000-000000000000'), null);
  assert.equal(await catalog.branch("x' OR 1=1 --"), null);
});

test('catalog branch filter: held vs reservable there, combined with other filters', async () => {
  const { catalog } = branchCatalog();
  const atQ3 = await catalog.list({ branch: WH_Q3 });
  assert.deepEqual(atQ3.data.map((b) => b.title), ['Sách Q3 đang được mượn']);
  assert.deepEqual(atQ3.branch, { id: WH_Q3, name: 'Chi nhánh Quận 3' });
  assert.equal((await catalog.list({ branch: WH_Q3, availability: 'available' })).meta.total, 0);

  const availableQ1 = await catalog.list({ branch: WH_Q1, availability: 'available', category: 'cong-nghe', q: 'sach', sort: 'title', page: '1' });
  assert.deepEqual(availableQ1.data.map((b) => b.title), ['Sách có ở Q1']);
  // Receiving-only stock never puts a book "at" the branch.
  assert.equal((await catalog.list({ branch: WH_Q1 })).data.some((b) => b.title === 'Sách đang nhập kho'), false);
  // The facet only offers branches that hold something, with their title counts.
  assert.deepEqual(availableQ1.facets.branches, [
    { id: WH_Q1, name: 'Chi nhánh Quận 1', count: 1 },
    { id: WH_Q3, name: 'Chi nhánh Quận 3', count: 1 },
    { id: WH_LIBRARY, name: 'Thư viện Trung tâm', count: 1 },
  ]);

  const all = await catalog.list({});
  assert.equal(all.meta.total, 5);
  assert.equal(all.branch, null);
});

test('invalid or closed branch filter returns an empty page instead of the whole catalog', async () => {
  const { catalog } = branchCatalog();
  for (const branch of ['not-a-uuid', WH_CLOSED, WH_CENTRAL, 'bbbbbbbb-0000-4000-8000-000000000000', "'; DROP TABLE books; --"]) {
    const result = await catalog.list({ branch });
    assert.equal(result.meta.total, 0, branch);
    assert.deepEqual(result.data, []);
    assert.equal(result.branch, null);
  }
});
