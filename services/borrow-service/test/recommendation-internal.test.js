const assert = require('node:assert/strict');
const test = require('node:test');

const prismaPath = require.resolve('../src/lib/prisma');
const queries = {};
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    prisma: {
      loan_items: {
        findMany: async (q) => {
          queries.loans = q;
          return [
            { variant_id: 'v1', return_date: null, loan_transactions: { customer_id: 'cust-b', borrow_date: new Date('2026-01-02T00:00:00Z') } },
            { variant_id: 'v2', return_date: new Date('2026-01-10T00:00:00Z'), loan_transactions: { customer_id: 'cust-a', borrow_date: new Date('2026-01-01T00:00:00Z') } },
          ];
        },
      },
      book_wishlists: { findMany: async (q) => { queries.wish = q; return [{ customer_id: 'cust-a', book_id: 'b9', created_at: new Date('2026-01-03T00:00:00Z') }]; } },
      book_reviews: { findMany: async (q) => { queries.reviews = q; return [{ customer_id: 'cust-b', book_id: 'b1', rating: 5, created_at: new Date('2026-01-05T00:00:00Z') }]; } },
    },
  },
};

const { getRecommendationInteractions, sinceDate } = require('../src/controllers/recommendation-internal.controller');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test('interaction feed requires the internal service key', async () => {
  process.env.INTERNAL_SERVICE_KEY = 'secret';
  const res = response();
  await getRecommendationInteractions({ headers: {}, query: {} }, res);
  assert.equal(res.statusCode, 403);
});

test('interaction feed is anonymised, batched and only returns visible reviews', async () => {
  process.env.INTERNAL_SERVICE_KEY = 'secret';
  const res = response();
  await getRecommendationInteractions({ headers: { 'x-internal-service-key': 'secret' }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(queries.reviews.where.status, 'VISIBLE');
  const text = JSON.stringify(res.body);
  assert.ok(!text.includes('cust-a') && !text.includes('cust-b'), 'customer ids must not leave the service');
  // Same customer -> same index; indices are dense and deterministic (sorted ids).
  const loanA = res.body.events.find((e) => e.variant_id === 'v2');
  const wishA = res.body.events.find((e) => e.kind === 'WISHLIST');
  assert.equal(loanA.u, 0);
  assert.equal(wishA.u, 0);
  assert.equal(res.body.events.find((e) => e.variant_id === 'v1').u, 1);
  assert.equal(loanA.until, '2026-01-10T00:00:00.000Z');
});

test('since_days is clamped to a sane window', () => {
  const now = Date.UTC(2026, 0, 1);
  assert.equal(sinceDate(undefined, now).getTime(), now - 730 * 86400000);
  assert.equal(sinceDate('99999', now).getTime(), now - 1825 * 86400000);
  assert.equal(sinceDate('-5', now).getTime(), now - 730 * 86400000);
});
