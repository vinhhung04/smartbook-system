const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateSuggestion } = require('../src/utils/reorder-suggestion');
const { floorByBorrows, returnsPriority } = require('../eval/reorder-quantity-variants');

// one copy, out on loan, borrowed once early in the 30-day window
const row = { book_id: 'b', variant_id: 'b', title: 'b', available_qty: 0, on_hand_qty: 0, borrowed_qty: 1, reorder_point: 0, unit_cost: 0 };
const demand = { borrowCount: 1, previousBorrowCount: 0, reservationCount: 0, wishlistCount: 0, availabilityAlertCount: 0 };
const ranges = { days: 30, leadTimeDays: 14 };
const series = [1, ...new Array(29).fill(0)];

test('production makes the 1-copy title on loan HIGH and orders the 5-copy minimum', () => {
  const current = calculateSuggestion(row, demand, ranges, {}, series);
  assert.equal(current.priority, 'HIGH');
  assert.equal(current.suggested_reorder_qty, 5);
});

test('FLOOR_BY_BORROWS keeps the priority and caps the minimum at the borrows seen', () => {
  const noFloor = calculateSuggestion(row, demand, ranges, {}, series, null, { priorityFloors: false });
  const v = floorByBorrows(calculateSuggestion, row, demand, ranges, {}, series, null);
  assert.equal(v.priority, 'HIGH');
  assert.equal(v.suggested_reorder_qty, Math.max(noFloor.suggested_reorder_qty, 1));
});

test('RETURNS_PRIORITY: a copy 80% likely back within the lead time is not a stockout', () => {
  const v = returnsPriority(row, demand, ranges, {}, series, 0.8);
  assert.notEqual(v.priority, 'HIGH');
  assert.equal(v.inventory_position, 0); // whole copies only in the quantity
});
