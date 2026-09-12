const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidInternalKey, mapCoverGalleryItem } = require('../src/services/internal-catalog.service');
const internalCatalogRoutes = require('../src/routes/internal-catalog.routes');

test('internal-catalog API exposes the cover-gallery feed route', () => {
  const endpoints = internalCatalogRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
  assert.deepEqual(endpoints, ['GET /']);
});

test('rejects a missing or wrong x-internal-service-key', () => {
  assert.equal(isValidInternalKey(undefined, 'secret'), false);
  assert.equal(isValidInternalKey('', 'secret'), false);
  assert.equal(isValidInternalKey('wrong', 'secret'), false);
});

test('accepts the exact matching key', () => {
  assert.equal(isValidInternalKey('secret', 'secret'), true);
});

test('shapes a book_variants row into the flat gallery item ai-service expects', () => {
  const variant = {
    id: 'variant-1',
    book_id: 'book-1',
    isbn13: '8934974182375',
    cover_image_url: 'https://cdn1.fahasa.com/media/catalog/product/8/9/8934974182375.jpg',
    books: {
      title: 'Người Đàn Ông Mang Tên OVE',
      book_authors: [{ authors: { full_name: 'Fredrik Backman' } }],
    },
  };

  assert.deepEqual(mapCoverGalleryItem(variant), {
    variant_id: 'variant-1',
    book_id: 'book-1',
    title: 'Người Đàn Ông Mang Tên OVE',
    author: 'Fredrik Backman',
    isbn13: '8934974182375',
    cover_image_url: 'https://cdn1.fahasa.com/media/catalog/product/8/9/8934974182375.jpg',
  });
});

test('degrades to null title/author instead of throwing when a book has no authors linked', () => {
  const variant = {
    id: 'variant-2',
    book_id: 'book-2',
    isbn13: null,
    cover_image_url: 'https://example.com/cover.jpg',
    books: { title: 'Sách chưa hoàn chỉnh', book_authors: [] },
  };

  const item = mapCoverGalleryItem(variant);
  assert.equal(item.title, 'Sách chưa hoàn chỉnh');
  assert.equal(item.author, null);
});

test('degrades gracefully when the books relation itself is missing', () => {
  const item = mapCoverGalleryItem({ id: 'variant-3', book_id: 'book-3', isbn13: null, cover_image_url: 'x' });
  assert.equal(item.title, null);
  assert.equal(item.author, null);
});
