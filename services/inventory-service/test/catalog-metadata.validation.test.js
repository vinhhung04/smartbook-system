const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeIsbn10, normalizeIsbn13, normalizeKeywords, normalizePageCount, normalizePublishYear } = require('../src/services/catalog-metadata.validation');

test('normalizes ISBN-13 and ISBN-10 independently', () => {
  assert.equal(normalizeIsbn13('978-0132350884'), '9780132350884');
  assert.equal(normalizeIsbn10('0-13-235088-2'), '0132350882');
  assert.equal(normalizeIsbn13('0132350882'), null);
  assert.equal(normalizeIsbn10('9780132350884'), null);
});

test('keeps final metadata within catalog validation bounds', () => {
  assert.equal(normalizePublishYear(2024), 2024);
  assert.equal(normalizePublishYear(2200), undefined);
  assert.equal(normalizePageCount(null), null);
  assert.equal(normalizePageCount(0), undefined);
  assert.deepEqual(normalizeKeywords([' clean code ', 'clean code', '', 'x'.repeat(51), 'testing']), ['clean code', 'testing']);
});
