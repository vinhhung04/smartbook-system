const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDuplicates } = require('../src/services/duplicate-intelligence.service');

const candidate = { id: 'book-1', title: 'Clean Code', default_language: 'en', publishers: { name: 'Prentice Hall' }, book_authors: [{ authors: { full_name: 'Robert C. Martin' } }], book_variants: [{ id: 'variant-1', isbn13: '9780132350884', sku: 'CC-1', internal_barcode: 'CC-BC', publish_year: 2008, language_code: 'en' }] };

test('classifies an ISBN match as an exact duplicate', () => {
  const result = checkDuplicates({ isbn: '978-0132350884', title: 'Other' }, [candidate]);
  assert.equal(result.classification, 'EXACT_DUPLICATE');
  assert.equal(result.candidates[0].score, 1);
});

test('uses ISBN-13 even when title metadata differs', () => {
  const result = checkDuplicates({ isbn13: '978-0132350884', title: 'Unrelated imported title' }, [candidate]);
  assert.equal(result.classification, 'EXACT_DUPLICATE');
  assert.equal(result.similarityScore, 1);
});

test('recognizes the same work with a different edition', () => {
  const result = checkDuplicates({ title: 'Clean Code', authors: ['Robert C Martin'], publisher: 'Other', publishedDate: '2024-01-01', language: 'vi' }, [candidate]);
  assert.equal(result.classification, 'SAME_WORK_DIFFERENT_EDITION');
});

test('does not flag a close title with a different author', () => {
  const result = checkDuplicates({ title: 'Clean Code', authors: ['Ada Lovelace'] }, [candidate]);
  assert.equal(result.classification, 'NEW_TITLE');
});

test('returns new title with insufficient metadata', () => {
  const result = checkDuplicates({}, [candidate]);
  assert.equal(result.classification, 'NEW_TITLE');
});

test('a retail EAN-13 matches the barcode (or a legacy EAN-in-isbn13 row), never as an ISBN', () => {
  const eanBook = { ...candidate, id: 'book-2', book_variants: [{ id: 'variant-2', isbn13: '9786043927436', internal_barcode: '8935325011894', sku: 'S2' }] };
  const legacy = { ...candidate, id: 'book-3', book_variants: [{ id: 'variant-3', isbn13: '8935309501694', internal_barcode: '8935309501694', sku: 'S3' }] };
  const byBarcode = checkDuplicates({ barcode: '8935325011894', title: 'Other' }, [eanBook]);
  assert.equal(byBarcode.classification, 'SAME_EDITION');
  assert.equal(byBarcode.candidates[0].signals.isbnMatch, false);
  assert.equal(checkDuplicates({ isbn: '8935309501694', title: 'Other' }, [legacy]).classification, 'SAME_EDITION');
});

test('an ISBN-13 also matches a variant whose barcode is that ISBN (Bookland EAN)', () => {
  const book = { ...candidate, id: 'book-4', book_variants: [{ id: 'variant-4', isbn13: null, internal_barcode: '9786043927436', sku: 'S4' }] };
  assert.equal(checkDuplicates({ isbn13: '9786043927436', title: 'Other' }, [book]).classification, 'EXACT_DUPLICATE');
});

test('a code with a wrong check digit matches nothing', () => {
  const result = checkDuplicates({ isbn: '9780132350885', barcode: '8935325011895', title: 'Other' }, [candidate]);
  assert.equal(result.classification, 'NEW_TITLE');
});
