// Classifies an aging-inventory row into a weeding (liquidation) candidate.
// Pure function, no DB access, same convention as forecast.js / lead-time.js.
//
// A row only becomes a candidate once it has been inactive for at least
// `thresholdDays` (the same signal aging-inventory already exposes). Beyond
// that point severity scales with how long it has sat idle, and the
// suggested action distinguishes a book that is genuinely unwanted
// (LIQUIDATE) from one that is simply sitting in the wrong warehouse while
// the same title is moving elsewhere (REDISTRIBUTE) - dead stock and
// misallocated stock call for different staff actions.

const CRITICAL_MULTIPLIER = 2;

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * @param {object} params
 * @param {number|null} params.daysSinceLastActivity - null means "never had activity"
 * @param {number} params.thresholdDays - minimum inactive days to be a candidate at all
 * @param {number} params.onHandQty
 * @param {number} params.unitCost
 * @param {boolean} params.hasDemandElsewhere - same book_id has recent demand at another warehouse
 * @returns {null | { severity: 'HIGH'|'CRITICAL', suggested_action: 'LIQUIDATE'|'REDISTRIBUTE', tied_up_value: number }}
 */
function classifyWeedingCandidate({
  daysSinceLastActivity,
  thresholdDays,
  onHandQty,
  unitCost,
  hasDemandElsewhere = false,
}) {
  const isCandidate = daysSinceLastActivity === null || daysSinceLastActivity >= thresholdDays;
  if (!isCandidate) return null;

  const severity = daysSinceLastActivity === null || daysSinceLastActivity >= thresholdDays * CRITICAL_MULTIPLIER
    ? 'CRITICAL'
    : 'HIGH';
  const suggestedAction = hasDemandElsewhere ? 'REDISTRIBUTE' : 'LIQUIDATE';
  const tiedUpValue = round2(Number(onHandQty || 0) * Number(unitCost || 0));

  return { severity, suggested_action: suggestedAction, tied_up_value: tiedUpValue };
}

module.exports = {
  classifyWeedingCandidate,
};
