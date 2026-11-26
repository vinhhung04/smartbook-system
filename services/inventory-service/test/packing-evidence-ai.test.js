const test = require('node:test');
const assert = require('node:assert/strict');
const { countMatches, findUnexpectedTitles } = require('../src/services/packing-evidence-ai.service');

test('small packs need an exact count; seeing nothing never matches', () => {
  assert.equal(countMatches(0, 1), false);
  assert.equal(countMatches(2, 1), false);
  assert.equal(countMatches(1, 1), true);
  assert.equal(countMatches(3, 3), true);
  assert.equal(countMatches(4, 3), false);
});

test('large packs tolerate one miscounted book', () => {
  assert.equal(countMatches(9, 10), true);
  assert.equal(countMatches(8, 10), false);
});

test('a title from another order is flagged; accents and partial reads still match', () => {
  const expected = ['Rừng Na Uy', 'Đắc Nhân Tâm'];
  assert.deepEqual(findUnexpectedTitles(['RUNG NA UY', 'Dac nhan', 'Nhà Giả Kim'], expected), ['Nhà Giả Kim']);
  assert.deepEqual(findUnexpectedTitles(['ab'], expected), []);
});
