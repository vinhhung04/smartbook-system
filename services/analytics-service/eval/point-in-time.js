// Point-in-time reconstructions of the inputs GET /analytics/reorder-suggestions
// reads from the database, computed from in-memory event logs instead of SQL.
// Each helper mirrors one production query; every one takes the evaluation
// moment `to` and only looks at events at or before it.

const DAY_MS = 24 * 60 * 60 * 1000;

// Index of the first element of a sorted array that is > value.
function upperBound(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// Index of the first element >= value.
function lowerBound(sorted, value) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1; else hi = mid;
  }
  return lo;
}

// getBorrowDemandByVariant: COUNT(*) WHERE borrow_date >= from AND borrow_date <= to.
function countInRange(sortedTimes, from, to) {
  if (to < from) return 0;
  return upperBound(sortedTimes, to) - lowerBound(sortedTimes, from);
}

// getDailyBorrowSeriesByVariant: one bucket per UTC day from date_trunc(from)
// to date_trunc(to) inclusive, zero-filled - and NO series at all (callers use
// []) when the variant had no borrow inside [from, to].
function dailySeries(sortedTimes, from, to) {
  const start = lowerBound(sortedTimes, from);
  const end = upperBound(sortedTimes, to);
  if (end <= start) return [];
  const firstDay = Math.floor(from / DAY_MS);
  const series = new Array(Math.floor(to / DAY_MS) - firstDay + 1).fill(0);
  for (let i = start; i < end; i += 1) series[Math.floor(sortedTimes[i] / DAY_MS) - firstDay] += 1;
  return series;
}

// getReservationDemandByVariant: reserved_at in [from, to] and status still
// PENDING / CONFIRMED / READY_FOR_PICKUP *at time `to`* - i.e. the reservation
// had not yet reached a terminal state (endAt) by then.
function activeReservationCount(reservations, from, to) {
  let count = 0;
  for (const r of reservations) {
    if (r.reservedAt >= from && r.reservedAt <= to && (r.endAt === null || r.endAt > to)) count += 1;
  }
  return count;
}

// getWishlistDemandByBook: rows present in book_wishlists at time `at`.
function wishlistCountAt(wishlists, at) {
  let count = 0;
  for (const w of wishlists || []) {
    if (w.createdAt <= at && (w.removedAt === null || w.removedAt > at)) count += 1;
  }
  return count;
}

// Complete-day counts for days [fromDay, toDay) - used by the MA30 baseline.
function dayCounts(sortedTimes, fromDay, toDay) {
  const counts = new Array(Math.max(0, toDay - fromDay)).fill(0);
  const start = lowerBound(sortedTimes, fromDay * DAY_MS);
  const end = lowerBound(sortedTimes, toDay * DAY_MS);
  for (let i = start; i < end; i += 1) counts[Math.floor(sortedTimes[i] / DAY_MS) - fromDay] += 1;
  return counts;
}

module.exports = {
  DAY_MS,
  countInRange,
  dailySeries,
  activeReservationCount,
  wishlistCountAt,
  dayCounts,
};
