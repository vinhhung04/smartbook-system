// Maps a raw SQL row (from analytics.controller.js's late-return / no-show
// training queries) into a fixed-order feature vector + label. Pure, no DB
// access - the SQL does the joins and the causal (as-of-borrow_date /
// as-of-reserved_at) aggregation; this file only shapes what SQL already
// computed.
//
// This file is the SINGLE place the feature order is defined. risk-model.js
// trains a logistic-regression.js model against whatever order these arrays
// list, and predictProbability/featureContributions are positional - a
// silent mismatch here would silently corrupt every risk score, which is why
// risk-features.test.js asserts the emitted order directly.
//
// Leakage rules (see docs/superpowers/specs Area A design):
//   - Every late-return feature must be computable AT CHECKOUT TIME. No
//     feature here uses anything that happens after borrow_date.
//   - loan_days below uses the ORIGINAL due date (before any renewal), not
//     the final due date - a renewal is a strong proxy for "was about to be
//     late" and must not leak into the feature that predicts lateness.
//   - The LABEL, by contrast, is evaluated against the FINAL due date,
//     because that is what the library actually fines against.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const LATE_RETURN_FEATURES = [
  'loan_days',
  'items_in_loan',
  'prior_loans',
  'prior_late_rate',
  'prior_late_count',
  'prior_renewal_rate',
  'customer_tenure_days',
  'unpaid_fines_at_checkout',
  'plan_max_loan_days',
  'plan_fine_per_day',
  'from_reservation',
  'condition_worn_at_checkout',
];

const NO_SHOW_FEATURES = [
  'hold_hours',
  'lead_hours',
  'quantity',
  'channel_web',
  'prior_reservations',
  'prior_no_show_rate',
  'customer_tenure_days',
  'unpaid_fines_at_reservation',
  'active_loans_at_reservation',
];

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * @param {object} row - one returned or open loan_item, joined with its
 *   loan_transaction, customer, and membership plan; see
 *   analytics.controller.js's late-return training/scoring query for the
 *   exact column set this expects.
 * @returns {{features: number[], label: 0|1|null, at: Date}}
 *   label is null when the item has not been returned yet (excluded from training).
 */
function toLateReturnSample(row) {
  const borrowDate = new Date(row.borrow_date);
  const originalDueDate = new Date(row.original_due_date);
  const finalDueDate = new Date(row.due_date);
  const priorLoans = Number(row.prior_loans || 0);
  const priorLateCount = Number(row.prior_late_count || 0);
  const priorRenewalCount = Number(row.prior_renewal_count || 0);

  const features = LATE_RETURN_FEATURES.map((name) => {
    switch (name) {
      case 'loan_days': return (originalDueDate.getTime() - borrowDate.getTime()) / DAY_MS;
      case 'items_in_loan': return Number(row.items_in_loan || 1);
      case 'prior_loans': return priorLoans;
      case 'prior_late_rate': return ratio(priorLateCount, priorLoans);
      case 'prior_late_count': return priorLateCount;
      case 'prior_renewal_rate': return ratio(priorRenewalCount, priorLoans);
      case 'customer_tenure_days': return (borrowDate.getTime() - new Date(row.customer_created_at).getTime()) / DAY_MS;
      case 'unpaid_fines_at_checkout': return Number(row.unpaid_fines_at_checkout || 0);
      case 'plan_max_loan_days': return Number(row.plan_max_loan_days || 0);
      case 'plan_fine_per_day': return Number(row.plan_fine_per_day || 0);
      case 'from_reservation': return row.from_reservation ? 1 : 0;
      case 'condition_worn_at_checkout': return row.condition_worn_at_checkout ? 1 : 0;
      default: throw new Error(`unmapped feature: ${name}`);
    }
  });

  const returnDate = row.return_date ? new Date(row.return_date) : null;
  const label = returnDate === null ? null : (returnDate.getTime() > finalDueDate.getTime() ? 1 : 0);

  return { features, label, at: borrowDate };
}

/**
 * @param {object} row - one reservation joined with its customer and
 *   membership plan; see analytics.controller.js's no-show training/scoring
 *   query for the exact column set this expects.
 * @returns {{features: number[], label: 0|1|null, at: Date}|null}
 *   null for CANCELLED reservations and for ones that never had a pickup
 *   code issued (nothing to learn a no-show label from), and for ones with
 *   no terminal outcome yet.
 */
function toNoShowSample(row) {
  if (row.status === 'CANCELLED' || !row.pickup_code_issued_at) return null;

  const reservedAt = new Date(row.reserved_at);
  const expiresAt = new Date(row.expires_at);
  const issuedAt = new Date(row.pickup_code_issued_at);
  const priorReservations = Number(row.prior_reservations || 0);
  const priorNoShowCount = Number(row.prior_no_show_count || 0);

  let label;
  if (row.pickup_code_used_at) {
    label = 0; // picked up -> not a no-show
  } else if (row.status === 'EXPIRED') {
    label = 1; // code issued, never used, hold expired -> no-show
  } else {
    return null; // still pending (e.g. READY_FOR_PICKUP) - no terminal outcome yet
  }

  const features = NO_SHOW_FEATURES.map((name) => {
    switch (name) {
      case 'hold_hours': return (expiresAt.getTime() - reservedAt.getTime()) / HOUR_MS;
      case 'lead_hours': return (issuedAt.getTime() - reservedAt.getTime()) / HOUR_MS;
      case 'quantity': return Number(row.quantity || 1);
      case 'channel_web': return row.source_channel === 'WEB' ? 1 : 0;
      case 'prior_reservations': return priorReservations;
      case 'prior_no_show_rate': return ratio(priorNoShowCount, priorReservations);
      case 'customer_tenure_days': return (reservedAt.getTime() - new Date(row.customer_created_at).getTime()) / DAY_MS;
      case 'unpaid_fines_at_reservation': return Number(row.unpaid_fines_at_reservation || 0);
      case 'active_loans_at_reservation': return Number(row.active_loans_at_reservation || 0);
      default: throw new Error(`unmapped feature: ${name}`);
    }
  });

  return { features, label, at: reservedAt };
}

module.exports = {
  LATE_RETURN_FEATURES,
  NO_SHOW_FEATURES,
  toLateReturnSample,
  toNoShowSample,
};
