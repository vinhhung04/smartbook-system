const test = require('node:test');
const assert = require('node:assert/strict');
const { occupancy, describe } = require('../eval/real-copies');

const day = (n) => new Date(Date.UTC(2024, 0, 1) + n * 86400000).toISOString();
const loan = (book, copy, from, to) => ({ kind: 'LOAN', user: 'u:1', book_id: book, variant_id: copy, at: day(from), until: to === null ? null : day(to) });

const data = {
  window_start: day(0),
  window_end: day(9),
  catalog: [
    { id: 'A', category: 'DDC 610', variant_ids: ['c:a1'] },
    { id: 'B', category: 'DDC 610', variant_ids: ['c:b1', 'c:b2', 'c:b3'] },
  ],
  events: [
    loan('A', 'c:a1', 0, 5), loan('A', 'c:a1', 5, 10), // the only copy out the whole window
    loan('B', 'c:b1', 2, 4), loan('B', 'c:b2', 3, 3), // a same-day return still holds the copy that day
    loan('B', 'c:b3', 8, null), // no return date: median loan length (lengths 5, 5, 2, 1 -> 5 days)
  ],
};

test('occupancy counts copies out per day and imputes missing returns', () => {
  const { titles, imputedLoanDays } = occupancy(data);
  const [a, b] = titles;
  assert.equal(imputedLoanDays, 5);
  assert.deepEqual(Array.from(a.out.slice(0, 10)), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(Array.from(b.out.slice(0, 10)), [0, 0, 1, 2, 0, 0, 0, 0, 1, 1]);
});

test('describe finds the empty shelf and the copies never needed together', () => {
  const { overall, by_copies: [one, , threeToFive] } = describe(occupancy(data));
  assert.equal(one.shortage_titles, 1); // A: every day empty
  assert.equal(one.empty_shelf_share, 1);
  assert.equal(threeToFive.shortage_titles, 0);
  assert.equal(threeToFive.extra_copies, 1); // B: at most 2 of 3 copies out at once
  assert.equal(threeToFive.idle_copies, 0);
  assert.equal(overall.extra_copy_share, 1 / 4);
  assert.equal(threeToFive.utilization, 5 / 30); // 5 copy-days out of 3 copies x 10 days
});
