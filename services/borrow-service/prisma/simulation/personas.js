// Reading personas, demographic tables and life-stage temporal profiles.
//
// SIMULATION ASSUMPTIONS, NOT MEASURED FACTS. The age mix, occupation mix and
// every persona range below are design choices for a plausible synthetic
// population; they are not SmartBook's (or any library's) real demographics.
//
// Trait ranges are [lo, hi] persona priors: each customer draws a value
// uniformly in the range and then adds individual gaussian noise (see
// behavior-model.js), so two readers of the same persona never share one
// profile and neighbouring personas overlap.
//
// Category keys are inventory category SLUGS (stable across environments,
// unlike category ids). Categories with no borrowable book in the catalog
// simply carry no mass after renormalisation (see preferences.js).
//
// FAIRNESS: gender appears in the demographic table only. It is never an input
// to persona, occupation, preference, lateness, no-show or membership choice
// (verified by the gender-independence section of the validation report).

const CATEGORY_SLUGS = [
  'van-hoc-viet-nam', 'van-hoc-nuoc-ngoai', 'truyen-ngan', 'ky-nang-song', 'kinh-te',
  'ky-thuat', 'congtac-vien', 'am-thuc', 'thieu-nhi', 'nuoi-day-con', 'chua-phan-loai',
];

const AGE_BUCKETS = [
  { label: '15-18', min: 15, max: 18, weight: 0.08 },
  { label: '19-24', min: 19, max: 24, weight: 0.34 },
  { label: '25-34', min: 25, max: 34, weight: 0.27 },
  { label: '35-44', min: 35, max: 44, weight: 0.16 },
  { label: '45-54', min: 45, max: 54, weight: 0.09 },
  { label: '55+', min: 55, max: 75, weight: 0.06 },
];

const GENDER_WEIGHTS = { MALE: 0.47, FEMALE: 0.47, OTHER: 0.02, UNSPECIFIED: 0.04 };

// P(occupation | age bucket) - life stage follows age, never gender.
const OCCUPATION_BY_AGE = {
  '15-18': { HIGH_SCHOOL_STUDENT: 0.9, OTHER: 0.1 },
  '19-24': { UNIVERSITY_STUDENT: 0.35, IT_STUDENT: 0.2, BUSINESS_STUDENT: 0.15, OFFICE_WORKER: 0.12, TECH_WORKER: 0.08, SELF_EMPLOYED: 0.04, OTHER: 0.06 },
  '25-34': { OFFICE_WORKER: 0.3, TECH_WORKER: 0.2, TEACHER: 0.08, RESEARCHER: 0.07, PARENT: 0.15, SELF_EMPLOYED: 0.12, OTHER: 0.08 },
  '35-44': { OFFICE_WORKER: 0.25, TECH_WORKER: 0.1, TEACHER: 0.1, RESEARCHER: 0.05, PARENT: 0.3, SELF_EMPLOYED: 0.15, OTHER: 0.05 },
  '45-54': { OFFICE_WORKER: 0.25, TECH_WORKER: 0.05, TEACHER: 0.12, RESEARCHER: 0.06, PARENT: 0.22, SELF_EMPLOYED: 0.2, OTHER: 0.1 },
  '55+': { RETIRED: 0.55, OFFICE_WORKER: 0.1, TEACHER: 0.08, RESEARCHER: 0.05, SELF_EMPLOYED: 0.12, OTHER: 0.1 },
};

// P(persona | occupation).
const PERSONA_BY_OCCUPATION = {
  HIGH_SCHOOL_STUDENT: { CASUAL_READER: 0.25, LITERATURE_LOVER: 0.2, EXPLORER: 0.15, LOW_ENGAGEMENT: 0.2, HEAVY_READER: 0.08, SELF_DEVELOPMENT_READER: 0.07, TECH_FOCUSED_READER: 0.05 },
  UNIVERSITY_STUDENT: { CASUAL_READER: 0.2, LITERATURE_LOVER: 0.18, EXPLORER: 0.15, HEAVY_READER: 0.12, SELF_DEVELOPMENT_READER: 0.12, TECH_FOCUSED_READER: 0.08, LOW_ENGAGEMENT: 0.15 },
  IT_STUDENT: { TECH_FOCUSED_READER: 0.5, CASUAL_READER: 0.12, HEAVY_READER: 0.1, SELF_DEVELOPMENT_READER: 0.1, EXPLORER: 0.08, LOW_ENGAGEMENT: 0.1 },
  BUSINESS_STUDENT: { SELF_DEVELOPMENT_READER: 0.4, CASUAL_READER: 0.15, EXPLORER: 0.1, HEAVY_READER: 0.08, LITERATURE_LOVER: 0.07, TECH_FOCUSED_READER: 0.05, LOW_ENGAGEMENT: 0.15 },
  OFFICE_WORKER: { CASUAL_READER: 0.3, SELF_DEVELOPMENT_READER: 0.25, LITERATURE_LOVER: 0.1, EXPLORER: 0.08, HEAVY_READER: 0.05, TECH_FOCUSED_READER: 0.04, LOW_ENGAGEMENT: 0.18 },
  TECH_WORKER: { TECH_FOCUSED_READER: 0.45, SELF_DEVELOPMENT_READER: 0.15, CASUAL_READER: 0.12, HEAVY_READER: 0.08, EXPLORER: 0.08, LOW_ENGAGEMENT: 0.12 },
  TEACHER: { LITERATURE_LOVER: 0.35, HEAVY_READER: 0.15, EXPLORER: 0.15, CASUAL_READER: 0.15, PARENT_READER: 0.1, SELF_DEVELOPMENT_READER: 0.1 },
  RESEARCHER: { HEAVY_READER: 0.3, EXPLORER: 0.25, TECH_FOCUSED_READER: 0.2, LITERATURE_LOVER: 0.1, SELF_DEVELOPMENT_READER: 0.1, CASUAL_READER: 0.05 },
  PARENT: { PARENT_READER: 0.55, CASUAL_READER: 0.15, SELF_DEVELOPMENT_READER: 0.08, LITERATURE_LOVER: 0.07, LOW_ENGAGEMENT: 0.15 },
  SELF_EMPLOYED: { SELF_DEVELOPMENT_READER: 0.35, CASUAL_READER: 0.25, EXPLORER: 0.08, HEAVY_READER: 0.05, LOW_ENGAGEMENT: 0.27 },
  RETIRED: { LITERATURE_LOVER: 0.3, HEAVY_READER: 0.2, CASUAL_READER: 0.25, EXPLORER: 0.1, LOW_ENGAGEMENT: 0.15 },
  OTHER: { CASUAL_READER: 0.35, EXPLORER: 0.15, LITERATURE_LOVER: 0.1, SELF_DEVELOPMENT_READER: 0.1, LOW_ENGAGEMENT: 0.3 },
};

// Occupation shifts taste on top of the persona prior (multiplicative).
const OCCUPATION_CATEGORY_BOOST = {
  HIGH_SCHOOL_STUDENT: { 'van-hoc-viet-nam': 1.4, 'truyen-ngan': 1.3 },
  UNIVERSITY_STUDENT: { 'van-hoc-nuoc-ngoai': 1.2, 'ky-nang-song': 1.2 },
  IT_STUDENT: { 'ky-thuat': 1.8 },
  BUSINESS_STUDENT: { 'kinh-te': 1.8, 'ky-nang-song': 1.3 },
  OFFICE_WORKER: { 'ky-nang-song': 1.3, 'kinh-te': 1.3 },
  TECH_WORKER: { 'ky-thuat': 1.8, 'kinh-te': 1.2 },
  TEACHER: { 'van-hoc-viet-nam': 1.5, 'nuoi-day-con': 1.2 },
  RESEARCHER: { 'congtac-vien': 1.4, 'ky-thuat': 1.3 },
  PARENT: { 'thieu-nhi': 1.6, 'nuoi-day-con': 1.6, 'am-thuc': 1.3 },
  SELF_EMPLOYED: { 'kinh-te': 1.6 },
  RETIRED: { 'congtac-vien': 1.6, 'van-hoc-viet-nam': 1.4, 'am-thuc': 1.2 },
  OTHER: {},
};

const LIFE_STAGE_BY_OCCUPATION = {
  HIGH_SCHOOL_STUDENT: 'STUDENT', UNIVERSITY_STUDENT: 'STUDENT', IT_STUDENT: 'STUDENT', BUSINESS_STUDENT: 'STUDENT',
  OFFICE_WORKER: 'WORKING', TECH_WORKER: 'WORKING', TEACHER: 'WORKING', RESEARCHER: 'WORKING',
  SELF_EMPLOYED: 'WORKING', OTHER: 'WORKING', PARENT: 'PARENT', RETIRED: 'RETIRED',
};

// Local-time activity windows [fromHour, toHour, weight] and monthly
// seasonality (Jan..Dec) per life stage. Students: semester starts and exam
// months up, Tet (Jan/Feb) and summer down. Working adults: mild. Parents:
// school holidays (Jun-Aug) up. Retired: nearly flat.
const LIFE_STAGES = {
  STUDENT: {
    windows: [[9, 11, 1.0], [14, 17, 1.2], [19, 22, 1.0]],
    hourSpread: [1.0, 2.2],
    seasonality: [0.95, 0.6, 1.2, 1.1, 1.15, 0.8, 0.55, 0.75, 1.35, 1.2, 1.1, 1.2],
  },
  WORKING: {
    windows: [[7, 8, 0.6], [12, 13, 0.8], [17, 21, 1.4]],
    hourSpread: [0.8, 1.8],
    seasonality: [1.0, 0.8, 1.05, 1.0, 1.0, 0.95, 0.95, 1.0, 1.05, 1.05, 1.0, 1.05],
  },
  PARENT: {
    windows: [[9, 11, 1.0], [15, 18, 1.2], [19, 21, 0.6]],
    hourSpread: [1.0, 2.0],
    seasonality: [1.0, 0.8, 0.95, 0.95, 1.0, 1.3, 1.35, 1.1, 0.95, 0.95, 0.95, 1.0],
  },
  RETIRED: {
    windows: [[8, 11, 1.4], [14, 16, 1.0]],
    hourSpread: [0.8, 1.6],
    seasonality: [1.0, 0.85, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0],
  },
};

function prefs(overrides) {
  return Object.fromEntries(CATEGORY_SLUGS.map((slug) => [slug, overrides[slug] ?? 0.1]));
}

// traits: [lo, hi] priors. reading_speed is pages/day. items: loan size
// distribution. churn: probability of drifting to inactivity during the window.
const PERSONAS = {
  CASUAL_READER: {
    traits: {
      activity_level: [0.3, 0.46], punctuality: [0.35, 0.85], digital_affinity: [0.3, 0.8],
      reservation_tendency: [0.1, 0.35], wishlist_tendency: [0.1, 0.35], review_tendency: [0.03, 0.15],
      renewal_tendency: [0.15, 0.45], exploration: [0.2, 0.4], reading_speed: [15, 35],
      payment_reliability: [0.4, 0.85], weekend_affinity: [0.35, 0.65],
    },
    items: { 1: 0.78, 2: 0.19, 3: 0.03 },
    churn: 0.25,
    categories: prefs({ 'truyen-ngan': 0.7, 'van-hoc-viet-nam': 0.6, 'ky-nang-song': 0.5, 'van-hoc-nuoc-ngoai': 0.4, 'kinh-te': 0.25, 'am-thuc': 0.35, 'congtac-vien': 0.2 }),
  },
  HEAVY_READER: {
    traits: {
      activity_level: [0.82, 0.97], punctuality: [0.6, 0.97], digital_affinity: [0.5, 0.95],
      reservation_tendency: [0.35, 0.7], wishlist_tendency: [0.55, 0.9], review_tendency: [0.25, 0.55],
      renewal_tendency: [0.2, 0.5], exploration: [0.2, 0.4], reading_speed: [45, 90],
      payment_reliability: [0.7, 0.98], weekend_affinity: [0.3, 0.7],
    },
    items: { 1: 0.3, 2: 0.45, 3: 0.25 },
    churn: 0.04,
    categories: prefs({ 'van-hoc-nuoc-ngoai': 0.8, 'van-hoc-viet-nam': 0.75, 'truyen-ngan': 0.6, 'ky-nang-song': 0.5, 'kinh-te': 0.4, 'congtac-vien': 0.45, 'ky-thuat': 0.3 }),
  },
  LITERATURE_LOVER: {
    traits: {
      activity_level: [0.55, 0.8], punctuality: [0.45, 0.95], digital_affinity: [0.3, 0.8],
      reservation_tendency: [0.25, 0.55], wishlist_tendency: [0.4, 0.75], review_tendency: [0.2, 0.45],
      renewal_tendency: [0.2, 0.5], exploration: [0.08, 0.2], reading_speed: [30, 60],
      payment_reliability: [0.55, 0.95], weekend_affinity: [0.4, 0.75],
    },
    items: { 1: 0.5, 2: 0.38, 3: 0.12 },
    churn: 0.08,
    categories: prefs({ 'van-hoc-viet-nam': 0.95, 'van-hoc-nuoc-ngoai': 0.9, 'truyen-ngan': 0.85, 'ky-nang-song': 0.15, 'kinh-te': 0.05, 'congtac-vien': 0.25, 'ky-thuat': 0.03 }),
  },
  TECH_FOCUSED_READER: {
    traits: {
      activity_level: [0.55, 0.8], punctuality: [0.4, 0.9], digital_affinity: [0.85, 1.0],
      reservation_tendency: [0.4, 0.7], wishlist_tendency: [0.5, 0.8], review_tendency: [0.15, 0.35],
      renewal_tendency: [0.2, 0.45], exploration: [0.1, 0.25], reading_speed: [25, 50],
      payment_reliability: [0.6, 0.95], weekend_affinity: [0.45, 0.8],
    },
    items: { 1: 0.55, 2: 0.35, 3: 0.1 },
    churn: 0.08,
    categories: prefs({ 'ky-thuat': 0.9, 'ky-nang-song': 0.6, 'kinh-te': 0.35, 'van-hoc-nuoc-ngoai': 0.2, 'truyen-ngan': 0.08, 'van-hoc-viet-nam': 0.05 }),
  },
  SELF_DEVELOPMENT_READER: {
    traits: {
      activity_level: [0.5, 0.74], punctuality: [0.5, 0.95], digital_affinity: [0.5, 0.9],
      reservation_tendency: [0.3, 0.6], wishlist_tendency: [0.4, 0.75], review_tendency: [0.15, 0.4],
      renewal_tendency: [0.2, 0.45], exploration: [0.1, 0.25], reading_speed: [25, 50],
      payment_reliability: [0.6, 0.95], weekend_affinity: [0.3, 0.6],
    },
    items: { 1: 0.6, 2: 0.32, 3: 0.08 },
    churn: 0.1,
    categories: prefs({ 'ky-nang-song': 0.95, 'kinh-te': 0.75, 'congtac-vien': 0.2, 'van-hoc-nuoc-ngoai': 0.15, 'nuoi-day-con': 0.15, 'truyen-ngan': 0.08, 'van-hoc-viet-nam': 0.08 }),
  },
  PARENT_READER: {
    traits: {
      activity_level: [0.42, 0.64], punctuality: [0.4, 0.9], digital_affinity: [0.35, 0.8],
      reservation_tendency: [0.25, 0.55], wishlist_tendency: [0.25, 0.55], review_tendency: [0.1, 0.3],
      renewal_tendency: [0.3, 0.6], exploration: [0.15, 0.3], reading_speed: [15, 35],
      payment_reliability: [0.55, 0.9], weekend_affinity: [0.55, 0.85],
    },
    items: { 1: 0.35, 2: 0.4, 3: 0.25 },
    churn: 0.1,
    categories: prefs({ 'thieu-nhi': 0.95, 'nuoi-day-con': 0.9, 'am-thuc': 0.5, 'truyen-ngan': 0.45, 'van-hoc-viet-nam': 0.4, 'ky-nang-song': 0.35 }),
  },
  EXPLORER: {
    traits: {
      activity_level: [0.5, 0.74], punctuality: [0.35, 0.9], digital_affinity: [0.45, 0.9],
      reservation_tendency: [0.25, 0.55], wishlist_tendency: [0.45, 0.8], review_tendency: [0.2, 0.45],
      renewal_tendency: [0.15, 0.4], exploration: [0.4, 0.65], reading_speed: [30, 60],
      payment_reliability: [0.5, 0.9], weekend_affinity: [0.4, 0.7],
    },
    items: { 1: 0.45, 2: 0.4, 3: 0.15 },
    churn: 0.1,
    categories: prefs(Object.fromEntries(CATEGORY_SLUGS.map((slug) => [slug, 0.5]))),
  },
  LOW_ENGAGEMENT: {
    traits: {
      activity_level: [0.08, 0.25], punctuality: [0.1, 0.7], digital_affinity: [0.1, 0.6],
      reservation_tendency: [0.03, 0.2], wishlist_tendency: [0.02, 0.15], review_tendency: [0.0, 0.06],
      renewal_tendency: [0.1, 0.4], exploration: [0.2, 0.45], reading_speed: [8, 25],
      payment_reliability: [0.2, 0.7], weekend_affinity: [0.3, 0.6],
    },
    items: { 1: 0.9, 2: 0.1 },
    churn: 0.4,
    categories: prefs({ 'truyen-ngan': 0.6, 'van-hoc-viet-nam': 0.5, 'ky-nang-song': 0.45, 'am-thuc': 0.3, 'kinh-te': 0.2, 'van-hoc-nuoc-ngoai': 0.25 }),
  },
};

module.exports = {
  CATEGORY_SLUGS,
  AGE_BUCKETS,
  GENDER_WEIGHTS,
  OCCUPATION_BY_AGE,
  PERSONA_BY_OCCUPATION,
  OCCUPATION_CATEGORY_BOOST,
  LIFE_STAGE_BY_OCCUPATION,
  LIFE_STAGES,
  PERSONAS,
};
