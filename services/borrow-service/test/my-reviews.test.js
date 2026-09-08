const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

// Stub the two modules the controller pulls in, before requiring it, so the test
// exercises the scoping logic without a database.
const prismaPath = require.resolve('../src/lib/prisma');
const customerControllerPath = require.resolve('../src/controllers/customer.controller');

let capturedQuery = null;
let resolvedCustomer = { id: 'customer-1' };

require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    prisma: {
      book_reviews: {
        findMany: async (query) => {
          capturedQuery = query;
          return [{ book_id: 'book-1', rating: 5 }];
        },
      },
    },
  },
};

require.cache[customerControllerPath] = {
  id: customerControllerPath,
  filename: customerControllerPath,
  loaded: true,
  exports: { ensureCurrentCustomer: async () => resolvedCustomer },
};

const { getMyReviews } = require('../src/controllers/review.controller');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('my reviews are scoped to the resolved customer, not the auth user id', async () => {
  resolvedCustomer = { id: 'customer-1' };
  const res = response();
  // req.user.id is the auth user id; it must never be used as the customer id.
  await getMyReviews({ user: { id: 'auth-user-999' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(capturedQuery.where.customer_id, 'customer-1');
  assert.deepEqual(res.body.data, [{ book_id: 'book-1', rating: 5 }]);
});

test('a signed-in user without a customer profile gets 404, not an empty list', async () => {
  resolvedCustomer = null;
  const res = response();
  await getMyReviews({ user: { id: 'auth-user-999' } }, res);

  assert.equal(res.statusCode, 404);
});
