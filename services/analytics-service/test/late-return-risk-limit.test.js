// GET /late-return-risk?limit= through the real controller with fixture rows (no Postgres).
// Regression: `limit` used to cut the open loans by due date BEFORE scoring, so limit=5 returned
// 5 arbitrary loans instead of the 5 riskiest. Now every open loan is scored, ranked, then cut.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const DAY = 86_400_000;
const base = Date.parse('2026-01-01T00:00:00Z');
const sqlSeen = [];

const loanRow = (id, borrowDay, priorLate, extra = {}) => ({
  loan_item_id: id,
  variant_id: `v-${id}`,
  customer_name: `Bạn đọc ${id}`,
  borrow_date: new Date(base + borrowDay * DAY).toISOString(),
  original_due_date: new Date(base + (borrowDay + 14) * DAY).toISOString(),
  due_date: new Date(base + (borrowDay + 14) * DAY).toISOString(),
  return_date: null,
  items_in_loan: 1,
  prior_loans: 5,
  prior_late_count: priorLate,
  prior_renewal_count: 0,
  customer_created_at: new Date(base - 365 * DAY).toISOString(),
  unpaid_fines_at_checkout: 0,
  plan_max_loan_days: 14,
  plan_fine_per_day: 1000,
  from_reservation: false,
  condition_worn_at_checkout: false,
  ...extra,
});

// History the model can learn from: readers with 3+ earlier late returns return late again.
const training = Array.from({ length: 400 }, (_, i) => {
  const priorLate = i % 5;
  const late = priorLate >= 3 ? i % 7 !== 0 : i % 11 === 0;
  const row = loanRow(`t${i}`, i % 300, priorLate);
  return { ...row, return_date: new Date(Date.parse(row.due_date) + (late ? 3 : -1) * DAY).toISOString() };
});

// The safe loan is due first; the risky one is due last. The old query (ORDER BY due_date LIMIT 1) only saw the safe one.
const open = [
  loanRow('safe-due-first', 300, 0),
  loanRow('middle', 301, 1),
  loanRow('risky-due-last', 302, 4),
];

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
      if (text.includes('WHERE li.return_date IS NOT NULL')) return training;
      if (text.includes('WHERE li.return_date IS NULL')) return open;
      return [];
    },
    async queryOne() { return {}; },
    async pingDatabases() { return { inventory: true, borrow: true }; },
  },
};

const { getLateReturnRisk } = require('../src/controllers/analytics.controller');

function call(query) {
  return new Promise((resolve, reject) => {
    getLateReturnRisk({ query, user: null, headers: {} }, { json: (body) => resolve(body.data) }, reject);
  });
}

test('limit keeps the riskiest open loans, not the ones due first', async () => {
  const data = await call({ limit: '1' });
  assert.equal(data.status, undefined, data.reason);
  assert.deepEqual(data.items.map((item) => item.loan_item_id), ['risky-due-last']);

  const scoringSql = sqlSeen.find(({ text }) => text.includes('WHERE li.return_date IS NULL'));
  assert.doesNotMatch(scoringSql.text, /LIMIT \$\d/);
});

test('items come riskiest first', async () => {
  const data = await call({ limit: '3' });
  const scores = data.items.map((item) => item.risk_score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  assert.equal(data.items.length, 3);
});
