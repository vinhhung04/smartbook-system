// Supplier lead time resolved from real purchase-order -> goods-receipt history.
// Pure functions, no DB access, so they can be exercised directly with sample
// observations (same convention as forecast.js).
//
// Why this matters: reorder suggestions size safety stock as z * sigma * sqrt(leadTime)
// and project demand over leadTime days. A single hardcoded constant for every
// title and every supplier makes both numbers guesses; the delivery history
// already recorded in the database makes them measurements.

const DEFAULT_LEAD_TIME_DAYS = 14;

// Below this many delivery observations the sample is too small to prefer over
// the supplier's own declared lead time.
const MIN_LEAD_TIME_OBSERVATIONS = 3;

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Median rather than mean: one badly delayed shipment must not permanently
// inflate every future suggestion for that title.
function _fromObservations(observations) {
  const value = median(observations);
  return value === null ? null : Math.max(1, Math.round(value));
}

/**
 * Resolve the lead time to use for one variant, most specific evidence first.
 *
 * Returns { days, source, samples } where source is one of:
 *   LEARNED           - median of real deliveries (this variant, or its supplier)
 *   SUPPLIER_DECLARED - the supplier's own lead_time_days, no delivery history yet
 *   DEFAULT           - nothing known; the service-wide fallback
 */
function resolveLeadTime({
  variantObservations = [],
  supplierObservations = [],
  declaredLeadTimeDays = null,
  defaultLeadTimeDays = DEFAULT_LEAD_TIME_DAYS,
} = {}) {
  if (variantObservations.length >= MIN_LEAD_TIME_OBSERVATIONS) {
    return { days: _fromObservations(variantObservations), source: 'LEARNED', samples: variantObservations.length };
  }
  if (supplierObservations.length >= MIN_LEAD_TIME_OBSERVATIONS) {
    return { days: _fromObservations(supplierObservations), source: 'LEARNED', samples: supplierObservations.length };
  }
  if (Number.isFinite(declaredLeadTimeDays) && declaredLeadTimeDays > 0) {
    return { days: Math.max(1, Math.round(declaredLeadTimeDays)), source: 'SUPPLIER_DECLARED', samples: 0 };
  }
  return { days: defaultLeadTimeDays, source: 'DEFAULT', samples: 0 };
}

module.exports = {
  DEFAULT_LEAD_TIME_DAYS,
  MIN_LEAD_TIME_OBSERVATIONS,
  median,
  resolveLeadTime,
};
