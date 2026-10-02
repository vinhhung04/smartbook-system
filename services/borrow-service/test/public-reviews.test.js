const assert = require('node:assert/strict');
const test = require('node:test');

// Stub prisma before requiring the controller, same approach as my-reviews.test.js.
const prismaPath = require.resolve('../src/lib/prisma');
let capturedFindMany = null;

require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: {
    prisma: {
      book_reviews: {
        findMany: async (query) => {
          capturedFindMany = query;
          return [{ id: 'r1', rating: 5, comment: 'Hay', created_at: new Date('2026-09-01'), customers: { full_name: 'Nguyễn Văn An' } }];
        },
        groupBy: async () => [
          { rating: 5, _count: { rating: 3 } },
          { rating: 4, _count: { rating: 1 } },
        ],
      },
    },
  },
};

const { maskReviewerName, getPublicReviewsByBook } = require('../src/controllers/review.controller');
const publicReviewRoutes = require('../src/routes/public-review.routes');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const BOOK_ID = '11111111-1111-4111-8111-111111111111';

test('public review router is read-only', () => {
  const endpoints = publicReviewRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  assert.deepEqual(endpoints, ['GET /stats', 'GET /book/:bookId']);
});

test('masks reviewer names to given name + family initial', () => {
  assert.equal(maskReviewerName('Nguyễn Văn An'), 'An N.');
  assert.equal(maskReviewerName('  trần   bình '), 'bình T.');
  assert.equal(maskReviewerName('Linh'), 'Linh');
  assert.equal(maskReviewerName(''), 'Bạn đọc');
  assert.equal(maskReviewerName(null), 'Bạn đọc');
});

test('public reviews never select or return customer id, code or full name', async () => {
  const res = response();
  await getPublicReviewsByBook({ params: { bookId: BOOK_ID }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(capturedFindMany.select.customers, { select: { full_name: true } });
  assert.equal('customer_id' in capturedFindMany.select, false);
  assert.deepEqual(res.body.data, [{ id: 'r1', rating: 5, comment: 'Hay', created_at: new Date('2026-09-01'), reviewer_name: 'An N.' }]);
  assert.doesNotMatch(JSON.stringify(res.body), /customer_code|customer_id|Nguyễn Văn An/);
});

test('stats include the real distribution across all reviews, not just the current page', async () => {
  const res = response();
  await getPublicReviewsByBook({ params: { bookId: BOOK_ID }, query: { pageSize: '1' } }, res);
  assert.deepEqual(res.body.stats, { averageRating: 4.8, totalReviews: 4, distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 3 } });
  assert.equal(res.body.meta.totalPages, 4);
});

test('rejects a malformed book id before touching the database', async () => {
  capturedFindMany = null;
  const res = response();
  await getPublicReviewsByBook({ params: { bookId: 'not-a-uuid' }, query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(capturedFindMany, null);
});
