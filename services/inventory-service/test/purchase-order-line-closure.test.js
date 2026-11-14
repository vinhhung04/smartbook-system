const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LineClosureError,
  buildCloseRemaining,
  buildReopen,
  calculateLineFulfillmentStatus,
} = require('../src/services/purchase-order-line-closure.service');

const PO = { id: 'po-1', status: 'PARTIALLY_RECEIVED' };
const OPEN_ITEM = { id: 'poi-1', ordered_qty: 10, received_qty: 6, closure_status: 'OPEN' };

test('rejects closing when the PO status is not one that can have a remainder closed', () => {
  assert.throws(() => buildCloseRemaining({ ...PO, status: 'DRAFT' }, OPEN_ITEM, { reason: 'x' }), LineClosureError);
});

test('rejects closing an already-closed line', () => {
  const closed = { ...OPEN_ITEM, closure_status: 'CLOSED_WITH_REMAINING' };
  assert.throws(() => buildCloseRemaining(PO, closed, { reason: 'x' }), LineClosureError);
});

test('rejects closing a line with nothing left to close', () => {
  const fullyReceived = { ...OPEN_ITEM, received_qty: 10 };
  assert.throws(() => buildCloseRemaining(PO, fullyReceived, { reason: 'x' }), LineClosureError);
});

test('requires a reason', () => {
  assert.throws(() => buildCloseRemaining(PO, OPEN_ITEM, {}), LineClosureError);
});

test('builds a close-remaining proposal with the remaining qty and an optional evidence reference', () => {
  const proposal = buildCloseRemaining(PO, OPEN_ITEM, { reason: 'NCC hết hàng, không giao nữa', evidence_reference: 'EMAIL-2026-11-14' });
  assert.equal(proposal.remainingQtyAtClose, 4);
  assert.equal(proposal.evidenceReference, 'EMAIL-2026-11-14');
});

test('evidence_reference is optional', () => {
  const proposal = buildCloseRemaining(PO, OPEN_ITEM, { reason: 'x' });
  assert.equal(proposal.evidenceReference, null);
});

test('close-remaining never touches ordered_qty or received_qty (caller-side contract check)', () => {
  const proposal = buildCloseRemaining(PO, OPEN_ITEM, { reason: 'x' });
  assert.ok(!('ordered_qty' in proposal) && !('received_qty' in proposal), 'proposal carries no quantity mutation');
});

test('rejects reopening a line that was never closed', () => {
  assert.throws(() => buildReopen(OPEN_ITEM, { reason: 'x' }), LineClosureError);
});

test('reopen requires a reason', () => {
  const closed = { ...OPEN_ITEM, closure_status: 'CLOSED_WITH_REMAINING' };
  assert.throws(() => buildReopen(closed, {}), LineClosureError);
});

test('builds a reopen proposal for a closed line', () => {
  const closed = { ...OPEN_ITEM, closure_status: 'CLOSED_WITH_REMAINING' };
  const proposal = buildReopen(closed, { reason: 'NCC xác nhận sẽ giao bù' });
  assert.equal(proposal.reason, 'NCC xác nhận sẽ giao bù');
});

test('calculateLineFulfillmentStatus distinguishes all four states instead of collapsing into one RECEIVED bucket', () => {
  assert.equal(calculateLineFulfillmentStatus('CANCELLED', OPEN_ITEM), 'CANCELLED');
  assert.equal(calculateLineFulfillmentStatus('PARTIALLY_RECEIVED', { ...OPEN_ITEM, closure_status: 'CLOSED_WITH_REMAINING' }), 'CLOSED_WITH_REMAINING');
  assert.equal(calculateLineFulfillmentStatus('RECEIVED', { ordered_qty: 10, received_qty: 10, closure_status: 'OPEN' }), 'FULLY_RECEIVED');
  assert.equal(calculateLineFulfillmentStatus('PARTIALLY_RECEIVED', OPEN_ITEM), 'PARTIALLY_RECEIVED');
  assert.equal(calculateLineFulfillmentStatus('SENT_TO_SUPPLIER', { ordered_qty: 10, received_qty: 0, closure_status: 'OPEN' }), 'NOT_RECEIVED');
});

test('CANCELLED PO status wins over a closed line (closure is moot once the whole order is cancelled)', () => {
  const closed = { ...OPEN_ITEM, closure_status: 'CLOSED_WITH_REMAINING' };
  assert.equal(calculateLineFulfillmentStatus('CANCELLED', closed), 'CANCELLED');
});
