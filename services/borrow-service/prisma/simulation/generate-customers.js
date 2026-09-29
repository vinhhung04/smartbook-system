// Synthetic population: demographics -> persona -> latent traits ->
// preferences -> temporal habits -> plan -> tenure. Each customer object holds
// both the DB-visible row data and the simulation-only truth plus the mutable
// state the event engine updates (held books, fines, wishlist, ...).

const { PREFIX, TENURE, OPENING_HOURS } = require('./config');
const { PERSONAS } = require('./personas');
const { sampleDemographics } = require('./demographics');
const { sampleTraits, choosePlan } = require('./behavior-model');
const { sampleTemporalProfile, DAY_MS, localDayStart, atLocalHour } = require('./temporal-model');
const { sampleCategoryPreferences, sampleAuthorAffinity } = require('./preferences');

const FIRST_NAMES = ['Anh', 'Binh', 'Chau', 'Dung', 'Giang', 'Hoa', 'Khanh', 'Lan', 'Minh', 'Nga', 'Phong', 'Quyen', 'Son', 'Thao', 'Trang', 'Tuan', 'Van', 'Yen'];
const LAST_NAMES = ['Nguyen', 'Tran', 'Le', 'Pham', 'Hoang', 'Phan', 'Vu', 'Vo', 'Dang', 'Bui', 'Do', 'Ho', 'Ngo', 'Duong'];
const YEAR_MS = 365 * DAY_MS;

// Sign-up day for in-window joiners, weighted by month (semester starts).
function sampleJoinDay(rng, windowStart, end) {
  const lastJoin = end.getTime() - 14 * DAY_MS;
  const days = Math.floor((lastJoin - windowStart.getTime()) / DAY_MS);
  const weights = [];
  for (let d = 0; d < days; d += 1) {
    weights.push(TENURE.joinMonthWeight[new Date(windowStart.getTime() + d * DAY_MS).getUTCMonth()]);
  }
  return new Date(windowStart.getTime() + rng.weightedIndex(weights) * DAY_MS);
}

function buildPopulation(ctx, { count, plans }) {
  const { rng, idRng, windowStart, end, catalog } = ctx;
  const customers = [];
  for (let i = 0; i < count; i += 1) {
    const idx = String(i + 1).padStart(4, '0');
    const demographics = sampleDemographics(rng);
    const traits = sampleTraits(rng, demographics.persona);
    const temporal = sampleTemporalProfile(rng, demographics.life_stage);
    const prefs = sampleCategoryPreferences(rng, demographics.persona, demographics.occupation, catalog.categoriesPresent);
    const authorAffinity = sampleAuthorAffinity(rng, catalog, prefs.effective);
    const plan = choosePlan(rng, traits.activity_level, plans);

    const established = rng.chance(TENURE.establishedShare);
    const joinDay = established
      ? new Date(windowStart.getTime() - rng.range(0, TENURE.establishedMaxYearsBefore * YEAR_MS))
      : sampleJoinDay(rng, windowStart, end);
    const createdAt = atLocalHour(localDayStart(joinDay), rng.range(OPENING_HOURS.open, OPENING_HOURS.close - 0.5));

    const activeFrom = Math.max(createdAt.getTime(), windowStart.getTime());
    let churnAt = null;
    if (rng.chance(PERSONAS[demographics.persona].churn)) {
      const at = activeFrom + rng.range(60, 730) * DAY_MS;
      if (at < end.getTime()) churnAt = at;
    }
    const homeWarehouse = rng.weightedIndex([0.4, 0.3, 0.2, 0.1]);
    const birthDate = new Date(end.getTime() - demographics.age * YEAR_MS - rng.range(0, 364) * DAY_MS);

    customers.push({
      id: idRng.uuid(),
      customer_code: `${PREFIX.customer}${idx}`,
      card_number: `${PREFIX.card}${idx}`,
      full_name: `${rng.pick(LAST_NAMES)} ${rng.pick(FIRST_NAMES)} ${idx}`,
      birth_date: new Date(Date.UTC(birthDate.getUTCFullYear(), birthDate.getUTCMonth(), birthDate.getUTCDate())),
      created_at: createdAt,
      tenure_segment: established ? 'ESTABLISHED_BEFORE_WINDOW' : 'JOINED_IN_WINDOW',
      demographics,
      persona: demographics.persona,
      traits,
      temporal,
      prefs,
      authorAffinity,
      plan,
      churnAt,
      homeWarehouse,
      // mutable simulation state
      held: new Map(),
      borrowed: new Set(),
      wishlist: new Map(),
      reviewed: new Set(),
      likedAuthors: new Map(),
      recentCategories: [],
      fines: [],
      loanEnds: [],
      reservationOutcomes: [],
      burst: 1,
      burstMonth: -1,
    });
  }
  return customers;
}

function customerRows(customers, end) {
  return customers.map((c) => {
    const unpaid = c.fines.filter((f) => !f.paid_at).reduce((sum, f) => sum + f.amount, 0);
    return {
      id: c.id,
      customer_code: c.customer_code,
      full_name: c.full_name,
      birth_date: c.birth_date,
      status: 'ACTIVE',
      total_fine_balance: unpaid,
      created_at: c.created_at,
      updated_at: end,
    };
  });
}

function membershipRows(ctx, customers) {
  return customers.map((c) => ({
    id: ctx.idRng.uuid(),
    customer_id: c.id,
    plan_id: c.plan.id,
    card_number: c.card_number,
    // @db.Date column: the sign-up calendar day (UTC date of created_at).
    start_date: new Date(Date.UTC(c.created_at.getUTCFullYear(), c.created_at.getUTCMonth(), c.created_at.getUTCDate())),
    status: 'ACTIVE',
    created_at: c.created_at,
    updated_at: c.created_at,
  }));
}

module.exports = { buildPopulation, customerRows, membershipRows };
