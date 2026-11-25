// Fines follow the branch that lent the copy: a librarian lists, opens, takes
// payment on and waives only fines of their own branches' loans (plus fines
// tied to no loan). Prisma and auth-service are replaced.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const OWN = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000002';
const FINE_OTHER = 'bbbbbbbb-0000-4000-8000-000000000001';
const FINE_UNLINKED = 'bbbbbbbb-0000-4000-8000-000000000002';

const calls = [];
const fines = {
  [FINE_OTHER]: { loan_items: { loan_transactions: { warehouse_id: OTHER } } },
  [FINE_UNLINKED]: { loan_items: null },
};
const prismaPath = path.join(__dirname, '..', 'src', 'lib', 'prisma.js');
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: {
    prisma: {
      fines: {
        findMany: async (args) => { calls.push(['findMany', args]); return []; },
        count: async (args) => { calls.push(['count', args]); return 0; },
        groupBy: async (args) => { calls.push(['groupBy', args]); return []; },
        findUnique: async ({ where }) => fines[where.id] || null,
      },
      $queryRaw: async (strings, ...values) => { calls.push(['summary', values]); return [{}]; },
      $transaction: async () => { calls.push(['transaction']); return { code: 200, payload: {} }; },
    },
  },
};

const scope = require('../src/utils/warehouse-scope.utils');
scope.setWarehouseScopeResolver({
  resolve: async (user) => ({ all: user.is_superuser === true, read: new Set(user.is_superuser ? [] : [OWN]), write: new Set([OWN]) }),
  canRead: async (user, id) => user.is_superuser === true || id === OWN,
  canWrite: async (user, id) => user.is_superuser === true || id === OWN,
});
const fine = require('../src/controllers/fine.controller');

const LIBRARIAN = { id: 'cccccccc-0000-4000-8000-000000000001', permissions: ['borrow.fines.manage'] };
const res = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } });
const call = async (handler, user, { params = {}, query = {}, body = {}, headers = {} } = {}) => {
  const r = res();
  await handler({ user, params, query, body, headers }, r);
  return r;
};

test('the fine list is limited to the caller\'s branches (and fines tied to no loan)', async () => {
  calls.length = 0;
  await call(fine.listFines, LIBRARIAN, { query: { summary: '1' } });
  const where = calls.find(([k]) => k === 'findMany')[1].where;
  assert.deepEqual(where.AND, [{ OR: [{ loan_item_id: null }, { loan_items: { loan_transactions: { warehouse_id: { in: [OWN] } } } }] }]);
  assert.deepEqual(calls.find(([k]) => k === 'groupBy')[1].where.AND, where.AND, 'tab counts use the same scope');
  const summary = calls.find(([k]) => k === 'summary')[1];
  assert.ok(summary.includes(false) && summary.some((v) => Array.isArray(v) && v[0] === OWN), 'money totals scoped');

  calls.length = 0;
  await call(fine.listFines, { id: 'su', is_superuser: true });
  assert.deepEqual(calls.find(([k]) => k === 'findMany')[1].where.AND, [{}]);
});

test('a fine of another branch cannot be opened, paid or waived', async () => {
  assert.equal((await call(fine.getFineById, LIBRARIAN, { params: { id: FINE_OTHER } })).statusCode, 403);
  calls.length = 0;
  const pay = await call(fine.recordFinePayment, LIBRARIAN, {
    params: { id: FINE_OTHER }, body: { amount: 1000, payment_method: 'CASH' }, headers: { 'idempotency-key': 'k1' },
  });
  assert.equal(pay.statusCode, 403);
  const waive = await call(fine.waiveFine, LIBRARIAN, { params: { id: FINE_OTHER }, body: {} });
  assert.equal(waive.statusCode, 403);
  assert.ok(!calls.some(([k]) => k === 'transaction'), 'nothing was written');
});

test('a fine tied to no loan stays reachable', async () => {
  calls.length = 0;
  await call(fine.recordFinePayment, LIBRARIAN, {
    params: { id: FINE_UNLINKED }, body: { amount: 1000, payment_method: 'CASH' }, headers: { 'idempotency-key': 'k2' },
  });
  assert.ok(calls.some(([k]) => k === 'transaction'));
});
