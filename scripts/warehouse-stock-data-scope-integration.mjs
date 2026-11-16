// P1 warehouse stock-data access check (catalog + legacy inventory + shelf endpoints).
// Fixture: Manager A = FULL at warehouse A, READ_ONLY at warehouse B, no grant at warehouse C.
// Verifies GET /api/books, GET /api/books/:id, GET /api/inventory (legacy) and GET /api/shelves(/:id)
// only ever surface A+B stock, never C's; that READ_ONLY still means real read access to B (not
// write, preserving cross-warehouse transfer/replenishment sourcing); and that C is unreachable by
// any means — list, detail-by-id, or a client-supplied warehouse_id query param.
//
// Requires a book/variant with stock in all three target warehouses; seeds a small quantity into
// warehouse C if the chosen book doesn't already have any there (real stock, not deleted afterward
// — consistent with how other scripts in this repo leave demo data behind).
//
// Usage: node scripts/warehouse-stock-data-scope-integration.mjs
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const password = process.env.PURCHASE_TEST_PASSWORD || '123456';
const adminName = process.env.PURCHASE_TEST_USERNAME || 'hung';
const managerName = process.env.SCOPE_TEST_MANAGER || 'manager01';

// WH-HCM-01 (A, FULL), WH-HN-01 (B, READ_ONLY), WH-DN-01 (C, no grant).
const A = process.env.SCOPE_TEST_WAREHOUSE_A || '2f4acebd-d433-4cee-a2e0-d985024a0bfa';
const B = process.env.SCOPE_TEST_WAREHOUSE_B || '10fab1b4-6a76-43d8-ba6d-d647c2a6d8c1';
const C = process.env.SCOPE_TEST_WAREHOUSE_C || '9dd7de0f-6295-5c17-80e8-214ed2bce031';

async function request(method, path, token, body) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  let payload;
  if (body != null) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json().catch(() => ({})) : await response.text();
  return { response, data };
}
async function ok(method, path, token, body) {
  const r = await request(method, path, token, body);
  if (!r.response.ok) throw new Error(`${method} ${path} -> ${r.response.status} ${JSON.stringify(r.data)}`);
  return r.data;
}
async function login(identifier) {
  const { response, data } = await request('POST', '/auth/login', null, { identifier, password });
  if (!response.ok) throw new Error(`login ${identifier} failed: ${JSON.stringify(data)}`);
  return { token: data.token, user: data.user };
}

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${condition || !detail ? '' : ` -- ${detail}`}`);
}

async function ensureStockEverywhere(adminToken) {
  const books = await ok('GET', '/api/books', adminToken);
  let target = books.find((b) => {
    const whIds = new Set((b.locations || []).map((l) => l.warehouse_id));
    return whIds.has(A) && whIds.has(B) && whIds.has(C);
  });
  if (target) return target;

  target = books.find((b) => {
    const whIds = new Set((b.locations || []).map((l) => l.warehouse_id));
    return whIds.has(A) && whIds.has(B) && b.variant_id;
  });
  if (!target) throw new Error('No book with stock in both warehouse A and B found to use as the test fixture');

  const locs = await ok('GET', `/api/warehouses/${C}/locations`, adminToken);
  const list = locs.locations || locs.data || locs;
  const shelf = (Array.isArray(list) ? list : []).find((l) => l.location_type === 'SHELF') || list[0];
  await ok('POST', '/api/inventory/inbound', adminToken, {
    variantId: target.variant_id,
    locationId: shelf.id,
    warehouseId: C,
    quantity: 5,
    unitCost: 50000,
  });
  return ok('GET', `/api/books/${target.id}`, adminToken);
}

async function main() {
  const admin = await login(adminName);
  const mgrA = await login(managerName);
  const book = await ensureStockEverywhere(admin.token);
  const bookId = book.id;
  const variantId = book.variant_id;

  const originalScopes = (await ok('GET', `/iam/users/${mgrA.user.id}/warehouse-scopes`, admin.token)).data.scopes
    .map((s) => ({ warehouse_id: s.warehouse_id, access_level: s.access_level }));

  await ok('PUT', `/iam/users/${mgrA.user.id}/warehouse-scopes`, admin.token, {
    scopes: [
      { warehouse_id: A, access_level: 'FULL' },
      { warehouse_id: B, access_level: 'READ_ONLY' },
    ],
  });

  try {
    const expectedTotal = (book.locations || [])
      .filter((l) => l.warehouse_id === A || l.warehouse_id === B)
      .reduce((sum, l) => sum + Number(l.quantity || 0), 0);

    // ── T1: GET /api/books ──────────────────────────────────────────────────
    const books = await ok('GET', '/api/books', mgrA.token);
    const listed = books.find((b) => b.id === bookId);
    const whIds = new Set((listed?.locations || []).map((l) => l.warehouse_id));
    check('T1: book list includes warehouse A stock', whIds.has(A));
    check('T1: book list includes warehouse B stock (READ_ONLY)', whIds.has(B));
    check('T1: book list excludes warehouse C stock (no grant)', !whIds.has(C), JSON.stringify([...whIds]));
    check('T1: quantity/available recomputed from A+B only, never C', listed?.quantity === expectedTotal && listed?.available_quantity === expectedTotal, `quantity=${listed?.quantity} expected=${expectedTotal}`);

    // ── T2: GET /api/books/:id ──────────────────────────────────────────────
    const detail = await ok('GET', `/api/books/${bookId}`, mgrA.token);
    const detailWhIds = new Set((detail.locations || []).map((l) => l.warehouse_id));
    check('T2: book detail includes A and B, excludes C', detailWhIds.has(A) && detailWhIds.has(B) && !detailWhIds.has(C), JSON.stringify([...detailWhIds]));
    check('T2: detail quantity matches A+B only', detail.quantity === expectedTotal, `quantity=${detail.quantity} expected=${expectedTotal}`);

    const detailViaQuery = await ok('GET', `/api/books/${bookId}?warehouse_id=${C}`, mgrA.token);
    const detailViaQueryWh = new Set((detailViaQuery.locations || []).map((l) => l.warehouse_id));
    check('T2b: a warehouse_id query param cannot widen scope to C', !detailViaQueryWh.has(C), JSON.stringify([...detailViaQueryWh]));

    // ── T3: GET /api/inventory (legacy) ─────────────────────────────────────
    const legacy = await ok('GET', '/api/inventory', mgrA.token);
    const legacyBook = legacy.find((b) => b.id === bookId);
    const legacyWhIds = new Set((legacyBook?.book_variants || []).flatMap((v) => (v.stock_balances || []).map((s) => s.warehouse_id)));
    check('T3: legacy /api/inventory includes A and B, excludes C', legacyWhIds.has(A) && legacyWhIds.has(B) && !legacyWhIds.has(C), JSON.stringify([...legacyWhIds]));

    // ── T4: READ_ONLY on B means real read access, but never write ─────────
    const readB = await request('GET', `/api/warehouses/${B}/locations`, mgrA.token);
    check('T4: READ_ONLY manager can still read warehouse B locations', readB.response.ok, String(readB.response.status));
    const writeB = await request('POST', '/api/inventory/inbound', mgrA.token, { variantId, locationId: 'does-not-matter', warehouseId: B, quantity: 1, unitCost: 1000 });
    check('T4: READ_ONLY manager cannot write (inbound) to warehouse B', !writeB.response.ok && writeB.response.status !== 500, String(writeB.response.status));

    // ── T5: no access to C by any route ─────────────────────────────────────
    const readC = await request('GET', `/api/warehouses/${C}/locations`, mgrA.token);
    check('T5: manager cannot read warehouse C locations at all', !readC.response.ok, String(readC.response.status));
    const writeC = await request('POST', '/api/inventory/inbound', mgrA.token, { variantId, locationId: 'does-not-matter', warehouseId: C, quantity: 1, unitCost: 1000 });
    check('T5: manager cannot write to warehouse C', !writeC.response.ok, String(writeC.response.status));

    // ── T7 (light): transfer/replenishment sourcing still works for READ_ONLY B ──
    const warehouses = await ok('GET', '/api/warehouses', mgrA.token);
    check('T7: warehouse directory for transfer-source selection still lists B', new Set(warehouses.map((w) => w.id)).has(B));

    // ── Shelf endpoints (same leak pattern, fixed alongside the 3 named endpoints) ──
    const shelves = await ok('GET', '/api/shelves', mgrA.token);
    const shelfWhIds = new Set((shelves.shelves || []).map((s) => s.warehouse?.id));
    check('Shelf overview includes A and B, excludes C', shelfWhIds.has(A) && shelfWhIds.has(B) && !shelfWhIds.has(C), JSON.stringify([...shelfWhIds]));
    const shelfViaQuery = await request('GET', `/api/shelves?warehouseId=${C}`, mgrA.token);
    const shelfViaQueryRows = (shelfViaQuery.data?.shelves || []).length;
    check('Shelf overview with warehouseId=C query param returns nothing for C', !shelfViaQuery.response.ok || shelfViaQueryRows === 0, `status=${shelfViaQuery.response.status} rows=${shelfViaQueryRows}`);

    const cShelves = await ok('GET', '/api/shelves', admin.token);
    const aShelfInC = (cShelves.shelves || []).find((s) => s.warehouse?.id === C);
    if (aShelfInC) {
      const shelfDetail = await request('GET', `/api/shelves/${aShelfInC.id}`, mgrA.token);
      check('Direct shelf-detail access to a C shelf is denied', !shelfDetail.response.ok, String(shelfDetail.response.status));
    }
  } finally {
    await ok('PUT', `/iam/users/${mgrA.user.id}/warehouse-scopes`, admin.token, { scopes: originalScopes });
    console.log(`restored ${managerName} original scopes`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('FAILED:', failed.map((r) => r.name).join('; '));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Script error:', error);
  process.exitCode = 1;
});
