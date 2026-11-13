// GET /reorder-suggestions?budgetVnd= through the real controller, with the
// database layer replaced by fixture rows (no Postgres needed). Covers the
// budget contract the page relies on: unpriced lines, lines funded outside
// the `limit` page, incoming purchase orders and the budget totals.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const fixture = { inventory: [], incoming: [], loans: [] };
const sqlSeen = [];

const dbPath = path.join(__dirname, '..', 'src', 'lib', 'db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    inventoryPool: 'inventory',
    borrowPool: 'borrow',
    async query(pool, text, params) {
      sqlSeen.push({ text, params });
      if (text.includes('FROM book_variants bv') && text.includes('bv.unit_cost') && text.includes('GROUP BY')) return fixture.inventory;
      if (text.includes('FROM purchase_order_items poi')) return fixture.incoming;
      if (text.includes('FROM loan_items li') && text.includes('age_days')) return fixture.loans;
      return [];
    },
    async queryOne() { return {}; },
    async pingDatabases() { return { inventory: true, borrow: true }; },
  },
};

const { getReorderSuggestions } = require('../src/controllers/analytics.controller');

function call(query) {
  return new Promise((resolve, reject) => {
    getReorderSuggestions({ query, user: null, headers: {} }, { json: (body) => resolve(body.data) }, reject);
  });
}

// No borrow history: each line's need is its reorder point (safety stock), so
// the quantities are easy to read. Display order is qty desc, then title.
const row = (id, title, reorderPoint, unitCost, extra = {}) => ({
  variant_id: id, book_id: `b-${id}`, title, author: '', category: '', isbn: '',
  available_qty: 0, on_hand_qty: 0, reserved_qty: 0, borrowed_qty: 0,
  reorder_point: reorderPoint, unit_cost: unitCost, ...extra,
});

test.beforeEach(() => {
  fixture.inventory = [
    row('a', 'A đắt', 5, 100000),
    row('b', 'B rẻ', 3, 10000),
    row('c', 'C chưa có giá', 2, 0),
  ];
  fixture.incoming = [];
  fixture.loans = [];
  sqlSeen.length = 0;
});

test('without a budget the response has no budget block and keeps the plain suggestion', async () => {
  const data = await call({ limit: '20' });
  assert.equal(data.budget, null);
  assert.deepEqual(data.items.map((i) => [i.variant_id, i.suggested_reorder_qty, i.funded_qty]), [['a', 5, undefined], ['b', 3, undefined], ['c', 2, undefined]]);
});

test('a line without a unit cost is never funded as if it were free', async () => {
  for (const budgetVnd of ['0', '10000', '500000', '50000000']) {
    const data = await call({ limit: '20', budgetVnd });
    const c = data.items.find((i) => i.variant_id === 'c');
    assert.equal(c.funded_qty, 0, `budget ${budgetVnd}`);
    assert.equal(c.budget_plan.cap_qty, 2, 'the need is still reported');
    assert.equal(data.budget.unpriced_lines, 1);
    assert.ok(data.budget.funded_qty === data.items.reduce((s, i) => s + i.funded_qty, 0));
  }
});

test('budget totals match the lines and never exceed the budget', async () => {
  // full need is 5 x 100 000 + 3 x 10 000 = 530 000 đ
  const cases = { 0: [0, 0], 10000: [0, 1], 500000: [4, 3], 530000: [5, 3], 50000000: [5, 3] };
  for (const [budgetVnd, [qa, qb]] of Object.entries(cases)) {
    const data = await call({ limit: '20', budgetVnd });
    const byId = Object.fromEntries(data.items.map((i) => [i.variant_id, i]));
    assert.deepEqual([byId.a.funded_qty, byId.b.funded_qty], [qa, qb], `budget ${budgetVnd}`);
    const cost = data.items.reduce((s, i) => s + i.funded_cost, 0);
    assert.equal(data.budget.funded_cost, cost);
    assert.ok(data.budget.funded_cost <= Number(budgetVnd));
    assert.equal(data.budget.remaining_vnd, Number(budgetVnd) - cost);
    for (const i of data.items) assert.ok(i.funded_qty >= 0 && i.funded_qty <= i.budget_plan.cap_qty);
  }
});

test('every funded line is returned, even when it ranks outside the requested limit', async () => {
  // 30 000 đ funds B (3 x 10 000) only; B ranks second, behind A, so limit=1 used to hide it
  const data = await call({ limit: '1', budgetVnd: '30000' });
  const ids = data.items.map((i) => i.variant_id);
  assert.deepEqual(ids, ['a', 'b'], 'top-1 by priority, then the funded line outside it');
  assert.equal(data.items.find((i) => i.variant_id === 'b').funded_qty, 3);
  assert.equal(data.budget.funded_lines_outside_limit, 1);
  assert.equal(data.budget.funded_lines, data.items.filter((i) => i.funded_qty > 0).length);
  // the summary still describes every candidate, not the page
  assert.equal(data.summary.total_candidates, 3);
});

test('without a budget the limit is applied as before', async () => {
  const data = await call({ limit: '1' });
  assert.deepEqual(data.items.map((i) => i.variant_id), ['a']);
});

test('copies on approved purchase orders reduce the budget need; the query skips draft and shortage statuses', async () => {
  fixture.incoming = [{ variant_id: 'a', incoming_qty: 4 }];
  const data = await call({ limit: '20', budgetVnd: '50000000' });
  const a = data.items.find((i) => i.variant_id === 'a');
  assert.equal(a.budget_plan.incoming_qty, 4);
  assert.equal(a.budget_plan.inventory_position, 4);
  assert.equal(a.budget_plan.cap_qty, 1);
  assert.equal(a.funded_qty, 1);
  const poQuery = sqlSeen.find((q) => q.text.includes('FROM purchase_order_items poi'));
  assert.deepEqual(poQuery.params[0], ['APPROVED', 'SENT_TO_SUPPLIER', 'SUPPLIER_CONFIRMED', 'PARTIALLY_RECEIVED']);
  assert.match(poQuery.text, /GREATEST\(poi\.ordered_qty - poi\.received_qty, 0\)/);
});

test('with too little return history no borrowed copy is counted as coming back', async () => {
  fixture.inventory = [row('a', 'A', 5, 100000, { borrowed_qty: 4 })];
  fixture.loans = Array.from({ length: 4 }, () => ({ variant_id: 'a', age_days: 3, duration_days: null }));
  const data = await call({ limit: '20', budgetVnd: '50000000' });
  assert.equal(data.items[0].budget_plan.expected_returns, 0);
  assert.equal(data.budget.returns_model.available, false);
  assert.equal(data.items[0].budget_plan.cap_qty, 5);
});

test('expected returns never exceed the copies inventory records as on loan', async () => {
  // 40 loans returned on day 14 (curve available); 4 open loans aged 10 -> all 4 expected back
  const returned = Array.from({ length: 40 }, () => ({ variant_id: 'x', age_days: 30, duration_days: 14 }));
  const open = Array.from({ length: 4 }, () => ({ variant_id: 'a', age_days: 10, duration_days: null }));
  fixture.loans = [...returned, ...open];

  fixture.inventory = [row('a', 'A', 5, 100000, { borrowed_qty: 4 })];
  let data = await call({ limit: '20', budgetVnd: '50000000' });
  assert.equal(data.budget.returns_model.available, true);
  assert.equal(data.items[0].budget_plan.expected_returns, 4);
  assert.equal(data.items[0].budget_plan.cap_qty, 1);

  // borrow_db says 4 copies are out but inventory says 1: the other 3 are already in
  // available_qty, so counting them again as returns would double count stock
  fixture.inventory = [row('a', 'A', 5, 100000, { borrowed_qty: 1 })];
  data = await call({ limit: '20', budgetVnd: '50000000' });
  assert.equal(data.items[0].budget_plan.expected_returns, 1);
  assert.equal(data.items[0].budget_plan.cap_qty, 4);
});

test('a line whose loans disagree between borrow and inventory is reported, not funded (Phase E)', async () => {
  const returned = Array.from({ length: 40 }, () => ({ variant_id: 'x', age_days: 30, duration_days: 14 }));
  const open = Array.from({ length: 4 }, () => ({ variant_id: 'a', age_days: 10, duration_days: null }));
  fixture.loans = [...returned, ...open];
  // borrow_db: 4 open loans of A; inventory_db: 1 copy on loan -> A's shelf position is unknown
  fixture.inventory = [row('a', 'A', 5, 100000, { borrowed_qty: 1 }), row('b', 'B', 3, 10000)];
  const data = await call({ limit: '20', budgetVnd: '50000000' });
  const byId = Object.fromEntries(data.items.map((i) => [i.variant_id, i]));
  assert.equal(byId.a.funded_qty, 0, 'no purchase recommendation on inconsistent data');
  assert.equal(byId.a.budget_plan.data_issue, 'BORROW_INVENTORY_MISMATCH');
  assert.deepEqual([byId.a.budget_plan.open_loans_borrow, byId.a.budget_plan.borrowed_qty_inventory], [4, 1]);
  assert.equal(byId.b.funded_qty, 3, 'consistent lines are still funded');
  assert.equal(byId.b.budget_plan.data_issue, undefined);
  assert.deepEqual([data.budget.unreliable_lines, data.budget.unreliable_qty], [1, byId.a.budget_plan.cap_qty]);
  assert.deepEqual([data.budget.data_consistency.status, data.budget.data_consistency.excess_open_loans], ['MISMATCH', 3]);
  assert.ok(data.budget.assumptions.some((text) => text.includes('chưa đồng bộ')));

  fixture.inventory = [row('a', 'A', 5, 100000, { borrowed_qty: 4 })];
  const consistent = await call({ limit: '20', budgetVnd: '50000000' });
  assert.equal(consistent.budget.data_consistency.status, 'CONSISTENT');
  assert.equal(consistent.budget.unreliable_lines, 0);
});

test('an invalid budget is rejected', async () => {
  await assert.rejects(call({ budgetVnd: '-1' }), /budgetVnd phải là số không âm/);
  await assert.rejects(call({ budgetVnd: 'abc' }), /budgetVnd phải là số không âm/);
});
