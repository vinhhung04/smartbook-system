const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyBookCode, normalizeInternalBarcode, normalizeIsbn10, normalizeIsbn13, normalizeKeywords, normalizePageCount, normalizePublishYear } = require('../src/services/catalog-metadata.validation');

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

test('ISBN-13 needs 978/979 and its check digit: a retail EAN-13 is never an ISBN', () => {
  assert.equal(normalizeIsbn13('979-1234567896'), '9791234567896');
  assert.equal(normalizeIsbn13('8935309501694'), null); // valid EAN-13, not an ISBN
  assert.equal(normalizeIsbn13('9780132350885'), null); // wrong check digit
  assert.equal(normalizeIsbn10('080442957x'), '080442957X');
  assert.equal(normalizeIsbn10('0132350883'), null);
});

test('book codes are classified by kind before they are stored or compared', () => {
  const kind = (value) => classifyBookCode(value).kind;
  assert.equal(kind('978-0-13-235088-4'), 'ISBN13');
  assert.equal(kind('9791234567896'), 'ISBN13');
  assert.equal(kind('0-13-235088-2'), 'ISBN10');
  assert.equal(kind('080442957X'), 'ISBN10');
  assert.equal(kind('8935309501694'), 'EAN13');
  assert.equal(kind('8935309501695'), 'INVALID');
  assert.equal(kind('9780132350885'), 'INVALID');
  assert.equal(kind('0132350883'), 'INVALID');
  assert.equal(kind('MANUAL-8935-AB12'), 'OTHER');
  assert.equal(kind('  '), 'EMPTY');
  assert.equal(classifyBookCode('893-5309-50169-4').code, '8935309501694');
});

test('internal_barcode takes a valid EAN-13, an ISBN-13 or an internal code, never a bad check digit', () => {
  assert.equal(normalizeInternalBarcode('8935309501694'), '8935309501694');
  assert.equal(normalizeInternalBarcode('9780132350884'), '9780132350884');
  assert.equal(normalizeInternalBarcode('CC-BC'), 'CC-BC');
  assert.equal(normalizeInternalBarcode(''), null);
  assert.equal(normalizeInternalBarcode('8935309501695'), undefined);
  assert.equal(normalizeInternalBarcode('x'.repeat(51)), undefined);
});
