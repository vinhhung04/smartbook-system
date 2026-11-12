const test = require('node:test');
const assert = require('node:assert/strict');
const { mapCatalogRecord, normalizeCatalogCode } = require('../src/services/internal-catalog.service');
const { findCatalogBookByCode } = require('../src/routes/internal-book-corpus.routes');

const KEY = 'by-code-test-key';

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function variant(extra = {}) {
  return {
    id: 'v1', book_id: 'b1', isbn13: '8935212359658', isbn10: null, language_code: 'vi', publish_year: 2021,
    cover_image_url: 'https://cdn.test/cover.webp',
    books: {
      id: 'b1', title: 'Bé ngoan học lễ phép', subtitle: null, description: 'Sách âm thanh',
      metadata: { translator: ['Hà Giang'] }, page_count: 10, published_date: null, default_language: 'vi',
      updated_at: new Date('2026-11-01T00:00:00Z'),
      publishers: { name: 'NXB Hà Nội' },
      book_authors: [{ authors: { full_name: 'Khánh Vân' } }, { authors: { full_name: 'Quỳnh Rùa' } }],
      book_categories: [{ categories: { name: 'Thiếu nhi' } }],
    },
    ...extra,
  };
}

function fakeDb(found) {
  const calls = [];
  return { calls, book_variants: { async findFirst(args) { calls.push(args); return found; } } };
}

async function call(db, code, key = KEY) {
  const res = fakeRes();
  const previous = process.env.INTERNAL_SERVICE_KEY;
  process.env.INTERNAL_SERVICE_KEY = KEY;
  try {
    await findCatalogBookByCode(db)({ headers: key ? { 'x-internal-service-key': key } : {}, params: { code } }, res);
  } finally {
    process.env.INTERNAL_SERVICE_KEY = previous;
  }
  return res;
}

test('codes are normalized and anything but ISBN-10/13 or EAN-13 is refused', () => {
  assert.equal(normalizeCatalogCode('893-5212-35965-8'), '8935212359658');
  assert.equal(normalizeCatalogCode('0-306-40615-x'), '030640615X');
  assert.equal(normalizeCatalogCode('12345'), null);
  assert.equal(normalizeCatalogCode("1' OR 1=1"), null);
});

test('a catalogued edition maps to the lookup field names with every author', () => {
  const record = mapCatalogRecord(variant());
  assert.deepEqual(record.authors, ['Khánh Vân', 'Quỳnh Rùa']);
  assert.deepEqual(record.translator, ['Hà Giang']);
  assert.equal(record.publisher, 'NXB Hà Nội');
  assert.equal(record.published_date, '2021');
  assert.equal(record.page_count, 10);
  assert.deepEqual(record.categories, ['Thiếu nhi']);
  assert.equal(record.isbn13, '8935212359658');
});

test('lookup requires the service key before touching the database', async () => {
  const db = fakeDb(variant());
  assert.equal((await call(db, '8935212359658', null)).statusCode, 403);
  assert.equal((await call(db, '8935212359658', 'wrong')).statusCode, 403);
  assert.equal(db.calls.length, 0);
});

test('lookup rejects malformed codes, finds exact active editions and 404s otherwise', async () => {
  assert.equal((await call(fakeDb(variant()), 'abc')).statusCode, 400);

  const db = fakeDb(variant());
  const found = await call(db, '893-5212-35965-8');
  assert.equal(found.statusCode, 200);
  assert.equal(found.body.title, 'Bé ngoan học lễ phép');
  const where = db.calls[0].where;
  assert.deepEqual(where.OR, [{ isbn13: '8935212359658' }, { isbn10: '8935212359658' }]);
  assert.equal(where.is_active, true);

  assert.equal((await call(fakeDb(null), '9780132350884')).statusCode, 404);
});
