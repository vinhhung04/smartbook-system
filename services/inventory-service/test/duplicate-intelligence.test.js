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
