const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeCatalogSignals } = require('../src/utils/catalog-signals');

test('folds variant-level loans and reservations into their book', () => {
  const books = mergeCatalogSignals({
    variantBookRows: [
      { variant_id: 'v1', book_id: 'b1' },
      { variant_id: 'v2', book_id: 'b1' },
      { variant_id: 'v3', book_id: 'b2' },
    ],
    loanRows: [
      { variant_id: 'v1', borrow_count: '4', recent_borrow_count: '1' },
      { variant_id: 'v2', borrow_count: '2', recent_borrow_count: '2' },
      { variant_id: 'v3', borrow_count: '1', recent_borrow_count: '0' },
    ],
    reservationRows: [{ variant_id: 'v2', reservation_count: '3' }],
  });
  const b1 = books.find((book) => book.book_id === 'b1');
  assert.equal(b1.borrow_count, 6);
  assert.equal(b1.recent_borrow_count, 3);
  assert.equal(b1.recent_reservation_count, 3);
  assert.equal(books.find((book) => book.book_id === 'b2').borrow_count, 1);
});

test('drops variants that no longer resolve to a book instead of guessing', () => {
  const books = mergeCatalogSignals({
    variantBookRows: [],
    loanRows: [{ variant_id: 'deleted', borrow_count: '9', recent_borrow_count: '9' }],
  });
  assert.deepEqual(books, []);
});

test('keeps wishlist and rating rows keyed by book, rounding the average', () => {
  const [book] = mergeCatalogSignals({
    wishlistRows: [{ book_id: 'b9', wishlist_count: '5' }],
    ratingRows: [{ book_id: 'b9', rating_avg: '4.333333', rating_count: '3' }],
  });
  assert.deepEqual(book, {
    book_id: 'b9',
    borrow_count: 0,
    recent_borrow_count: 0,
    recent_reservation_count: 0,
    recent_wishlist_count: 5,
    rating_avg: 4.3,
    rating_count: 3,
  });
});

test('response carries aggregate counts only — no customer fields', () => {
  const [book] = mergeCatalogSignals({ ratingRows: [{ book_id: 'b1', rating_avg: 5, rating_count: 1, customer_id: 'c1' }] });
  assert.equal('customer_id' in book, false);
});
