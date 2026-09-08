const test = require('node:test');
const assert = require('node:assert/strict');
const { median, resolveLeadTime, DEFAULT_LEAD_TIME_DAYS } = require('../src/utils/lead-time');

test('median ignores non-finite values and handles even-length input', () => {
  assert.equal(median([10, 12, 14]), 12);
  assert.equal(median([10, 12, 14, 16]), 13);
  assert.equal(median([10, NaN, null, 20]), 15);
  assert.equal(median([]), null);
});

test('prefers the variant own delivery history once there are enough observations', () => {
  const result = resolveLeadTime({
    variantObservations: [20, 21, 22, 60],
    supplierObservations: [5, 5, 5],
    declaredLeadTimeDays: 7,
  });
  // Median of [20,21,22,60] is 21.5 -> 22; a mean would have been dragged to 31.
  assert.equal(result.days, 22);
  assert.equal(result.source, 'LEARNED');
  assert.equal(result.samples, 4);
});

test('falls back to supplier-level history when the variant has too few deliveries', () => {
  const result = resolveLeadTime({
    variantObservations: [30, 30],
    supplierObservations: [9, 10, 11],
    declaredLeadTimeDays: 7,
  });
  assert.equal(result.days, 10);
  assert.equal(result.source, 'LEARNED');
  assert.equal(result.samples, 3);
});

test('falls back to the supplier declared lead time when there is no delivery history', () => {
  const result = resolveLeadTime({ variantObservations: [], supplierObservations: [], declaredLeadTimeDays: 21 });
  assert.equal(result.days, 21);
  assert.equal(result.source, 'SUPPLIER_DECLARED');
  assert.equal(result.samples, 0);
});

test('falls back to the default when nothing is known about the supplier', () => {
  const result = resolveLeadTime({});
  assert.equal(result.days, DEFAULT_LEAD_TIME_DAYS);
  assert.equal(result.source, 'DEFAULT');
  assert.equal(result.samples, 0);
});

test('honours an explicit default over the built-in one', () => {
  const result = resolveLeadTime({ defaultLeadTimeDays: 30 });
  assert.equal(result.days, 30);
  assert.equal(result.source, 'DEFAULT');
});

test('never resolves to a zero-day lead time', () => {
  const result = resolveLeadTime({ variantObservations: [0, 0, 0] });
  assert.equal(result.days, 1);
  assert.equal(result.source, 'LEARNED');
});

// --- controller-level resolution ------------------------------------------
// Requires DB env vars because analytics.controller pulls in lib/db at import time.
process.env.INVENTORY_DATABASE_URL ||= 'postgres://unused/inventory';
process.env.BORROW_DATABASE_URL ||= 'postgres://unused/borrow';
const { resolveItemLeadTime } = require('../src/controllers/analytics.controller');

function history() {
  return {
    observationsByVariant: new Map([['v-known', [24, 25, 26]]]),
    observationsBySupplier: new Map([['s-1', [24, 25, 26, 40]]]),
    supplierByVariant: new Map([['v-known', 's-1'], ['v-thin', 's-1'], ['v-declared-only', 's-2']]),
    declaredByVariant: new Map([['v-declared-only', 30]]),
  };
}

const ranges = { leadTimeDays: 14, leadTimeDaysProvided: false };

test('resolves a variant with enough deliveries from its own history', () => {
  const result = resolveItemLeadTime('v-known', history(), ranges);
  assert.deepEqual(result, { days: 25, source: 'LEARNED', samples: 3 });
});

test('falls back to the supplier history for a variant with no deliveries of its own', () => {
  const result = resolveItemLeadTime('v-thin', history(), ranges);
  assert.equal(result.source, 'LEARNED');
  assert.equal(result.samples, 4);
  assert.equal(result.days, 26); // median of [24,25,26,40] = 25.5 -> 26
});

test('uses the declared lead time when that supplier has no delivery history', () => {
  const result = resolveItemLeadTime('v-declared-only', history(), ranges);
  assert.deepEqual(result, { days: 30, source: 'SUPPLIER_DECLARED', samples: 0 });
});

test('unknown variant with no supplier falls back to the request default', () => {
  const result = resolveItemLeadTime('v-unknown', history(), ranges);
  assert.deepEqual(result, { days: 14, source: 'DEFAULT', samples: 0 });
});

test('an explicit leadTimeDays query param overrides every learned value', () => {
  const result = resolveItemLeadTime('v-known', history(), { leadTimeDays: 7, leadTimeDaysProvided: true });
  assert.deepEqual(result, { days: 7, source: 'REQUESTED', samples: 0 });
});
