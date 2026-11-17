const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDiscrepancyItems, validateResolution } = require('../src/services/transfer-discrepancy.service');

test('SB12 records accepted, quarantine and missing separately without inventing stock', () => {
  const rows = buildDiscrepancyItems([{ id: 'a', variant_id: 'v', shipped_qty: 100 }], new Map([
    ['a', { delivered: 95, accepted: 90, damaged: 3, rejected: 2, missing: 5 }],
  ]));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].shipped_qty, rows[0].delivered_qty, rows[0].accepted_qty, rows[0].damaged_qty, rows[0].rejected_qty, rows[0].missing_qty], [100, 95, 90, 3, 2, 5]);
  assert.deepEqual([rows[0].remaining_damaged_qty, rows[0].remaining_rejected_qty, rows[0].remaining_missing_qty], [3, 2, 5]);
});
test('SB12 full accepted receipt creates no discrepancy rows', () => {
  assert.deepEqual(buildDiscrepancyItems([{ id: 'a', variant_id: 'v', shipped_qty: 5 }], new Map()), []);
});
test('SB12 resolution requires positive quantity, reason and evidence, and fits outstanding bucket', () => {
  const row = { remaining_missing_qty: 5, remaining_damaged_qty: 3, remaining_rejected_qty: 2 };
  const valid = { bucket: 'MISSING', action: 'FOUND', quantity: 2, reason: 'Found in delivery vehicle', evidence_reference: 'CASE-1' };
  assert.equal(validateResolution(row, valid).quantity, 2);
  for (const diff of [{ quantity: 0 }, { quantity: 6 }, { quantity: true }, { reason: '' }, { reason: {} }, { evidence_reference: '' }, { bucket: ['MISSING'] }, { bucket: 'AVAILABLE' }, { action: 'RETURN_TO_SOURCE' }]) {
    assert.throws(() => validateResolution(row, { ...valid, ...diff }));
  }
  assert.throws(() => validateResolution(row, { ...valid, bucket: 'DAMAGED', action: 'FOUND' }));
  assert.throws(() => validateResolution(row, { ...valid, action: 'REDELIVERED' }));
});
