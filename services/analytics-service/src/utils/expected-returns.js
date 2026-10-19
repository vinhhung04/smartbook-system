// Expected returns of copies out on loan, for the reorder inventory position.
// Pure functions, no DB access (same convention as forecast.js / lead-time.js).
//
// A library copy on loan normally comes back, but not surely and not on its
// due date: some loans run months overdue, some copies never return. Counting
// every borrowed copy as "coming back" would double count stock; counting
// none (production until 3.3) re-buys copies that will be on the shelf before
// a new order could arrive. The estimate here sits between the two:
//
//   P(a loan of age a returns within the next h days)
//     = 1 - S(a + h) / S(a)
//
// where S is the Kaplan-Meier survival curve of loan durations - returned
// loans give observed durations, loans still out are right-censored at their
// current age (so long-overdue loans pull the curve down instead of being
// ignored). The expected number of copies back within h days is the sum over
// the open loans. Only the integer part is used by callers (a fraction of a
// copy never serves a request).
//
// With fewer than MIN_RETURNED_SAMPLES returned loans the curve is not trusted
// and the estimate is null: the caller falls back to counting no returns
// (the previous, conservative behaviour) and says so.

const MIN_RETURNED_SAMPLES = 30;

/**
 * Kaplan-Meier survival of loan durations (whole days).
 * @param {number[]} durations - durations of returned loans (events)
 * @param {number[]} censoredAges - ages of loans still out (censored)
 * @returns {{ at: (t: number) => number, samples: number } | null}
 */
function loanSurvival(durations, censoredAges = []) {
  const events = (durations || []).filter((d) => Number.isFinite(d) && d >= 0).map((d) => Math.floor(d));
  if (events.length < MIN_RETURNED_SAMPLES) return null;
  const censored = (censoredAges || []).filter((a) => Number.isFinite(a) && a >= 0).map((a) => Math.floor(a));
  const maxT = Math.max(...events, ...censored, 0);
  const deaths = new Array(maxT + 2).fill(0);
  const exits = new Array(maxT + 2).fill(0); // events + censorings leaving the risk set after t
  for (const d of events) { deaths[d] += 1; exits[d] += 1; }
  for (const a of censored) exits[a] += 1;
  // S[t] = P(duration > t)
  const S = new Array(maxT + 2).fill(1);
  let atRisk = events.length + censored.length;
  let surv = 1;
  for (let t = 0; t <= maxT; t += 1) {
    if (atRisk > 0 && deaths[t] > 0) surv *= 1 - deaths[t] / atRisk;
    S[t] = surv;
    atRisk -= exits[t];
  }
  S[maxT + 1] = surv;
  return {
    samples: events.length,
    // beyond the last observation the curve stays flat (no information)
    at: (t) => (t < 0 ? 1 : S[Math.min(Math.floor(t), maxT + 1)]),
  };
}

/**
 * Expected copies back from `openAges` within `horizonDays`.
 * @returns {number|null} null when the survival curve is not available
 */
function expectedReturns(openAges, horizonDays, survival) {
  if (!survival) return null;
  let expected = 0;
  for (const age of openAges || []) {
    const now = survival.at(age);
    if (now <= 0) continue; // older than any loan that ever came back
    expected += 1 - survival.at(age + horizonDays) / now;
  }
  return expected;
}

module.exports = { MIN_RETURNED_SAMPLES, loanSurvival, expectedReturns };
