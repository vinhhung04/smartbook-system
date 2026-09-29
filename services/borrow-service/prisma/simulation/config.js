// Every tunable number of the behavioural simulation lives here or in
// personas.js - no magic numbers scattered through the generators. All values
// are SIMULATION ASSUMPTIONS chosen to produce plausible library behaviour;
// none of them is a measured statistic about real SmartBook users.

const GENERATOR_VERSION = '2.0.0';

// Environment overrides. HISTORY_SEED is still honoured so existing
// `HISTORY_SEED=123 node prisma/seed-history.js` invocations keep working.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

const DEFAULTS = {
  seed: envNumber('SIMULATION_SEED', envNumber('HISTORY_SEED', 20260928)),
  customerCount: envNumber('CUSTOMER_COUNT', 600),
  months: envNumber('SIMULATION_MONTHS', 24),
  // Anchored to a constant date, not wall-clock "now", so reruns reproduce.
  end: new Date(process.env.SIMULATION_END || '2026-09-28T00:00:00Z'),
};

// Natural-key prefixes. SIM- rows are owned by this generator; HIST- rows were
// written by the previous single-trait generator and are deleted as legacy on
// every run, so only one synthetic population exists at a time.
const SIM_PREFIX = 'SIM-';
const PREFIX = {
  customer: 'SIM-C-',
  card: 'SIM-CARD-',
  loan: 'SIM-LOAN-',
  reservation: 'SIM-RES-',
  pickupCode: 'SIM-PC-',
  barcode: 'SIM-BC-',
};
const LEGACY_PREFIX = 'HIST-';

// Library-local time. Behaviour (opening hours, preferred hours, weekdays) is
// simulated in local time and stored as UTC timestamps.
const LOCAL_TZ_OFFSET_HOURS = 7;
const OPENING_HOURS = { open: 8, close: 20 }; // walk-in counter
const ONLINE_HOURS = { open: 6, close: 23 }; // web reservations

const PLACEHOLDER_STAFF_ID = '00000000-0000-0000-0000-000000000001';

// Fallback plan table (mirrors prisma/seed.js) - used by the pure generator in
// tests and dry runs; a DB run uses the membership_plans rows it reads.
const FALLBACK_PLANS = [
  { code: 'BASIC', max_active_loans: 3, max_loan_days: 14, max_renewal_count: 1, reservation_hold_hours: 24, fine_per_day: 5000 },
  { code: 'SILVER', max_active_loans: 5, max_loan_days: 21, max_renewal_count: 2, reservation_hold_hours: 36, fine_per_day: 3000 },
  { code: 'GOLD', max_active_loans: 8, max_loan_days: 30, max_renewal_count: 3, reservation_hold_hours: 48, fine_per_day: 2000 },
  { code: 'VIP', max_active_loans: 15, max_loan_days: 60, max_renewal_count: 5, reservation_hold_hours: 72, fine_per_day: 1000 },
];

// Customer tenure: some members pre-date the simulation window (their earlier
// history is simply outside the export), the rest join during it.
const TENURE = {
  establishedShare: 0.35, // created up to establishedMaxYearsBefore before window start
  establishedMaxYearsBefore: 2,
  // Relative sign-up intensity by month (Jan..Dec) for in-window joins -
  // semester starts attract new members.
  joinMonthWeight: [1.0, 0.7, 1.2, 1.0, 0.9, 0.8, 0.8, 1.1, 1.6, 1.3, 1.0, 0.8],
  newMemberBoost: 1.3, // activity multiplier during the first 60 days
  newMemberBoostDays: 60,
};

// Activity -> borrow sessions per year: SESSIONS_PER_YEAR_MAX * activity^EXPONENT.
// The convex exponent is what creates the long tail of user activity.
const ACTIVITY = {
  sessionsPerYearMax: 62,
  exponent: 2.1,
  monthlyBurstShape: 3, // Gamma(3)/3 mean-one month-to-month engagement noise
  maxDailyProbability: 0.6,
};

// Book popularity prior: Zipf over a seeded ranking of the catalog.
const POPULARITY = { zipfExponent: 1.25 };

// Selection factors in P(book | user) - see preferences.js.
const SELECTION = {
  rereadFactor: 0.03, // already-borrowed book
  wishlistBoost: 4.0,
  authorAffinityMax: 3.0, // latent favourite-author multiplier upper bound
  likedAuthorBoost: 0.6, // per earlier >=4-star review of the author, capped below
  likedAuthorBoostCap: 2.0,
  habitWeight: 0.35, // momentum toward categories in the user's last 10 loans
  unavailablePenaltyDigital: 0.5, // online-savvy users see stock before choosing
  categoryNoiseSd: 0.35, // individual log-normal deviation from persona prior
  substituteWhenUnavailable: 0.5,
};

// Stock: copies per variant are calibrated from an unconstrained pilot run of
// the same population so average utilisation is ~ 1/copyFactor.
const STOCK = { copyFactor: 1.5, minCopies: 2, copyNoiseSd: 0.15 };

// Reservation behaviour (probabilities are further conditioned on traits).
const RESERVATION = {
  reserveScale: 0.55, // P(reserve | available) = scale * tendency * (0.35 + 0.65*digital)
  webBase: 0.06, // P(WEB) = webBase + webSlope * digital_affinity
  webSlope: 0.9,
  cancelBase: 0.05,
  cancelLowPunctuality: 0.1,
  codeNeverIssued: 0.04, // staff never processed it before expiry
};

// Wishlist & availability alert behaviour.
const WISHLIST = {
  discoveriesPerYearMax: 26, // * wishlist_tendency * (0.25 + activity)
  onUnavailable: 0.7, // * wishlist_tendency
  removeOnBorrow: 0.35,
};
const ALERT = {
  onUnavailable: 0.8, // * (0.3 + 0.7*digital) * desire
  followUpBase: 0.35,
  followUpDesire: 0.5,
  followUpMaxDelayHours: 48,
  wantTtlDays: 75,
  notifyLocalHour: 8, // alert job runs each morning
};

// Return/reading behaviour.
const READING = {
  // pages/day read by persona speed trait; reading time = pages / speed.
  imputedPagesByCategory: {
    'ky-nang-song': [180, 320], 'kinh-te': [220, 420], 'van-hoc-viet-nam': [150, 420],
    'van-hoc-nuoc-ngoai': [250, 520], 'truyen-ngan': [120, 260], 'ky-thuat': [300, 600],
    'thieu-nhi': [40, 160], 'nuoi-day-con': [160, 300], 'am-thuc': [120, 240],
    'congtac-vien': [250, 500],'chua-phan-loai': [150, 350],
  },
  returnTogetherShare: 0.7, // items of one loan returned in the same visit
  damagedOnReturn: 0.04,
  maxDaysLate: 45,
  meanDaysLate: 5,
};

// Renewal: logistic in renewal tendency, reading-time pressure and lateness.
const RENEWAL = { r0: -2.6, rTendency: 3.0, rPressure: 1.6, rLateness: 0.8, extensionDays: [7, 14], secondRenewalShare: 0.25 };

// Fines and payment behaviour.
const FINES = {
  quickPayMeanDays: 2, // P(quick) = reliability^2; paid after Exp(mean + 5*(1-reliability)) days
  slowPayDays: [20, 120],
  slowPayShare: 0.4, // of those who did not pay quickly
  counterPaymentBase: 0.1, // P(pay outstanding fines at a visit) = base + rel * reliability^2
  counterPaymentReliability: 0.4,
};

// Reviews: only after a returned loan. Rating from a latent enjoyment score.
const REVIEWS = {
  baseScale: 0.9, // P(review) = scale * review_tendency * (0.4 + 0.6 * engagement)
  commentShare: 0.6,
  maxDelayMeanDays: 3,
  // score = tasteWeight*(taste-0.5)*2 + qualityWeight*quality_z + leniency + N(0, noiseSd)
  tasteWeight: 1.3,
  qualityWeight: 0.6,
  noiseSd: 0.75,
  // Upper thresholds of the latent score for 1..4 stars (5 = above the last).
  thresholds: [-1.6, -0.8, 0.05, 1.2],
};

// ─────────────────────────────────────────────────────────────────────────────
// Published generative risk coefficients (ground truth for AUC ceilings).
// Same functional forms and slope coefficients as the original
// seed-history.js (b1..b5, c1..c5), so effects stay comparable. Only the
// intercepts were re-calibrated for the persona population (which is more
// punctual loan-weighted: heavy readers borrow most and are punctual): with
// the original b0=-3.25 / c0=-3.0 the rates fell to ~0.13 / ~0.12. NO_SHOW
// also adds c6 (loans open at reservation time).
// ─────────────────────────────────────────────────────────────────────────────

// z = b0 + b1*(1-punctuality) + b2*loan_days_z + b3*items_in_loan_z
//        + b4*unpaid_fine_flag + b5*tier_effect
const LATE_COEFFICIENTS = { b0: -2.65, b1: 3.2, b2: 0.35, b3: 0.25, b4: 0.7, b5: -0.4 };

// z = c0 + c1*(1-punctuality) + c2*lead_hours_z + c3*hold_hours_z
//        + c4*channel_web + c5*prior_no_show_rate + c6*active_loans_z
const NO_SHOW_COEFFICIENTS = { c0: -2.55, c1: 2.6, c2: 0.4, c3: -0.3, c4: 0.5, c5: 2.0, c6: 0.25 };

const TIER_EFFECT = { VIP: 1, GOLD: 0.5, SILVER: 0, BASIC: -0.3 };
const BASE_RATE_TARGETS = { late_return: 0.2, no_show: 0.18 };

module.exports = {
  GENERATOR_VERSION,
  DEFAULTS,
  SIM_PREFIX,
  PREFIX,
  LEGACY_PREFIX,
  LOCAL_TZ_OFFSET_HOURS,
  OPENING_HOURS,
  ONLINE_HOURS,
  PLACEHOLDER_STAFF_ID,
  FALLBACK_PLANS,
  TENURE,
  ACTIVITY,
  POPULARITY,
  SELECTION,
  STOCK,
  RESERVATION,
  WISHLIST,
  ALERT,
  READING,
  RENEWAL,
  FINES,
  REVIEWS,
  LATE_COEFFICIENTS,
  NO_SHOW_COEFFICIENTS,
  TIER_EFFECT,
  BASE_RATE_TARGETS,
};
