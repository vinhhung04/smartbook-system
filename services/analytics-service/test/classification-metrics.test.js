const test = require('node:test');
const assert = require('node:assert/strict');
const {
  rocAuc, confusionAt, precisionRecallF1, bestThresholdByF1,
  brierScore, calibrationBins, expectedCalibrationError, liftAtK,
} = require('../src/utils/classification-metrics');

test('rocAuc is 1 on perfect separation', () => {
  assert.equal(rocAuc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9]), 1);
});

test('rocAuc is 0.5 when scores carry no signal (all identical)', () => {
  assert.equal(rocAuc([0, 0, 1, 1], [0.5, 0.5, 0.5, 0.5]), 0.5);
});

test('rocAuc is null when a class is entirely absent', () => {
  assert.equal(rocAuc([1, 1, 1], [0.2, 0.5, 0.9]), null);
  assert.equal(rocAuc([0, 0, 0], [0.2, 0.5, 0.9]), null);
});

test('rocAuc matches a hand-computed value (catches a sign/direction bug)', () => {
  // negatives = {0.1, 0.4}, positives = {0.35, 0.8}
  // pair-wise: (0.35>0.1)=1, (0.35>0.4)=0, (0.8>0.1)=1, (0.8>0.4)=1 -> 3/4 = 0.75
  assert.equal(rocAuc([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8]), 0.75);
});

test('confusionAt + precisionRecallF1 on a hand-worked example', () => {
  const labels = [1, 1, 0, 0, 1];
  const scores = [0.9, 0.4, 0.3, 0.2, 0.6];
  const confusion = confusionAt(labels, scores, 0.5);
  assert.deepEqual(confusion, { tp: 2, fp: 0, tn: 2, fn: 1 });
  const { precision, recall } = precisionRecallF1(confusion);
  assert.equal(precision, 1);
  assert.equal(recall, 2 / 3);
});

test('precision is 0, not NaN, when nothing is predicted positive', () => {
  const { precision } = precisionRecallF1({ tp: 0, fp: 0, tn: 5, fn: 3 });
  assert.equal(precision, 0);
});

test('bestThresholdByF1 finds a perfectly separating threshold', () => {
  const labels = [1, 1, 0, 0];
  const scores = [0.9, 0.8, 0.3, 0.1];
  // any threshold in (0.3, 0.8] separates the classes perfectly
  const best = bestThresholdByF1(labels, scores, { step: 0.05 });
  assert.equal(best.f1, 1);
  assert.ok(best.threshold > 0.3 && best.threshold <= 0.8);
});

test('brierScore is 0 for perfect predictions', () => {
  assert.equal(brierScore([1, 0], [1, 0]), 0);
});

test('calibrationBins bins by score and reports observed rate', () => {
  const labels = [0, 1, 1, 0];
  const scores = [0.05, 0.15, 0.85, 0.95];
  const bins = calibrationBins(labels, scores, 10);
  assert.equal(bins[0].count, 1);
  assert.equal(bins[0].observed_rate, 0);
  assert.equal(bins[1].count, 1);
  assert.equal(bins[1].observed_rate, 1);
});

test('expectedCalibrationError is 0 for a perfectly calibrated construction', () => {
  const labels = [1, 0, 1, 0];
  const scores = [0.5, 0.5, 0.5, 0.5]; // predicted 0.5, observed rate 0.5 in that bin
  const bins = calibrationBins(labels, scores, 2);
  assert.equal(expectedCalibrationError(bins), 0);
});

test('liftAtK is exactly 1 when scores carry no signal and the top-k slice matches the base rate', () => {
  // alternating labels, k=6: a stable sort over equal scores preserves input
  // order, so the top-6 slice is [1,0,1,0,1,0] - 3/6 = 0.5, same as the
  // population base rate (5/10) - no signal should mean no lift.
  const labels = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
  const scores = labels.map(() => 0.5);
  const result = liftAtK(labels, scores, 6);
  assert.equal(result.lift, 1);
});

test('liftAtK is greater than 1 when positives are ranked first', () => {
  const labels = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const scores = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05];
  const result = liftAtK(labels, scores, 3);
  assert.equal(result.precision_at_k, 1);
  assert.ok(result.lift > 1);
});

test('liftAtK clamps k larger than the sample size', () => {
  const labels = [1, 0, 1];
  const scores = [0.9, 0.1, 0.8];
  const result = liftAtK(labels, scores, 100);
  assert.equal(result.k, 3);
});
