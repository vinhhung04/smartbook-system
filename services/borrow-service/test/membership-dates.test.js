const assert = require('node:assert/strict');
const test = require('node:test');
const { computeMembershipEndDate, DEFAULT_MEMBERSHIP_DURATION_DAYS } = require('../src/services/membership.service');
const { resolveRenewalStart } = require('../src/services/membership.service');

test('computeMembershipEndDate adds the default 365 days when no duration is given', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const end = computeMembershipEndDate(start);
  assert.equal(DEFAULT_MEMBERSHIP_DURATION_DAYS, 365);
  assert.equal(end.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('computeMembershipEndDate honors a custom duration', () => {
  const start = new Date('2026-01-01T00:00:00.000Z');
  const end = computeMembershipEndDate(start, 30);
  assert.equal(end.toISOString(), '2026-01-31T00:00:00.000Z');
});

test('resolveRenewalStart extends from today when current membership already expired', () => {
  const today = new Date('2026-09-04T00:00:00.000Z');
  const expiredEnd = new Date('2026-01-01T00:00:00.000Z');
  const start = resolveRenewalStart(expiredEnd, today);
  assert.equal(start.toISOString(), today.toISOString());
});

test('resolveRenewalStart extends from the current end_date when membership is still active', () => {
  const today = new Date('2026-09-04T00:00:00.000Z');
  const futureEnd = new Date('2026-12-01T00:00:00.000Z');
  const start = resolveRenewalStart(futureEnd, today);
  assert.equal(start.toISOString(), futureEnd.toISOString());
});

test('resolveRenewalStart extends from today when there is no prior end_date', () => {
  const today = new Date('2026-09-04T00:00:00.000Z');
  const start = resolveRenewalStart(null, today);
  assert.equal(start.toISOString(), today.toISOString());
});
