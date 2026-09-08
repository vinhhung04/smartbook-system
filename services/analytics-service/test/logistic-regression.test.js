const test = require('node:test');
const assert = require('node:assert/strict');
const { sigmoid, fitLogisticRegression, predictProbability, featureContributions } = require('../src/utils/logistic-regression');

test('sigmoid never overflows to NaN at extreme z', () => {
  assert.equal(sigmoid(1000), 1);
  assert.equal(sigmoid(-1000), 0);
  assert.ok(Number.isFinite(sigmoid(1000)));
  assert.ok(Number.isFinite(sigmoid(-1000)));
});

test('classifies a linearly separable two-feature set correctly', () => {
  const rows = [
    [0, 0], [0.5, -0.5], [-0.5, 0.5], [1, -1], [-1, 1],
    [5, 5], [4.5, 5.5], [5.5, 4.5], [6, 6], [4, 4],
  ];
  const labels = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
  const model = fitLogisticRegression(rows, labels, { iterations: 3000 });
  rows.forEach((row, i) => {
    const p = predictProbability(model, row);
    assert.equal(p > 0.5, labels[i] === 1, `row ${i} expected label ${labels[i]}, got p=${p}`);
  });
});

test('a constant column never produces NaN in weights or predictions', () => {
  const rows = [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]];
  const labels = [0, 0, 1, 1, 1];
  const model = fitLogisticRegression(rows, labels, { iterations: 500 });
  assert.ok(model.weights.every((w) => Number.isFinite(w)));
  const p = predictProbability(model, [3, 5]);
  assert.ok(Number.isFinite(p));
});

test('stronger L2 regularization yields a strictly smaller weight norm', () => {
  const rows = Array.from({ length: 40 }, (_, i) => [i - 20, (i - 20) * 2]);
  const labels = rows.map((r) => (r[0] > 0 ? 1 : 0));
  const weak = fitLogisticRegression(rows, labels, { l2: 0, iterations: 500 });
  const strong = fitLogisticRegression(rows, labels, { l2: 0.5, iterations: 500 });
  const norm = (m) => m.weights.reduce((s, w) => s + Math.abs(w), 0);
  assert.ok(norm(strong) < norm(weak));
});

test('training is reproducible: identical input yields identical weights', () => {
  const rows = Array.from({ length: 20 }, (_, i) => [i, i * 2, 30 - i]);
  const labels = rows.map((r) => (r[0] > 9 ? 1 : 0));
  const a = fitLogisticRegression(rows, labels, { iterations: 300 });
  const b = fitLogisticRegression(rows, labels, { iterations: 300 });
  assert.deepEqual(a.weights, b.weights);
  assert.equal(a.bias, b.bias);
});

test('featureContributions ranks the dominant feature first', () => {
  // feature 0 carries all the signal, feature 1 is pure noise (mean-only, no variance so it's excluded via constant column)
  const rows = Array.from({ length: 30 }, (_, i) => [i - 15, 0]);
  const labels = rows.map((r) => (r[0] > 0 ? 1 : 0));
  const model = fitLogisticRegression(rows, labels, { iterations: 1000 });
  const contributions = featureContributions(model, [10, 0]);
  assert.equal(contributions[0].index, 0);
});
