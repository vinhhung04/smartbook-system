const test = require('node:test');
const assert = require('node:assert/strict');
const { temporalSplit, trainAndEvaluate } = require('../src/utils/risk-model');

// Small seeded PRNG, local to this test file - same convention as
// services/borrow-service/prisma/seed-history.js, so the fixture below is
// deterministic across runs (no flaky CI).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sigmoid(z) {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

// A known logistic process: label depends mostly on feature 0, weakly on
// feature 1, with genuine Bernoulli noise - so a good classifier should land
// comfortably above 0.75 AUC but nowhere near 1.0.
function buildFixture(n = 800) {
  const rand = mulberry32(42);
  const samples = [];
  for (let i = 0; i < n; i += 1) {
    const f0 = rand() * 10 - 5;
    const f1 = rand() * 4 - 2;
    const z = 1.2 * f0 + 0.3 * f1 - 0.5;
    const p = sigmoid(z);
    const label = rand() < p ? 1 : 0;
    samples.push({ features: [f0, f1], label, at: new Date(2024, 0, 1 + i) });
  }
  return samples;
}

test('temporalSplit keeps every train `at` at or before every test `at`', () => {
  const samples = buildFixture(100);
  const { train, test: testSet } = temporalSplit(samples, { testFraction: 0.3 });
  const maxTrainAt = Math.max(...train.map((s) => s.at.getTime()));
  const minTestAt = Math.min(...testSet.map((s) => s.at.getTime()));
  assert.ok(maxTrainAt <= minTestAt);
  assert.equal(train.length + testSet.length, samples.length);
});

test('trainAndEvaluate reports a held-out AUC comfortably above chance on a real signal', () => {
  const samples = buildFixture(800);
  const result = trainAndEvaluate(samples, { featureNames: ['f0', 'f1'], minSamples: 100, minPositives: 10 });
  assert.equal(result.status, 'OK');
  assert.ok(result.evaluation.auc > 0.75, `expected auc > 0.75, got ${result.evaluation.auc}`);
});

test('leakage guard: shuffling only the test labels collapses AUC toward chance', () => {
  const samples = buildFixture(800);
  const { train, test: testSet } = temporalSplit(samples, { testFraction: 0.25 });

  // Shuffle the test labels among themselves (Fisher-Yates, same seeded PRNG)
  // so the test set's features no longer relate to its own labels, while
  // train is untouched. If trainAndEvaluate's reported AUC were leaking
  // future information into training, this would NOT collapse it - held-out
  // evaluation is precisely what makes this test meaningful.
  const rand = mulberry32(7);
  const shuffledLabels = testSet.map((s) => s.label);
  for (let i = shuffledLabels.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [shuffledLabels[i], shuffledLabels[j]] = [shuffledLabels[j], shuffledLabels[i]];
  }
  const tamperedTest = testSet.map((s, i) => ({ ...s, label: shuffledLabels[i] }));
  const combined = [...train, ...tamperedTest];

  const result = trainAndEvaluate(combined, { featureNames: ['f0', 'f1'], testFraction: 0.25, minSamples: 100, minPositives: 10 });
  assert.equal(result.status, 'OK');
  assert.ok(result.evaluation.auc < 0.6, `expected leakage-guard auc < 0.6, got ${result.evaluation.auc}`);
});

test('reports INSUFFICIENT_DATA rather than throwing when everything is one class', () => {
  const samples = Array.from({ length: 300 }, (_, i) => ({ features: [i, i * 2], label: 1, at: new Date(2024, 0, 1 + i) }));
  const result = trainAndEvaluate(samples, { featureNames: ['f0', 'f1'], minSamples: 100, minPositives: 10 });
  assert.equal(result.status, 'INSUFFICIENT_DATA');
});

test('reports INSUFFICIENT_DATA rather than throwing when there are too few samples', () => {
  const samples = buildFixture(20);
  const result = trainAndEvaluate(samples, { featureNames: ['f0', 'f1'], minSamples: 200, minPositives: 10 });
  assert.equal(result.status, 'INSUFFICIENT_DATA');
});
