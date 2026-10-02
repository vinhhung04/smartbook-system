// Latent behavioural profile + the conditional probability functions that turn
// a profile into outcomes. Everything here is a pure function of (profile,
// situation) - the generators decide WHEN to call these, this file decides
// HOW LIKELY each outcome is.

const { PERSONAS } = require('./personas');
const {
  ACTIVITY, RESERVATION, RENEWAL, REVIEWS, LATE_COEFFICIENTS, NO_SHOW_COEFFICIENTS, TIER_EFFECT,
} = require('./config');
const { sigmoid, clamp } = require('./random');

const UNIT_TRAITS = [
  'activity_level', 'punctuality', 'digital_affinity', 'reservation_tendency', 'wishlist_tendency',
  'review_tendency', 'renewal_tendency', 'exploration', 'payment_reliability', 'weekend_affinity',
];
// Individual deviation, applied in logit space so a trait never piles up at
// a hard 0/1 boundary and stays strictly inside (0, 1).
const TRAIT_LOGIT_NOISE_SD = 0.35;
const logit = (p) => Math.log(p / (1 - p));

// persona prior (uniform in range) + individual deviation.
function sampleTraits(rng, personaKey) {
  const persona = PERSONAS[personaKey];
  const traits = {};
  for (const name of UNIT_TRAITS) {
    const [lo, hi] = persona.traits[name];
    const prior = clamp(rng.range(lo, hi), 0.005, 0.995);
    traits[name] = sigmoid(logit(prior) + rng.gaussian(0, TRAIT_LOGIT_NOISE_SD));
  }
  const [slo, shi] = persona.traits.reading_speed;
  traits.reading_speed = Math.max(5, rng.range(slo, shi) * Math.exp(rng.gaussian(0, 0.15)));
  // How generous this reader is when rating (individual leniency).
  traits.rating_leniency = rng.gaussian(0.15, 0.35);
  return traits;
}

function sessionsPerYear(activityLevel) {
  return ACTIVITY.sessionsPerYearMax * activityLevel ** ACTIVITY.exponent;
}

// Membership plan chosen at sign-up from the LATENT expected engagement (not
// from realised loans, which would be circular). Gender is not an input.
function planWeights(activityLevel) {
  const a = activityLevel;
  return { BASIC: 1.0, SILVER: 0.35 + 0.9 * a, GOLD: 0.05 + 1.1 * a ** 2, VIP: 0.01 + 0.7 * a ** 3 };
}

function choosePlan(rng, activityLevel, plans) {
  const weights = planWeights(activityLevel);
  const available = Object.fromEntries(Object.entries(weights).filter(([code]) => plans.some((p) => p.code === code)));
  const code = rng.weightedKey(available);
  return plans.find((p) => p.code === code);
}

// ── Late return (published logistic process, unchanged coefficients) ───────
function lateProbability({ punctuality, planCode, maxLoanDays, itemsInLoan, unpaidFineFlag }) {
  const b = LATE_COEFFICIENTS;
  const z = b.b0
    + b.b1 * (1 - punctuality)
    + b.b2 * ((maxLoanDays - 20) / 8)
    + b.b3 * ((itemsInLoan - 1.5) / 0.7)
    + b.b4 * (unpaidFineFlag ? 1 : 0)
    + b.b5 * (TIER_EFFECT[planCode] ?? 0);
  return sigmoid(z);
}

// ── No-show (published logistic process; c6 added for active loans) ───────
function noShowProbability({ punctuality, leadHours, holdHours, channelWeb, priorNoShowRate, activeLoans }) {
  const c = NO_SHOW_COEFFICIENTS;
  const z = c.c0
    + c.c1 * (1 - punctuality)
    + c.c2 * ((leadHours - holdHours / 2) / Math.max(holdHours / 4, 1))
    + c.c3 * ((holdHours - 30) / 10)
    + c.c4 * (channelWeb ? 1 : 0)
    + c.c5 * priorNoShowRate
    + c.c6 * ((activeLoans - 1) / 1.5);
  return sigmoid(z);
}

function webProbability(digitalAffinity) {
  return clamp(RESERVATION.webBase + RESERVATION.webSlope * digitalAffinity, 0, 0.98);
}

function reserveProbability(traits) {
  return clamp(RESERVATION.reserveScale * traits.reservation_tendency * (0.35 + 0.65 * traits.digital_affinity), 0, 0.95);
}

// Renewal pressure: how much longer than the loan period the reader needs.
function renewalProbability({ renewalTendency, readingDays, loanDays, punctuality }) {
  const pressure = clamp(readingDays / Math.max(loanDays, 1) - 1, -1, 3);
  return sigmoid(RENEWAL.r0 + RENEWAL.rTendency * renewalTendency + RENEWAL.rPressure * pressure + RENEWAL.rLateness * (1 - punctuality));
}

// Latent enjoyment -> 1..5 stars. taste in [0,1], quality is a z-score.
function ratingScore(rng, { taste, quality, leniency }) {
  return REVIEWS.tasteWeight * (taste - 0.5) * 2 + REVIEWS.qualityWeight * quality + leniency + rng.gaussian(0, REVIEWS.noiseSd);
}
function ratingFromScore(score) {
  const t = REVIEWS.thresholds;
  for (let i = 0; i < t.length; i += 1) if (score < t[i]) return i + 1;
  return 5;
}
function reviewProbability({ reviewTendency, taste }) {
  return clamp(REVIEWS.baseScale * reviewTendency * (0.4 + 0.6 * taste), 0, 0.95);
}

module.exports = {
  UNIT_TRAITS,
  sampleTraits,
  sessionsPerYear,
  planWeights,
  choosePlan,
  lateProbability,
  noShowProbability,
  webProbability,
  reserveProbability,
  renewalProbability,
  ratingScore,
  ratingFromScore,
  reviewProbability,
};
