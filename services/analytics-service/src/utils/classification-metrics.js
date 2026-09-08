// Binary-classification evaluation metrics - pure functions, no DB access,
// same convention as forecast.js / logistic-regression.js. Used to evaluate
// the risk models in risk-model.js against a held-out test split.

/**
 * ROC AUC via the Mann-Whitney U rank-sum formula, with average ranks for
 * ties (so identical scores across the two classes correctly average to 0.5,
 * not overstate or understate separation).
 * @returns {number|null} null when a class is entirely absent (AUC undefined)
 */
function rocAuc(labels, scores) {
  const n = labels.length;
  const positives = labels.filter((l) => l === 1).length;
  const negatives = n - positives;
  if (positives === 0 || negatives === 0) return null;

  const indexed = scores.map((score, i) => ({ score, label: labels[i] }));
  indexed.sort((a, b) => a.score - b.score);

  let rankSum = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1].score === indexed[i].score) j += 1;
    const avgRank = (i + 1 + j + 1) / 2; // 1-indexed average rank across the tied block [i, j]
    for (let k = i; k <= j; k += 1) {
      if (indexed[k].label === 1) rankSum += avgRank;
    }
    i = j + 1;
  }

  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

function confusionAt(labels, scores, threshold) {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < labels.length; i += 1) {
    const predictedPositive = scores[i] >= threshold;
    if (predictedPositive && labels[i] === 1) tp += 1;
    else if (predictedPositive && labels[i] === 0) fp += 1;
    else if (!predictedPositive && labels[i] === 0) tn += 1;
    else fn += 1;
  }
  return { tp, fp, tn, fn };
}

function precisionRecallF1({ tp, fp, fn }) {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

/** Grid search over [step, 1-step, ...] for the threshold maximizing F1. */
function bestThresholdByF1(labels, scores, opts = {}) {
  const { step = 0.01 } = opts;
  let best = { threshold: 0.5, precision: 0, recall: 0, f1: 0 };
  for (let t = step; t < 1; t += step) {
    const metrics = precisionRecallF1(confusionAt(labels, scores, t));
    if (metrics.f1 > best.f1) best = { threshold: Number(t.toFixed(4)), ...metrics };
  }
  return best;
}

function brierScore(labels, scores) {
  const n = labels.length;
  if (!n) return null;
  const sumSquaredError = labels.reduce((sum, label, i) => sum + (scores[i] - label) ** 2, 0);
  return sumSquaredError / n;
}

/** Equal-width bins over [0,1]; each reports mean predicted vs. observed rate. */
function calibrationBins(labels, scores, binCount = 10) {
  const bins = Array.from({ length: binCount }, (_, i) => ({
    bin_lower: i / binCount, bin_upper: (i + 1) / binCount, count: 0, sumScore: 0, sumLabel: 0,
  }));
  for (let i = 0; i < scores.length; i += 1) {
    const idx = Math.min(binCount - 1, Math.floor(scores[i] * binCount));
    bins[idx].count += 1;
    bins[idx].sumScore += scores[i];
    bins[idx].sumLabel += labels[i];
  }
  return bins.map(({ bin_lower, bin_upper, count, sumScore, sumLabel }) => ({
    bin_lower, bin_upper, count,
    mean_predicted: count ? sumScore / count : null,
    observed_rate: count ? sumLabel / count : null,
  }));
}

/** Count-weighted mean |mean_predicted - observed_rate| over non-empty bins. */
function expectedCalibrationError(bins) {
  const total = bins.reduce((sum, b) => sum + b.count, 0);
  if (!total) return null;
  return bins.reduce((sum, b) => (b.count ? sum + (b.count / total) * Math.abs(b.mean_predicted - b.observed_rate) : sum), 0);
}

/**
 * Lift at a fixed selection budget k: among the top-k highest-scored items,
 * what fraction are actually positive, versus the population base rate.
 * This is what turns a risk score into an operational claim ("at a reminder
 * budget of k items, risk-ranking captures X% of eventual late returns").
 */
function liftAtK(labels, scores, k) {
  const n = labels.length;
  const effectiveK = Math.max(0, Math.min(k, n));
  const baseRate = n ? labels.reduce((sum, l) => sum + l, 0) / n : 0;
  if (effectiveK === 0 || n === 0) return { k: effectiveK, captured: 0, base_rate: baseRate, precision_at_k: 0, lift: null };

  const ranked = labels.map((label, i) => ({ label, score: scores[i] })).sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, effectiveK);
  const captured = top.reduce((sum, r) => sum + r.label, 0);
  const precisionAtK = captured / effectiveK;
  return { k: effectiveK, captured, base_rate: baseRate, precision_at_k: precisionAtK, lift: baseRate > 0 ? precisionAtK / baseRate : null };
}

/** One call, one report - everything a thesis table for a risk model needs. */
function classificationReport(labels, scores, opts = {}) {
  const { bins = 10, kValues = [50, 100, 200] } = opts;
  const auc = rocAuc(labels, scores);
  const bestThreshold = bestThresholdByF1(labels, scores);
  const calibration = calibrationBins(labels, scores, bins);
  const positives = labels.filter((l) => l === 1).length;
  return {
    samples: labels.length,
    positives,
    base_rate: labels.length ? positives / labels.length : null,
    auc,
    brier: brierScore(labels, scores),
    best_threshold: bestThreshold,
    calibration,
    ece: expectedCalibrationError(calibration),
    lift: kValues.map((k) => liftAtK(labels, scores, k)),
  };
}

module.exports = {
  rocAuc,
  confusionAt,
  precisionRecallF1,
  bestThresholdByF1,
  brierScore,
  calibrationBins,
  expectedCalibrationError,
  liftAtK,
  classificationReport,
};
