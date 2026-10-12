const assert = require('node:assert/strict');
const test = require('node:test');

// The staff borrow pages page, filter, search and count on the server. These tests pin the
// list endpoints' query contract: comma-separated status filters, free-text search that never
// compares a name against a UUID column, per-status counts that ignore the status filter (so
// every tab shows its own total), and the fines money summary.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const calls = [];

function delegate(name, rows = []) {
  return {
    findMany: async (args) => { calls.push({ name, op: 'findMany', args }); return rows; },
    count: async (args) => { calls.push({ name, op: 'count', args }); return rows.length; },
    groupBy: async (args) => {
      calls.push({ name, op: 'groupBy', args });
      return [
        { status: 'BORROWED', _count: { _all: 4 } },
        { status: 'OVERDUE', _count: { _all: 2 } },
      ];
    },
  };
}

const fakePrisma = {
  loan_transactions: delegate('loan_transactions'),
  loan_reservations: delegate('loan_reservations'),
  fines: delegate('fines'),
  customers: delegate('customers'),
  $queryRaw: async (...args) => {
    calls.push({ name: 'raw', op: '$queryRaw', args });
    return [{ outstanding: '494423000', collected: '96614000', open_count: 1612n }];
  },
};

const prismaPath = require.resolve('../src/lib/prisma');
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: fakePrisma } };

const { listLoans } = require('../src/controllers/loan.controller');
const { listReservations } = require('../src/controllers/reservation.controller');
const { listFines } = require('../src/controllers/fine.controller');
const { listCustomers } = require('../src/controllers/customer.controller');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function lastCall(name, op) {
  return [...calls].reverse().find((call) => call.name === name && call.op === op);
}

test('loan search by name does not compare the term against the customer_id UUID column', async () => {
  calls.length = 0;
  const res = response();
  await listLoans({ query: { q: 'Tran' } }, res);

  assert.equal(res.statusCode, 200);
  const where = lastCall('loan_transactions', 'findMany').args.where;
  assert.ok(Array.isArray(where.OR));
  assert.ok(!where.OR.some((clause) => 'customer_id' in clause), 'non-UUID term must not hit customer_id');
  assert.ok(where.OR.some((clause) => clause.customers?.full_name), 'searches the customer name');
  assert.ok(where.OR.some((clause) => clause.loan_number), 'searches the loan number');
});

test('loan search by a UUID still matches the customer id exactly', async () => {
  calls.length = 0;
  const id = '24b97ff5-5963-4ae4-b6c6-66899f31566d';
  await listLoans({ query: { q: id } }, response());

  const where = lastCall('loan_transactions', 'findMany').args.where;
  assert.ok(where.OR.some((clause) => clause.customer_id === id));
});

test('loans accept a comma-separated status filter, due-date sort and report per-status counts', async () => {
  calls.length = 0;
  const res = response();
  await listLoans({ query: { status: 'borrowed,OVERDUE', sort: 'due_date' } }, res);

  const find = lastCall('loan_transactions', 'findMany').args;
  assert.deepEqual(find.where.status, { in: ['BORROWED', 'OVERDUE'] });
  assert.deepEqual(find.orderBy, [{ due_date: 'asc' }]);

  const group = lastCall('loan_transactions', 'groupBy').args;
  assert.equal(group.where.status, undefined, 'counts ignore the status filter so every tab has a total');
  assert.deepEqual(res.body.meta.status_counts, { BORROWED: 4, OVERDUE: 2 });
});

test('a single status filter stays a plain equality', async () => {
  calls.length = 0;
  await listLoans({ query: { status: 'RETURNED' } }, response());
  assert.equal(lastCall('loan_transactions', 'findMany').args.where.status, 'RETURNED');
});

test('reservations support search, grouped status filter, expiry sort and counts', async () => {
  calls.length = 0;
  const res = response();
  await listReservations({ query: { q: 'RSV-3F', status: 'CONVERTED_TO_LOAN,EXPIRED,CANCELLED', sort: 'expires_at' } }, res);

  assert.equal(res.statusCode, 200);
  const find = lastCall('loan_reservations', 'findMany').args;
  assert.deepEqual(find.where.status, { in: ['CONVERTED_TO_LOAN', 'EXPIRED', 'CANCELLED'] });
  assert.ok(find.where.OR.some((clause) => clause.reservation_number));
  assert.ok(find.where.OR.some((clause) => clause.customers?.full_name));
  assert.deepEqual(find.orderBy, [{ expires_at: 'asc' }]);

  const group = lastCall('loan_reservations', 'groupBy').args;
  assert.equal(group.where.status, undefined);
  assert.ok(group.where.OR, 'counts honour the search term');
  assert.deepEqual(res.body.meta.status_counts, { BORROWED: 4, OVERDUE: 2 });
});

test('fines support search and return the money summary only when asked', async () => {
  calls.length = 0;
  const plain = response();
  await listFines({ query: { q: 'Le Van' } }, plain);

  assert.equal(plain.statusCode, 200);
  const where = lastCall('fines', 'findMany').args.where;
  assert.ok(where.OR.some((clause) => clause.customers?.full_name));
  assert.equal(plain.body.meta.summary, undefined);
  assert.equal(lastCall('raw', '$queryRaw'), undefined);

  const withSummary = response();
  await listFines({ query: { summary: '1' } }, withSummary);
  assert.deepEqual(withSummary.body.meta.summary, { outstanding: 494423000, collected: 96614000, open_count: 1612 });
});

test('fine list items carry the loan number so the page can link to the loan', async () => {
  calls.length = 0;
  await listFines({ query: {} }, response());
  const include = lastCall('fines', 'findMany').args.include;
  assert.ok(include.loan_items.select.loan_transactions, 'loan_items selects its loan');
});

test('customers report per-status counts alongside the page', async () => {
  calls.length = 0;
  const res = response();
  await listCustomers({ query: { status: 'ACTIVE', q: 'Khoa' } }, res);

  const group = lastCall('customers', 'groupBy').args;
  assert.equal(group.where.status, undefined);
  assert.ok(group.where.OR);
  assert.deepEqual(res.body.meta.status_counts, { BORROWED: 4, OVERDUE: 2 });
});
