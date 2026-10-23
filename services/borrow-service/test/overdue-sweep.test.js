const test = require('node:test');
const assert = require('node:assert/strict');

const { runOverdueSweep } = require('../src/services/fine.service');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-19T12:00:00Z');

// In-memory prisma: just enough of loan_items.findMany (status / return_date /
// due_date filter, keyset cursor, orderBy due_date+id, take) and the writes the
// sweep makes inside its per-item transaction.
function createFakePrisma(items) {
  const findManyCalls = [];
  const updatedItems = [];
  const tx = {
    async $executeRaw() {},
    loan_items: { async update({ where }) { updatedItems.push(where.id); } },
    loan_transactions: { async update() {} },
    fines: {
      async findFirst() { return null; },
      async create({ data }) { return { id: `fine-${data.loan_item_id}`, ...data }; },
      async update({ data }) { return data; },
      async findMany() { return []; },
    },
    customer_notifications: { async create({ data }) { return { id: 'n', ...data }; } },
    borrow_audit_logs: { async create() {} },
    customers: { async update() {} },
  };
  const prisma = {
    findManyCalls,
    updatedItems,
    loan_items: {
      async findMany(args) {
        findManyCalls.push(args);
        const { where, take } = args;
        let rows = items.filter((item) => where.status.in.includes(item.status)
          && item.return_date === null
          && item.due_date < where.due_date.lt);
        if (where.OR) {
          const [after, tie] = where.OR;
          rows = rows.filter((item) => item.due_date > after.due_date.gt
            || (item.due_date.getTime() === tie.due_date.getTime() && item.id > tie.id.gt));
        }
        rows.sort((a, b) => a.due_date - b.due_date || a.id.localeCompare(b.id));
        return rows.slice(0, take);
      },
    },
    customer_memberships: {
      async findFirst() { return { membership_plans: { fine_per_day: 5000 } }; },
    },
    async $transaction(fn) { return fn(tx); },
  };
  return prisma;
}

function item(id, daysLate, status = 'BORROWED') {
  return {
    id,
    status,
    return_date: null,
    due_date: new Date(NOW.getTime() - daysLate * DAY),
    loan_transactions: { id: `loan-${id}`, loan_number: `L-${id}`, status: 'BORROWED', customer_id: `cust-${id}` },
  };
}

test('runOverdueSweep reaches every overdue line, not just the first batch', async () => {
  // Five overdue lines, two already OVERDUE with the oldest due dates: with a
  // single `take` of 2 the newly overdue ones behind them were never reached.
  const prisma = createFakePrisma([
    item('a', 40, 'OVERDUE'), item('b', 30, 'OVERDUE'), item('c', 3), item('d', 2), item('e', 1),
    item('not-due', -2),
  ]);

  const result = await runOverdueSweep(prisma, { now: NOW, limit: 2 });

  assert.equal(result.scanned, 5);
  assert.equal(result.processed_items, 5);
  assert.deepEqual(prisma.updatedItems.sort(), ['c', 'd', 'e'], 'every BORROWED line past due is marked OVERDUE');
  assert.equal(prisma.findManyCalls.length, 3, 'batches of 2: 2 + 2 + 1');
  for (const call of prisma.findManyCalls) assert.equal(call.take, 2);
});

test('runOverdueSweep pages with a stable (due_date, id) keyset so ties are neither skipped nor repeated', async () => {
  const sameDay = ['t1', 't2', 't3'].map((id) => item(id, 5));
  const prisma = createFakePrisma(sameDay);

  const result = await runOverdueSweep(prisma, { now: NOW, limit: 2 });

  assert.equal(result.processed_items, 3);
  assert.deepEqual(prisma.updatedItems, ['t1', 't2', 't3']);
  assert.deepEqual(prisma.findManyCalls[0].orderBy, [{ due_date: 'asc' }, { id: 'asc' }]);
});
