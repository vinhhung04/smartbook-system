const test = require('node:test');
const assert = require('node:assert/strict');
const { countBaseline, countAdjustment, StockAuditCountError } = require('../src/services/stock-audit-count.service');

test('physical count excludes off-site borrowed copies', () => {
  assert.deepEqual(countBaseline({ on_hand_qty: 10, borrowed_qty: 3 }), { expected_qty: 7, baseline_on_hand_qty: 10, baseline_borrowed_qty: 3 });
});
test('approval preserves outbound movements after authoritative count', () => {
  const line = { counted_at: new Date(), expected_qty: 10, counted_qty: 8, variance_qty: -2 };
  assert.deepEqual(countAdjustment(line, { on_hand_qty: 8, available_qty: 8, borrowed_qty: 0, reserved_qty: 0, damaged_qty: 0 }, 'BIN'), { delta: -2, availableDelta: -2 });
});
test('borrowed copies are not removed as physical shortage', () => {
  assert.equal(countAdjustment({ counted_at: new Date(), expected_qty: 7, counted_qty: 7 }, { on_hand_qty: 10, available_qty: 7, borrowed_qty: 3 }, 'BIN').delta, 0);
});
test('a legacy submitted line without a count cutoff requires recount', () => {
  assert.throws(() => countAdjustment({ expected_qty: 10, counted_qty: 8 }, { on_hand_qty: 10, available_qty: 10 }, 'BIN'), e => e instanceof StockAuditCountError && e.code === 'STOCK_AUDIT_RECOUNT_REQUIRED');
});
test('a shortage never consumes stock held for another reservation', () => {
  assert.throws(() => countAdjustment({ counted_at: new Date(), expected_qty: 10, counted_qty: 5 }, { on_hand_qty: 10, available_qty: 2, reserved_qty: 8 }, 'BIN'), e => e.code === 'STOCK_AUDIT_HELD_STOCK_CONFLICT');
});
test('receiving hold shortage changes on hand without inventing availability', () => {
  assert.deepEqual(countAdjustment({ counted_at: new Date(), expected_qty: 10, counted_qty: 8 }, { on_hand_qty: 10, available_qty: 0 }, 'RECEIVING'), { delta: -2, availableDelta: 0 });
});
