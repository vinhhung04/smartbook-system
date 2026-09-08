const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyWeedingCandidate } = require('../src/utils/weeding');

test('returns null when the item is still within the activity threshold', () => {
  const result = classifyWeedingCandidate({
    daysSinceLastActivity: 30,
    thresholdDays: 180,
    onHandQty: 5,
    unitCost: 100000,
  });
  assert.equal(result, null);
});

test('flags HIGH severity right at the threshold', () => {
  const result = classifyWeedingCandidate({
    daysSinceLastActivity: 180,
    thresholdDays: 180,
    onHandQty: 5,
    unitCost: 100000,
  });
  assert.equal(result.severity, 'HIGH');
  assert.equal(result.suggested_action, 'LIQUIDATE');
  assert.equal(result.tied_up_value, 500000);
});

test('escalates to CRITICAL at 2x the threshold', () => {
  const result = classifyWeedingCandidate({
    daysSinceLastActivity: 360,
    thresholdDays: 180,
    onHandQty: 3,
    unitCost: 50000,
  });
  assert.equal(result.severity, 'CRITICAL');
  assert.equal(result.tied_up_value, 150000);
});

test('a book with no activity at all (null) is always a CRITICAL candidate', () => {
  const result = classifyWeedingCandidate({
    daysSinceLastActivity: null,
    thresholdDays: 180,
    onHandQty: 2,
    unitCost: 20000,
  });
  assert.equal(result.severity, 'CRITICAL');
  assert.equal(result.tied_up_value, 40000);
});

test('suggests REDISTRIBUTE instead of LIQUIDATE when the title has demand at another warehouse', () => {
  const result = classifyWeedingCandidate({
    daysSinceLastActivity: 200,
    thresholdDays: 180,
    onHandQty: 4,
    unitCost: 10000,
    hasDemandElsewhere: true,
  });
  assert.equal(result.suggested_action, 'REDISTRIBUTE');
});
