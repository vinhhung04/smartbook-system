const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REPICK_META_MARKER,
  buildMarkerLine,
  parseMarkerPayload,
  parseRepickMeta,
  withLineShortPickedQty,
  getLineShortPickedQty,
  calculateLineRemaining,
} = require('../src/services/picking-note.service');

test('round-trips encoded picking marker values', () => {
  const line = buildMarkerLine(REPICK_META_MARKER, {
    root_task_type: 'OUTBOUND',
    reason: 'Thiếu; hỏng = 2',
  });

  assert.deepEqual(parseMarkerPayload(line, REPICK_META_MARKER), {
    root_task_type: 'OUTBOUND',
    reason: 'Thiếu; hỏng = 2',
  });
});

test('replaces an existing short-pick marker instead of duplicating it', () => {
  const first = withLineShortPickedQty('Ghi chú', 3);
  const second = withLineShortPickedQty(first, 2);

  assert.equal(getLineShortPickedQty(second), 2);
  assert.equal(second.match(/\[SHORT_PICK\]/g)?.length, 1);
});

test('rejects incomplete repick metadata', () => {
  assert.equal(parseRepickMeta('[REPICK_META] root_task_type=OUTBOUND'), null);
});

test('never returns a negative remaining quantity', () => {
  assert.equal(calculateLineRemaining(2, 5), 0);
  assert.equal(calculateLineRemaining(5, 2), 3);
});
