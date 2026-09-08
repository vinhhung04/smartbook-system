const test = require('node:test');
const assert = require('node:assert/strict');
const { LATE_RETURN_FEATURES, NO_SHOW_FEATURES, toLateReturnSample, toNoShowSample } = require('../src/utils/risk-features');

function baseLateRow(overrides = {}) {
  return {
    borrow_date: '2026-01-01T00:00:00Z',
    original_due_date: '2026-01-15T00:00:00Z',
    due_date: '2026-01-15T00:00:00Z',
    return_date: '2026-01-14T00:00:00Z',
    items_in_loan: 2,
    prior_loans: 4,
    prior_late_count: 1,
    prior_renewal_count: 1,
    customer_created_at: '2025-01-01T00:00:00Z',
    unpaid_fines_at_checkout: 15000,
    plan_max_loan_days: 14,
    plan_fine_per_day: 5000,
    from_reservation: false,
    condition_worn_at_checkout: false,
    ...overrides,
  };
}

test('toLateReturnSample emits features in exactly LATE_RETURN_FEATURES order', () => {
  const row = baseLateRow();
  const { features } = toLateReturnSample(row);
  assert.equal(features.length, LATE_RETURN_FEATURES.length);
  const byName = Object.fromEntries(LATE_RETURN_FEATURES.map((name, i) => [name, features[i]]));
  assert.equal(byName.loan_days, 14);
  assert.equal(byName.items_in_loan, 2);
  assert.equal(byName.prior_loans, 4);
  assert.equal(byName.prior_late_rate, 0.25);
  assert.equal(byName.plan_max_loan_days, 14);
});

test('label is 1 when returned after the final due date, 0 when on time or early', () => {
  const late = toLateReturnSample(baseLateRow({ return_date: '2026-01-20T00:00:00Z' }));
  assert.equal(late.label, 1);
  const onTime = toLateReturnSample(baseLateRow({ return_date: '2026-01-10T00:00:00Z' }));
  assert.equal(onTime.label, 0);
  const exact = toLateReturnSample(baseLateRow({ return_date: '2026-01-15T00:00:00Z' }));
  assert.equal(exact.label, 0);
});

test('label is null when the item has not been returned yet', () => {
  const open = toLateReturnSample(baseLateRow({ return_date: null }));
  assert.equal(open.label, null);
});

test('prior_late_rate is 0, not NaN, when the customer has no prior loans', () => {
  const row = toLateReturnSample(baseLateRow({ prior_loans: 0, prior_late_count: 0 }));
  const idx = LATE_RETURN_FEATURES.indexOf('prior_late_rate');
  assert.equal(row.features[idx], 0);
});

test('a renewed item uses the original due date for loan_days, and the final due date for the label', () => {
  const row = baseLateRow({
    original_due_date: '2026-01-15T00:00:00Z', // original 14-day loan
    due_date: '2026-01-22T00:00:00Z',           // renewed +7 days
    return_date: '2026-01-18T00:00:00Z',        // late against original, on time against final
  });
  const sample = toLateReturnSample(row);
  const idx = LATE_RETURN_FEATURES.indexOf('loan_days');
  assert.equal(sample.features[idx], 14); // uses original_due_date, not the renewed one
  assert.equal(sample.label, 0);          // uses due_date (final), not original_due_date
});

function baseNoShowRow(overrides = {}) {
  return {
    status: 'EXPIRED',
    reserved_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-01-02T00:00:00Z',
    pickup_code_issued_at: '2026-01-01T06:00:00Z',
    pickup_code_used_at: null,
    quantity: 1,
    source_channel: 'WEB',
    prior_reservations: 3,
    prior_no_show_count: 1,
    customer_created_at: '2025-01-01T00:00:00Z',
    unpaid_fines_at_reservation: 0,
    active_loans_at_reservation: 1,
    ...overrides,
  };
}

test('toNoShowSample emits features in exactly NO_SHOW_FEATURES order', () => {
  const { features } = toNoShowSample(baseNoShowRow());
  assert.equal(features.length, NO_SHOW_FEATURES.length);
  const byName = Object.fromEntries(NO_SHOW_FEATURES.map((name, i) => [name, features[i]]));
  assert.equal(byName.hold_hours, 24);
  assert.equal(byName.channel_web, 1);
  assert.equal(byName.prior_no_show_rate, 1 / 3);
});

test('label is 1 for an expired unused code, 0 for a used code', () => {
  const noShow = toNoShowSample(baseNoShowRow({ status: 'EXPIRED', pickup_code_used_at: null }));
  assert.equal(noShow.label, 1);
  const shown = toNoShowSample(baseNoShowRow({ status: 'CONVERTED_TO_LOAN', pickup_code_used_at: '2026-01-01T10:00:00Z' }));
  assert.equal(shown.label, 0);
});

test('CANCELLED reservations and reservations with no pickup code ever issued are excluded (null)', () => {
  assert.equal(toNoShowSample(baseNoShowRow({ status: 'CANCELLED' })), null);
  assert.equal(toNoShowSample(baseNoShowRow({ pickup_code_issued_at: null })), null);
});

test('a reservation with no terminal outcome yet is excluded (null)', () => {
  assert.equal(toNoShowSample(baseNoShowRow({ status: 'READY_FOR_PICKUP', pickup_code_used_at: null })), null);
});
