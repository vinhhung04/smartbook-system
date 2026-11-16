// P1.3: confirming a transfer receipt must use the destination's actual count, never
// blindly accept shipped_qty. computeTransferLineOutcome is the pure math at the heart
// of that fix (confirmTransferReceiving writes its result into goods_receipt_items
// before postTransferReceiptToReceiving posts goods_receipt_items.quantity to stock -
// verified by reading that function directly, see PROCUREMENT/BUSINESS_LOGIC reports).
const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTransferLineOutcome } = require('../src/controllers/transfer-receiving.controller');

test('full receipt: delivered == shipped, nothing damaged/rejected -> accepted == shipped', () => {
  const outcome = computeTransferLineOutcome({ shippedQty: 30, delivered: 30, damaged: 0, rejected: 0 });
  assert.deepEqual(outcome, { delivered: 30, damaged: 0, rejected: 0, accepted: 30, missing: 0, overage: 0 });
});

test('short receipt: 18 of 20 shipped arrive -> accepted 18, missing 2, nothing invented', () => {
  const outcome = computeTransferLineOutcome({ shippedQty: 20, delivered: 18 });
  assert.equal(outcome.accepted, 18);
  assert.equal(outcome.missing, 2);
  assert.equal(outcome.overage, 0);
});

test('damaged copies are excluded from accepted (never counted as available stock)', () => {
  const outcome = computeTransferLineOutcome({ shippedQty: 15, delivered: 15, damaged: 3, rejected: 0 });
  assert.equal(outcome.accepted, 12);
  assert.equal(outcome.damaged, 3);
});

test('rejected copies are excluded from accepted', () => {
  const outcome = computeTransferLineOutcome({ shippedQty: 10, delivered: 10, damaged: 0, rejected: 2 });
  assert.equal(outcome.accepted, 8);
});

test('damaged + rejected together cannot exceed delivered', () => {
  const outcome = computeTransferLineOutcome({ shippedQty: 10, delivered: 5, damaged: 3, rejected: 3 });
  assert.equal(outcome.error, 'Số lượng hỏng + từ chối không được vượt số lượng thực nhận');
});

test('arriving with more than shipped (overage) must be marked rejected, not silently accepted', () => {
  const notRejected = computeTransferLineOutcome({ shippedQty: 10, delivered: 12, damaged: 0, rejected: 0 });
  assert.match(notRejected.error, /Nhận thừa 2/);
  const rejected = computeTransferLineOutcome({ shippedQty: 10, delivered: 12, damaged: 0, rejected: 2 });
  assert.equal(rejected.accepted, 10);
  assert.equal(rejected.overage, 2);
});

test('negative or non-integer counts are rejected, not coerced', () => {
  assert.equal(computeTransferLineOutcome({ shippedQty: 10, delivered: -1 }).error, 'Số lượng thực nhận, hỏng và từ chối phải là số nguyên không âm');
  assert.equal(computeTransferLineOutcome({ shippedQty: 10, delivered: 1.5 }).error, 'Số lượng thực nhận, hỏng và từ chối phải là số nguyên không âm');
});

test('omitted damaged/rejected default to 0, not an error', () => {
  const outcome = computeTransferLineOutcome({ shippedQty: 5, delivered: 5 });
  assert.equal(outcome.damaged, 0);
  assert.equal(outcome.rejected, 0);
  assert.equal(outcome.accepted, 5);
});
