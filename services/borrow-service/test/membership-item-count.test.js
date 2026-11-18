const test = require('node:test');
const assert = require('node:assert/strict');
const { countActiveBorrowedItems, countActiveReservedItems } = require('../src/services/membership.service');

test('borrow limit counts active copies, excludes returned/lost copies, and keeps customers separate', async () => {
  const items = [
    { customer: 'a', status: 'BORROWED' }, { customer: 'a', status: 'OVERDUE' },
    { customer: 'a', status: 'RESERVED' }, { customer: 'a', status: 'RETURNED' },
    { customer: 'a', status: 'LOST' }, { customer: 'b', status: 'BORROWED' },
  ];
  const client = { loan_items: { count: async ({ where }) => items.filter(i => where.status.in.includes(i.status) && where.loan_transactions.customer_id === i.customer).length } };
  assert.equal(await countActiveBorrowedItems(client, 'a'), 3);
  assert.equal(await countActiveBorrowedItems(client, 'b'), 1);
  assert.equal(await countActiveBorrowedItems(client, 'none'), 0);
});
test('reservation limit sums copies, excludes expired/cancelled/converted and other readers', async () => {
  const rows = [
    ['a', 'PENDING', 3, '2099-01-01'], ['a', 'CONFIRMED', 2, '2099-01-01'],
    ['a', 'READY_FOR_PICKUP', 1, '2099-01-01'], ['a', 'PENDING', 7, '2000-01-01'],
    ['a', 'CANCELLED', 8, '2099-01-01'], ['a', 'CONVERTED_TO_LOAN', 9, '2099-01-01'],
    ['b', 'CONFIRMED', 10, '2099-01-01'],
  ];
  const client = { loan_reservations: { aggregate: async ({ where }) => ({ _sum: { quantity: rows.filter(([customer, status, , end]) => customer === where.customer_id && where.status.in.includes(status) && new Date(end) > where.expires_at.gt).reduce((n, r) => n + r[2], 0) || null } }) } };
  assert.equal(await countActiveReservedItems(client, 'a'), 6);
  assert.equal(await countActiveReservedItems(client, 'b'), 10);
  assert.equal(await countActiveReservedItems(client, 'none'), 0);
});
