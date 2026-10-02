// Per-customer temporal habits: preferred hour, hour spread, weekday/weekend
// balance, and life-stage seasonality. Times are simulated in library-local
// time and converted to UTC Date objects.

const { LIFE_STAGES } = require('./personas');
const { LOCAL_TZ_OFFSET_HOURS, OPENING_HOURS, ONLINE_HOURS } = require('./config');
const { clamp } = require('./random');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function sampleTemporalProfile(rng, lifeStage) {
  const stage = LIFE_STAGES[lifeStage];
  const window = stage.windows[rng.weightedIndex(stage.windows.map((w) => w[2]))];
  return {
    life_stage: lifeStage,
    preferred_hour: Math.round(rng.range(window[0], window[1]) * 2) / 2,
    hour_spread: rng.range(stage.hourSpread[0], stage.hourSpread[1]),
  };
}

// Mean-one weekday multipliers from weekend_affinity (0 = weekday person,
// 1 = weekend person).
function dayOfWeekFactor(weekendAffinity, localDow) {
  const weekday = 1.5 - weekendAffinity;
  const weekend = 0.5 + 1.5 * weekendAffinity;
  const norm = (5 * weekday + 2 * weekend) / 7;
  return (localDow >= 5 ? weekend : weekday) / norm; // localDow: Mon=0..Sun=6
}

function seasonalFactor(lifeStage, localMonth) {
  return LIFE_STAGES[lifeStage].seasonality[localMonth];
}

// Local midnight (as a UTC instant) of the local calendar day containing `date`.
function localDayStart(date) {
  const local = date.getTime() + LOCAL_TZ_OFFSET_HOURS * HOUR_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - LOCAL_TZ_OFFSET_HOURS * HOUR_MS);
}
function localParts(dayStart) {
  const local = new Date(dayStart.getTime() + LOCAL_TZ_OFFSET_HOURS * HOUR_MS);
  return { dow: (local.getUTCDay() + 6) % 7, month: local.getUTCMonth(), year: local.getUTCFullYear() };
}

// Local hour for one session: mostly around the preferred hour, sometimes any
// of the life-stage windows. Walk-ins are clamped to counter opening hours.
function sampleLocalHour(rng, profile, { walkIn }) {
  const stage = LIFE_STAGES[profile.life_stage];
  let hour;
  if (rng.chance(0.75)) {
    hour = profile.preferred_hour + rng.gaussian(0, profile.hour_spread);
  } else {
    const w = stage.windows[rng.weightedIndex(stage.windows.map((x) => x[2]))];
    hour = rng.range(w[0], w[1]);
  }
  const hours = walkIn ? OPENING_HOURS : ONLINE_HOURS;
  return clamp(hour, hours.open, hours.close - 0.05);
}

function atLocalHour(dayStart, hour) {
  return new Date(dayStart.getTime() + hour * HOUR_MS);
}

module.exports = {
  DAY_MS,
  HOUR_MS,
  sampleTemporalProfile,
  dayOfWeekFactor,
  seasonalFactor,
  localDayStart,
  localParts,
  sampleLocalHour,
  atLocalHour,
};
