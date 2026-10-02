// Demographic profile: age -> occupation/life stage -> persona.
// Gender is drawn independently and deliberately feeds nothing downstream.

const {
  AGE_BUCKETS, GENDER_WEIGHTS, OCCUPATION_BY_AGE, PERSONA_BY_OCCUPATION, LIFE_STAGE_BY_OCCUPATION,
} = require('./personas');

function sampleDemographics(rng) {
  const bucket = AGE_BUCKETS[rng.weightedIndex(AGE_BUCKETS.map((b) => b.weight))];
  const age = rng.int(bucket.min, bucket.max);
  const gender = rng.weightedKey(GENDER_WEIGHTS);
  const occupation = rng.weightedKey(OCCUPATION_BY_AGE[bucket.label]);
  const persona = rng.weightedKey(PERSONA_BY_OCCUPATION[occupation]);
  return {
    age,
    age_bucket: bucket.label,
    gender,
    occupation,
    life_stage: LIFE_STAGE_BY_OCCUPATION[occupation],
    persona,
  };
}

module.exports = { sampleDemographics };
