// Hand-written binary logistic regression - no dependency, same convention as
// forecast.js / lead-time.js / budget-allocation.js / weeding.js. Pure
// functions, no DB access, deterministic given the same rows/labels (weights
// start at zero, iteration count is fixed - no randomness anywhere).
//
// Why hand-written instead of a library: risk-model.js / risk-features.js
// need this to run inside analytics-service, which has no numpy/sklearn and
// is the only process with a direct connection to borrow_db (see
// docs/superpowers/specs - Area A design). Interpretable coefficients are
// also the point: the thesis reports a signed weight per feature, not a
// black-box score.

// sigmoid(z), branching on the sign of z so exp() is always evaluated on a
// non-positive argument - keeps z = +-1000 finite (1 / 0) instead of NaN.
function sigmoid(z) {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

function standardize(rows, featureCount) {
  const n = rows.length;
  const mean = new Array(featureCount).fill(0);
  for (const row of rows) {
    for (let j = 0; j < featureCount; j += 1) mean[j] += row[j] / n;
  }
  const std = new Array(featureCount).fill(0);
  for (const row of rows) {
    for (let j = 0; j < featureCount; j += 1) std[j] += (row[j] - mean[j]) ** 2 / n;
  }
  for (let j = 0; j < featureCount; j += 1) {
    std[j] = Math.sqrt(std[j]);
    if (std[j] === 0) std[j] = 1; // constant column: standardized value is 0 for every row, never divide by 0
  }
  return { mean, std };
}

function applyStandardization(row, mean, std) {
  return row.map((value, j) => (value - mean[j]) / std[j]);
}

/**
 * Batch gradient descent, L2 on the weights only (never the bias).
 *
 * @param {number[][]} rows - raw (unstandardized) feature rows
 * @param {number[]} labels - 0/1
 * @param {{learningRate?: number, iterations?: number, l2?: number}} [opts]
 * @returns {{weights: number[], bias: number, mean: number[], std: number[], iterations: number, finalLogLoss: number}}
 */
function fitLogisticRegression(rows, labels, opts = {}) {
  const { learningRate = 0.1, iterations = 2000, l2 = 0.01 } = opts;
  const n = rows.length;
  const featureCount = n > 0 ? rows[0].length : 0;
  const { mean, std } = standardize(rows, featureCount);
  const standardized = rows.map((row) => applyStandardization(row, mean, std));

  let weights = new Array(featureCount).fill(0);
  let bias = 0;
  let finalLogLoss = null;

  for (let iter = 0; iter < iterations; iter += 1) {
    const gradW = new Array(featureCount).fill(0);
    let gradB = 0;
    let logLoss = 0;

    for (let i = 0; i < n; i += 1) {
      const row = standardized[i];
      let z = bias;
      for (let j = 0; j < featureCount; j += 1) z += weights[j] * row[j];
      const p = sigmoid(z);
      const error = p - labels[i];
      for (let j = 0; j < featureCount; j += 1) gradW[j] += error * row[j];
      gradB += error;
      const clamped = Math.min(Math.max(p, 1e-12), 1 - 1e-12);
      logLoss += -(labels[i] * Math.log(clamped) + (1 - labels[i]) * Math.log(1 - clamped));
    }

    for (let j = 0; j < featureCount; j += 1) {
      const reg = l2 * weights[j]; // no 1/n scaling needed - consistent with the gradient sum below
      weights[j] -= learningRate * (gradW[j] / n + reg);
    }
    bias -= learningRate * (gradB / n);

    finalLogLoss = logLoss / n + (l2 / 2) * weights.reduce((sum, w) => sum + w * w, 0);
  }

  return { weights, bias, mean, std, iterations, finalLogLoss };
}

/** Standardizes rawRow with the model's own mean/std - never mix scales between train and score. */
function predictProbability(model, rawRow) {
  const row = applyStandardization(rawRow, model.mean, model.std);
  let z = model.bias;
  for (let j = 0; j < model.weights.length; j += 1) z += model.weights[j] * row[j];
  return sigmoid(z);
}

/**
 * Per-feature contribution to the linear score (weight * standardized value),
 * sorted by |contribution| descending - the basis for a "top factors" answer.
 */
function featureContributions(model, rawRow) {
  const row = applyStandardization(rawRow, model.mean, model.std);
  const contributions = model.weights.map((weight, index) => ({ index, contribution: weight * row[index] }));
  return contributions.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

module.exports = {
  sigmoid,
  fitLogisticRegression,
  predictProbability,
  featureContributions,
};
