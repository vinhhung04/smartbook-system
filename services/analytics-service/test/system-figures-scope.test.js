// Dashboard KPIs, borrow trends, top books, overdue summary and reorder
// suggestions follow the caller's warehouse scope (req.warehouseScope from
// attachWarehouseScope): every query over a per-warehouse table gets the
// readable ids, a superuser / internal call gets NULL (every warehouse).
// The database layer is replaced; the SQL and its parameters are inspected.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const seen = [];
const dbPath = path.join(__dirname, '..', 'src', 'lib', 'db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    inventoryPool: 'inventory',
    borrowPool: 'borrow',
    async query(pool, text, params) { seen.push({ text, params }); return []; },
    async queryOne(pool, text, params) { seen.push({ text, params }); return {}; },
    async pingDatabases() { return { inventory: true, borrow: true }; },
  },
};

const c = require('../src/controllers/analytics.controller');

const SCOPED_TABLES = /loan_transactions|loan_reservations|stock_balances|purchase_orders|FROM fines/;
const BORROW_READER = { id: 'u', permissions: ['analytics.borrow.read'] };
const run = (handler, warehouseScope, query = {}, user = BORROW_READER) => new Promise((resolve, reject) => {
  handler({ query, user, warehouseScope, headers: {} }, { json: resolve }, reject);
});

const cases = {
  kpis: c.getDashboardKpis,
  trends: c.getBorrowTrends,
  topBooks: c.getTopBooks,
  overdue: c.getOverdueSummary,
  reorder: c.getReorderSuggestions,
  fines: c.getFineSummary,
  reservations: c.getReservationFunnel,
};

for (const [name, handler] of Object.entries(cases)) {
  test(`${name}: every per-warehouse query is limited to the caller's warehouses`, async () => {
    seen.length = 0;
    await run(handler, new Set(['wh-a']));
    // supplier lead times (PO -> receipt) are a supplier property: library-wide on purpose
    const scoped = seen.filter((q) => SCOPED_TABLES.test(q.text) && !q.text.includes('AS lead_time_days'));
    assert.ok(scoped.length > 0, 'touches per-warehouse data');
    for (const q of scoped) {
      assert.match(q.text, /= ANY\(\$\d+::uuid\[\]\)/, q.text.slice(0, 120));
      assert.ok((q.params || []).some((p) => Array.isArray(p) && p.length === 1 && p[0] === 'wh-a'), q.text.slice(0, 120));
    }
  });

  test(`${name}: superuser / internal call passes NULL (every warehouse)`, async () => {
    seen.length = 0;
    await run(handler, null);
    for (const q of seen.filter((x) => SCOPED_TABLES.test(x.text) && /::uuid\[\] IS NULL/.test(x.text))) {
      assert.ok(q.params.includes(null), q.text.slice(0, 120));
    }
  });
}

test('an empty scope is an empty list, never "all"', async () => {
  seen.length = 0;
  await run(c.getDashboardKpis, new Set());
  const scoped = seen.filter((q) => SCOPED_TABLES.test(q.text));
  assert.ok(scoped.every((q) => q.params.some((p) => Array.isArray(p) && p.length === 0)));
});

test('reorder with a budget scopes loans and incoming purchase orders too', async () => {
  seen.length = 0;
  await run(c.getReorderSuggestions, new Set(['wh-a']), { budgetVnd: '100000' });
  for (const marker of ['age_days', 'FROM purchase_order_items poi']) {
    const q = seen.find((x) => x.text.includes(marker));
    assert.ok(q, marker);
    assert.ok(q.params.some((p) => Array.isArray(p) && p[0] === 'wh-a'), marker);
  }
});

test('KPIs leave the borrow figures out for a user without analytics.borrow.read', async () => {
  seen.length = 0;
  const body = await run(c.getDashboardKpis, new Set(['wh-a']), {}, { id: 'm', permissions: ['analytics.read'] });
  assert.equal(body.meta.borrow_figures, 'NOT_PERMITTED');
  for (const key of ['active_loans', 'overdue_loans', 'unpaid_fine_amount', 'reservation_conversion_rate']) {
    assert.ok(!(key in body.data), key);
  }
  assert.ok('total_copies' in body.data);
  assert.ok(!seen.some((q) => /loan_transactions|loan_reservations|FROM fines/.test(q.text)), 'borrow_db not queried');
  const full = await run(c.getDashboardKpis, new Set(['wh-a']));
  assert.ok('active_loans' in full.data && !full.meta);
});
