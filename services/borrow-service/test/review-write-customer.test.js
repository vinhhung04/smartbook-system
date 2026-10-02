// Regression: review writes must use the borrow-service customer id resolved by
// ensureCurrentCustomer, not req.user.id (the auth user id), which violated
// book_reviews_customer_id_fkey and returned HTTP 500.
const assert = require('node:assert/strict');
const test = require('node:test');

const prismaPath = require.resolve('../src/lib/prisma');
const customerControllerPath = require.resolve('../src/controllers/customer.controller');

let upsertArgs = null;
let findUniqueArgs = null;
require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: {
    prisma: {
      book_reviews: {
        upsert: async (args) => { upsertArgs = args; return { id: 'r1', ...args.create }; },
        findUnique: async (args) => { findUniqueArgs = args; return null; },
      },
    },
  },
};
require.cache[customerControllerPath] = {
  id: customerControllerPath, filename: customerControllerPath, loaded: true,
  exports: { ensureCurrentCustomer: async () => ({ id: 'customer-row-1' }) },
};

const { createOrUpdateMyReview, getMyReviewForBook, deleteMyReview } = require('../src/controllers/review.controller');

function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
const authUser = { id: 'auth-user-9', roles: ['CUSTOMER'] };

test('createOrUpdateMyReview writes with the resolved customer id', async () => {
  const res = response();
  await createOrUpdateMyReview({ user: authUser, body: { book_id: 'book-1', rating: 5 } }, res);
  assert.equal(upsertArgs.create.customer_id, 'customer-row-1');
  assert.deepEqual(upsertArgs.where.customer_id_book_id, { customer_id: 'customer-row-1', book_id: 'book-1' });
});

test('getMyReviewForBook and deleteMyReview look up by the resolved customer id', async () => {
  await getMyReviewForBook({ user: authUser, params: { bookId: 'book-1' } }, response());
  assert.equal(findUniqueArgs.where.customer_id_book_id.customer_id, 'customer-row-1');
  const res = response();
  await deleteMyReview({ user: authUser, params: { bookId: 'book-1' } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(findUniqueArgs.where.customer_id_book_id.customer_id, 'customer-row-1');
});
