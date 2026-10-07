const test = require('node:test');
const assert = require('node:assert/strict');
const { reorderPointPolicy, ma30FixedLeadTimePolicy, smartbookPolicy, noReorderPolicy } = require('../eval/reorder-policies');
const { countInRange, dailySeries, activeReservationCount, wishlistCountAt, dayCounts, DAY_MS } = require('../eval/point-in-time');
const { calculateSuggestion, seasonalIndexFromCounts } = require('../src/utils/reorder-suggestion');
const { findSeasonalEvent } = require('../src/config/seasonal-events');

const D = 20500; // review day (UTC day index)
const at = (day, hour = 9) => day * DAY_MS + hour * 3600000;

function ctx(overrides = {}) {
  return {
    variant: { variantId: 'v1', bookId: 'b1', title: 'T', unitCost: 50000 },
    day: D,
    dayStartMs: D * DAY_MS,
    available: 0,
    onOrder: 0,
    owned: 0,
    onLoan: 0,
    history: [],
    variantLeadTimes: [],
    supplierLeadTimes: [],
    ...overrides,
  };
}

// ── point-in-time helpers ────────────────────────────────────────────────────

test('countInRange is inclusive on both ends, like the production SQL', () => {
  const times = [10, 20, 30, 40];
  assert.equal(countInRange(times, 20, 30), 2);
  assert.equal(countInRange(times, 21, 29), 0);
  assert.equal(countInRange(times, 0, 100), 4);
});

test('dailySeries has one bucket per day from date_trunc(from) to date_trunc(to), or none at all', () => {
  const from = at(D - 3, 12);
  const to = at(D, 0) - 1; // 23:59:59.999 of day D-1
  assert.deepEqual(dailySeries([at(D - 3, 8)], from, to), []); // before `from` -> no series
  assert.deepEqual(dailySeries([at(D - 3, 13), at(D - 1, 9), at(D - 1, 10)], from, to), [1, 0, 2]);
});

test('reservations count only while still open at the evaluation moment', () => {
  const to = at(D);
  const reservations = [
    { reservedAt: at(D - 5), endAt: null }, // still pending
    { reservedAt: at(D - 4), endAt: at(D + 1) }, // converted later -> still open at `to`
    { reservedAt: at(D - 3), endAt: at(D - 1) }, // already expired
    { reservedAt: at(D - 40), endAt: null }, // outside the 30-day window
  ];
  assert.equal(activeReservationCount(reservations, to - 30 * DAY_MS, to), 2);
});

test('wishlist count is the list as it stood at that moment (removed rows came back, future rows absent)', () => {
  const wishlists = [
    { createdAt: at(D - 10), removedAt: null },
    { createdAt: at(D - 10), removedAt: at(D + 3) }, // deleted after `at` -> counted
    { createdAt: at(D - 10), removedAt: at(D - 1) }, // deleted before -> not counted
    { createdAt: at(D + 1), removedAt: null }, // created later -> not counted
  ];
  assert.equal(wishlistCountAt(wishlists, at(D)), 2);
  assert.equal(wishlistCountAt(undefined, at(D)), 0);
});

test('dayCounts covers complete days [fromDay, toDay) only', () => {
  assert.deepEqual(dayCounts([at(D - 3), at(D - 1), at(D - 1), at(D)], D - 3, D), [1, 0, 2]);
});

// ── policies ─────────────────────────────────────────────────────────────────

test('NO_REORDER never orders', () => {
  assert.equal(noReorderPolicy().decide(ctx()).qty, 0);
});

test('REORDER_POINT orders up to 10 once shelf + on-order falls to 5', () => {
  const policy = reorderPointPolicy();
  assert.equal(policy.decide(ctx({ available: 5 })).qty, 5);
  assert.equal(policy.decide(ctx({ available: 0 })).qty, 10);
  assert.equal(policy.decide(ctx({ available: 6 })).qty, 0);
  assert.equal(policy.decide(ctx({ available: 2, onOrder: 4 })).qty, 0); // position 6
  assert.equal(policy.decide(ctx({ available: 2, onOrder: 3, onLoan: 40 })).qty, 5); // loans do not count
});

test('MA30_FIXED_LT: 30-day mean x 14 days + z*sigma*sqrt(14) - position', () => {
  const policy = ma30FixedLeadTimePolicy();
  // Exactly 2 borrows on each of the last 30 days -> rate 2, sigma 0 -> target 28.
  const history = Array.from({ length: 30 }, (_, i) => [at(D - 30 + i, 9), at(D - 30 + i, 15)]).flat();
  assert.equal(policy.decide(ctx({ history, available: 10 })).qty, 18);
  // Older borrows are outside the window and do not change anything.
  const older = [...Array.from({ length: 50 }, () => at(D - 45)), ...history];
  assert.equal(policy.decide(ctx({ history: older, available: 10 })).qty, 18);
  // Alternating 0/2 days: mean 1, sample sd ~1.017 -> SS = ceil(1.645*1.017*sqrt(14)) = 7, target 21.
  const alternating = Array.from({ length: 15 }, (_, i) => [at(D - 30 + 2 * i), at(D - 30 + 2 * i, 11)]).flat();
  assert.equal(policy.decide(ctx({ history: alternating, available: 0 })).qty, 21);
  assert.equal(policy.decide(ctx({ history: alternating, available: 25 })).qty, 0);
});

function smartbook(options = {}) {
  return smartbookPolicy({
    reservationsByVariant: new Map([['v1', [{ reservedAt: at(D - 2), endAt: null }, { reservedAt: at(D - 3), endAt: null }]]]),
    wishlistsByBook: new Map([['b1', [{ createdAt: at(D - 20), removedAt: null }]]]),
    ...options,
  });
}

// Last 31 complete days (D-31 .. D-1): one borrow every other day, plus a
// borrow 365 days back so the seasonal index has a trailing year.
const HISTORY = [
  ...Array.from({ length: 400 }, (_, i) => at(D - 400 + i)).filter((_, i) => i % 9 === 0),
  ...Array.from({ length: 16 }, (_, i) => at(D - 31 + 2 * i)),
].sort((a, b) => a - b);

test('SMARTBOOK passes production calculateSuggestion the point-in-time inputs and orders its suggested quantity', () => {
  const policy = smartbook();
  const context = ctx({ history: HISTORY, available: 1, onOrder: 1, owned: 6, onLoan: 5, supplierLeadTimes: [10, 12, 30] });
  const decision = policy.decide(context);

  const to = D * DAY_MS - 1;
  const from = to - 30 * DAY_MS;
  const expected = calculateSuggestion(
    { variant_id: 'v1', book_id: 'b1', title: 'T', available_qty: 2, on_hand_qty: 6, reserved_qty: 0, borrowed_qty: 5, reorder_point: 0, unit_cost: 50000 },
    {
      borrowCount: countInRange(HISTORY, from, to),
      previousBorrowCount: countInRange(HISTORY, from - 30 * DAY_MS, from),
      reservationCount: 2,
      wishlistCount: 1,
      availabilityAlertCount: 0,
    },
    { days: 30, leadTimeDays: 14 },
    {
      index: seasonalIndexFromCounts({
        samePeriodLastYear: countInRange(HISTORY, from - 365 * DAY_MS, to - 365 * DAY_MS),
        yearlyTotal: countInRange(HISTORY, to - 365 * DAY_MS, to),
        days: 30,
      }),
      event: findSeasonalEvent(new Date(to)),
    },
    dailySeries(HISTORY, from, to),
    { days: 12, source: 'LEARNED', samples: 3 }, // median of the supplier's 3 deliveries
  );
  assert.notEqual(decision.candidate.seasonal_index, 1); // the trailing year is long enough to apply
  assert.equal(decision.candidate.lead_time_source, 'LEARNED');
  assert.equal(decision.candidate.lead_time_days, 12);
  assert.equal(decision.candidate.reservation_count, 2);
  assert.equal(decision.candidate.wishlist_count, 1);
  assert.equal(decision.candidate.available_qty, 2); // shelf 1 + on order 1, loans excluded
  assert.deepEqual(decision.candidate, expected);
  assert.equal(decision.qty, expected.suggested_reorder_qty);
  assert.ok(decision.qty > 0);
});

test('SMARTBOOK ignores a borrow made today (its series ends yesterday)', () => {
  const policy = smartbook();
  const withToday = [...HISTORY, at(D, 8)];
  assert.deepEqual(policy.decide(ctx({ history: withToday })).candidate, policy.decide(ctx({ history: HISTORY })).candidate);
});

test('SMARTBOOK ablation switches change exactly their own input', () => {
  const context = ctx({ history: HISTORY, available: 0, supplierLeadTimes: [20, 20, 20] });
  const full = smartbook().decide(context).candidate;
  const noSeason = smartbook({ seasonality: false }).decide(context).candidate;
  const fixedLt = smartbook({ learnedLeadTime: false }).decide(context).candidate;
  const noSignals = smartbook({ demandSignals: false }).decide(context).candidate;
  const noSafety = smartbook({ safetyStock: false }).decide(context).candidate;

  assert.equal(noSeason.seasonal_index, 1);
  assert.equal(full.lead_time_days, 20);
  assert.equal(fixedLt.lead_time_days, 14);
  assert.equal(fixedLt.lead_time_source, 'DEFAULT');
  assert.equal(noSignals.reservation_count, 0);
  assert.equal(noSignals.wishlist_count, 0);
  assert.ok(noSignals.demand_score < full.demand_score);
  assert.ok(noSafety.suggested_reorder_qty <= full.suggested_reorder_qty);
  // Everything not switched off is unchanged.
  assert.equal(noSignals.forecast_30d, full.forecast_30d);
  assert.equal(fixedLt.reservation_count, full.reservation_count);
});

test('SMARTBOOK with no demand history suggests nothing', () => {
  const policy = smartbookPolicy({ reservationsByVariant: new Map(), wishlistsByBook: new Map() });
  const decision = policy.decide(ctx({ available: 3 }));
  assert.equal(decision.qty, 0);
  assert.equal(decision.candidate.priority, 'LOW');
});
