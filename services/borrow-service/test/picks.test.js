const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePicks } = require('../src/utils/picks');

const K03 = '00000000-0000-4000-8000-000000000103';
const K05 = '00000000-0000-4000-8000-000000000105';

test('picks across shelves that add up to the borrowed quantity are accepted', () => {
  assert.deepEqual(parsePicks([{ location_id: K03, quantity: 1 }, { location_id: K05, quantity: '1' }], 2), {
    picks: [{ location_id: K03, quantity: 1 }, { location_id: K05, quantity: 1 }],
  });
});

test('missing, malformed or mis-totalled picks are rejected with a message', () => {
  for (const [raw, expected] of [
    [undefined, 1],
    [[], 1],
    [[{ location_id: 'KE-03', quantity: 1 }], 1],
    [[{ location_id: K03, quantity: 0 }], 1],
    [[{ location_id: K03, quantity: 1.5 }], 1],
    [[{ location_id: K03, quantity: 1 }], 2],
  ]) {
    assert.equal(typeof parsePicks(raw, expected).error, 'string', JSON.stringify(raw));
  }
});
