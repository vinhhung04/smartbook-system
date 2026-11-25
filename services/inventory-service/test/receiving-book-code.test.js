const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyReceivingCode } = require('../src/controllers/supplier-delivery.controller');

test('a code read from the book at receiving: standard codes stay standard, others become internal', () => {
  assert.deepEqual(classifyReceivingCode('9780132350884'), { isbn13: '9780132350884', internal_barcode: '9780132350884', standard: true });
  assert.equal(classifyReceivingCode('8935244817744').isbn13, null); // retail EAN-13 is not an ISBN
  assert.equal(classifyReceivingCode('8935244817744').internal_barcode, '8935244817744');
  // ISBN-10 0-306-40615-2 is ISBN-13 978-0-306-40615-7
  assert.deepEqual(classifyReceivingCode('0-306-40615-2'), { isbn13: '9780306406157', isbn10: '0306406152', internal_barcode: '9780306406157', standard: true });
  // a book without a standard barcode keeps the code staff typed as its internal code
  assert.deepEqual(classifyReceivingCode(' NCC-DB-01 '), { isbn13: null, internal_barcode: 'NCC-DB-01', standard: false });
  assert.equal(classifyReceivingCode('2').internal_barcode, '2');
  // 10 digits that are not a valid ISBN-10 are an internal code, like the catalog accepts
  assert.deepEqual(classifyReceivingCode('1234567890'), { isbn13: null, internal_barcode: '1234567890', standard: false });
});

test('unusable codes are refused with a reason', () => {
  assert.match(classifyReceivingCode('').error, /Nhập hoặc quét/);
  assert.match(classifyReceivingCode('9780132350885').error, /sai số kiểm tra/); // wrong check digit
  assert.match(classifyReceivingCode('x'.repeat(51)).error, /50 ký tự/);
});
