// Regression: review writes must use the borrow-service customer id resolved by
// ensureCurrentCustomer, not req.user.id (the auth user id), which violated
// book_reviews_customer_id_fkey and returned HTTP 500.
//
// Verified-reader rule: a customer may only review (create or update) a book
// they borrowed — any edition — and RETURNED.
const assert = require('node:assert/strict');
const test = require('node:test');

const prismaPath = require.resolve('../src/lib/prisma');
const customerControllerPath = require.resolve('../src/controllers/customer.controller');
const inventoryPath = require.resolve('../src/services/inventory-integration.service');

const BOOK_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BOOK_ID = '22222222-2222-4222-8222-222222222222';
const VARIANTS = { [BOOK_ID]: ['variant-a', 'variant-b'], [OTHER_BOOK_ID]: ['variant-z'] };

let upsertArgs = null;
let findUniqueArgs = null;
let loanItemQueries = [];
let returnedItems = []; // { customer_id, variant_id, status }
let inventoryDown = false;

require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true,
  exports: {
    prisma: {
      book_reviews: {
        upsert: async (args) => { upsertArgs = args; return { id: 'r1', ...args.create }; },
        findUnique: async (args) => { findUniqueArgs = args; return null; },
      },
      loan_items: {
        count: async ({ where }) => {
          loanItemQueries.push(where);
          return returnedItems.filter((item) => where.variant_id.in.includes(item.variant_id)
            && item.status === where.status
            && item.customer_id === where.loan_transactions.customer_id).length;
        },
      },
    },
  },
};
require.cache[customerControllerPath] = {
  id: customerControllerPath, filename: customerControllerPath, loaded: true,
  exports: { ensureCurrentCustomer: async () => ({ id: 'customer-row-1' }) },
};
require.cache[inventoryPath] = {
  id: inventoryPath, filename: inventoryPath, loaded: true,
  exports: {
    getBookVariantIds: async ({ bookId }) => {
      if (inventoryDown) throw new Error('inventory unreachable');
      return VARIANTS[bookId] || [];
    },
  },
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

function reset({ returned = [], down = false } = {}) {
  upsertArgs = null;
  loanItemQueries = [];
  returnedItems = returned;
  inventoryDown = down;
}

async function review(body) {
  const res = response();
  await createOrUpdateMyReview({ user: authUser, body }, res);
  return res;
}

test('createOrUpdateMyReview writes with the resolved customer id', async () => {
  reset({ returned: [{ customer_id: 'customer-row-1', variant_id: 'variant-b', status: 'RETURNED' }] });
  const res = await review({ book_id: BOOK_ID, rating: 5 });
  assert.equal(res.statusCode, 200);
  assert.equal(upsertArgs.create.customer_id, 'customer-row-1');
  assert.deepEqual(upsertArgs.where.customer_id_book_id, { customer_id: 'customer-row-1', book_id: BOOK_ID });
  // Eligibility looked at every edition of the book, scoped to this customer.
  assert.deepEqual(loanItemQueries[0], { variant_id: { in: ['variant-a', 'variant-b'] }, status: 'RETURNED', loan_transactions: { customer_id: 'customer-row-1' } });
});

test('a customer who never borrowed the book cannot review it', async () => {
  reset();
  const res = await review({ book_id: BOOK_ID, rating: 4 });
  assert.equal(res.statusCode, 403);
  assert.equal(upsertArgs, null);
});

test('a loan that is still out, lost, or belongs to another customer or book does not count', async () => {
  for (const returned of [
    [{ customer_id: 'customer-row-1', variant_id: 'variant-a', status: 'BORROWED' }],
    [{ customer_id: 'customer-row-1', variant_id: 'variant-a', status: 'LOST' }],
    [{ customer_id: 'someone-else', variant_id: 'variant-a', status: 'RETURNED' }],
    [{ customer_id: 'customer-row-1', variant_id: 'variant-z', status: 'RETURNED' }],
  ]) {
    reset({ returned });
    const res = await review({ book_id: BOOK_ID, rating: 4 });
    assert.equal(res.statusCode, 403, JSON.stringify(returned));
    assert.equal(upsertArgs, null);
  }
});

test('rating must be 1–5 and book_id a UUID; the check fails closed when inventory is down', async () => {
  reset({ returned: [{ customer_id: 'customer-row-1', variant_id: 'variant-a', status: 'RETURNED' }] });
  for (const rating of [0, 6, 2.5, 'x']) assert.equal((await review({ book_id: BOOK_ID, rating })).statusCode, 400);
  assert.equal((await review({ book_id: 'book-1', rating: 5 })).statusCode, 400);

  reset({ down: true });
  const res = await review({ book_id: BOOK_ID, rating: 5 });
  assert.equal(res.statusCode, 503);
  assert.equal(upsertArgs, null);
});

test('updating keeps one review per customer and book (upsert on the compound key)', async () => {
  reset({ returned: [{ customer_id: 'customer-row-1', variant_id: 'variant-a', status: 'RETURNED' }] });
  await review({ book_id: BOOK_ID, rating: 3, comment: 'ổn' });
  assert.deepEqual(upsertArgs.update, { rating: 3, comment: 'ổn', updated_at: upsertArgs.update.updated_at });
  assert.deepEqual(Object.keys(upsertArgs.where), ['customer_id_book_id']);
});

test('getMyReviewForBook and deleteMyReview look up by the resolved customer id', async () => {
  reset();
  const mine = response();
  await getMyReviewForBook({ user: authUser, params: { bookId: BOOK_ID } }, mine);
  assert.equal(findUniqueArgs.where.customer_id_book_id.customer_id, 'customer-row-1');
  assert.equal(mine.body.can_review, false);
  const res = response();
  await deleteMyReview({ user: authUser, params: { bookId: BOOK_ID } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(findUniqueArgs.where.customer_id_book_id.customer_id, 'customer-row-1');
});
