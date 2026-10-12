const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const {
  CORPUS_PAGE_DEFAULT,
  CORPUS_PAGE_MAX,
  isValidInternalKey,
  mapCorpusBook,
  parseCorpusPageParams,
} = require('../src/services/internal-catalog.service');
const { listCorpusBooks } = require('../src/routes/internal-book-corpus.routes');

const KEY = 'corpus-test-key';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function fakeDb(rows) {
  const calls = [];
  return {
    calls,
    books: {
      async findMany(args) {
        calls.push(args);
        const after = args.where.id?.gt;
        return rows
          .filter((row) => row.is_active === args.where.is_active)
          .filter((row) => !after || row.id > after)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, args.take);
      },
    },
  };
}

function row(n, extra = {}) {
  return {
    id: id(n),
    title: `Sách ${n}`,
    subtitle: null,
    description: `Mô tả ${n}`,
    metadata: {},
    updated_at: new Date('2026-10-01T00:00:00Z'),
    is_active: true,
    publishers: { name: 'NXB Trẻ' },
    book_authors: [{ authors: { full_name: 'Nguyễn Nhật Ánh' } }],
    book_categories: [{ categories: { name: 'Văn học' } }],
    book_variants: [{ isbn13: '8934974182375', isbn10: null }],
    ...extra,
  };
}

async function call(db, { key = KEY, query = {} } = {}) {
  const res = fakeRes();
  const previous = process.env.INTERNAL_SERVICE_KEY;
  process.env.INTERNAL_SERVICE_KEY = KEY;
  try {
    await listCorpusBooks(db)({ headers: key ? { 'x-internal-service-key': key } : {}, query }, res);
  } finally {
    process.env.INTERNAL_SERVICE_KEY = previous;
  }
  return res;
}

test('internal key check is length-independent and rejects an unset expected key', () => {
  assert.equal(isValidInternalKey('abc', 'abcd'), false);
  assert.equal(isValidInternalKey('abcd', 'abcd'), true);
  assert.equal(isValidInternalKey('', ''), false);
  assert.equal(isValidInternalKey('anything', undefined), false);
});

test('page params default, clamp and reject a malformed cursor', () => {
  assert.deepEqual(parseCorpusPageParams({}), { limit: CORPUS_PAGE_DEFAULT, after: null });
  assert.equal(parseCorpusPageParams({ limit: '99999' }).limit, CORPUS_PAGE_MAX);
  assert.equal(parseCorpusPageParams({ limit: '-3' }).limit, CORPUS_PAGE_DEFAULT);
  assert.equal(parseCorpusPageParams({ after: id(5) }).after, id(5));
  assert.ok(parseCorpusPageParams({ after: "1' OR 1=1" }).error);
});

test('corpus book keeps real metadata and never embeds UI placeholders', () => {
  const book = mapCorpusBook(row(1, { metadata: { summary_vi: 'Tóm tắt' } }));
  assert.equal(book.author, 'Nguyễn Nhật Ánh');
  assert.equal(book.category, 'Văn học');
  assert.equal(book.summary_vi, 'Tóm tắt');
  assert.equal(book.isbn, '8934974182375');

  const bare = mapCorpusBook(row(2, { book_authors: [], book_categories: [], publishers: null, book_variants: [] }));
  assert.equal(bare.author, null);
  assert.equal(bare.category, null);
  assert.equal(bare.isbn, null);
});

test('feed rejects callers without the service key before touching the database', async () => {
  const db = fakeDb([row(1)]);
  const res = await call(db, { key: null });
  assert.equal(res.statusCode, 403);
  assert.equal(db.calls.length, 0);
  assert.equal((await call(db, { key: 'wrong' })).statusCode, 403);
});

test('feed pages through every active book with a keyset cursor and skips inactive ones', async () => {
  const rows = [row(3), row(1), row(2, { is_active: false }), row(5), row(4)];
  const db = fakeDb(rows);

  const first = await call(db, { query: { limit: '2' } });
  assert.deepEqual(first.body.items.map((b) => b.id), [id(1), id(3)]);
  assert.equal(first.body.next_cursor, id(3));

  const second = await call(db, { query: { limit: '2', after: first.body.next_cursor } });
  assert.deepEqual(second.body.items.map((b) => b.id), [id(4), id(5)]);
  assert.equal(second.body.next_cursor, null);

  // Explicit `id > after`, never Prisma's `cursor` (see the route comment).
  assert.deepEqual(db.calls[1].where, { is_active: true, id: { gt: id(3) } });
  assert.equal(db.calls[1].cursor, undefined);
});

test('a cursor row deleted between pages does not end the scan early', async () => {
  const rows = [row(1), row(2), row(3)];
  const db = fakeDb(rows);
  const first = await call(db, { query: { limit: '1' } });
  rows.splice(0, 1); // the cursor book is hard-deleted before the next page
  const second = await call(db, { query: { limit: '1', after: first.body.next_cursor } });
  assert.deepEqual(second.body.items.map((b) => b.id), [id(2)]);
});

test('a database failure is a 500, never an empty page that looks like an empty catalog', async () => {
  const db = { books: { async findMany() { throw new Error('db down'); } } };
  const res = await call(db);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.items, undefined);
});

test('index mounts the corpus feed outside the JWT-protected /api prefix', () => {
  const source = readFileSync(resolve(__dirname, '../src/index.js'), 'utf8');
  assert.match(source, /app\.use\('\/internal\/catalog\/books', internalBookCorpusRoutes\)/);
  assert.ok(source.indexOf("'/internal/catalog/books'") < source.indexOf("app.use('/api', authenticateToken)"));
});
