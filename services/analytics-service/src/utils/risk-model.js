// Trains and evaluates a risk model over a list of {features, label, at}
// samples (from risk-features.js). Pure - no DB access - so the whole
// train/evaluate/leakage story is testable without a database (see
// risk-model.test.js, in particular the label-shuffle leakage guard).

const { fitLogisticRegression, predictProbability, featureContributions } = require('./logistic-regression');
const { classificationReport } = require('./classification-metrics');

/**
 * Sorts samples by `at` ascending and splits off the last `testFraction` as
 * the held-out test set - a temporal split, not a random one, so the model
 * is never evaluated on data that is chronologically "before" something it
 * trained on.
 */
function temporalSplit(samples, opts = {}) {
  const { testFraction = 0.25 } = opts;
  const sorted = [...samples].sort((a, b) => a.at.getTime() - b.at.getTime());
  const testSize = Math.round(sorted.length * testFraction);
  const splitIndex = sorted.length - testSize;
  const train = sorted.slice(0, splitIndex);
  const test = sorted.slice(splitIndex);
  return { train, test, splitAt: test.length ? test[0].at : null };
}

/**
 * @param {Array<{features: number[], label: 0|1, at: Date}>} samples - labelled only (caller filters out null labels)
 * @param {{featureNames: string[], testFraction?: number, minSamples?: number, minPositives?: number}} opts
 */
function trainAndEvaluate(samples, opts) {
  const { featureNames, testFraction = 0.25, minSamples = 200, minPositives = 20, ...fitOpts } = opts;

  if (samples.length < minSamples) {
    return { status: 'INSUFFICIENT_DATA', reason: `need at least ${minSamples} labelled samples, have ${samples.length}` };
  }
  const positiveCount = samples.filter((s) => s.label === 1).length;
  if (positiveCount < minPositives || positiveCount === samples.length) {
    return { status: 'INSUFFICIENT_DATA', reason: `need at least ${minPositives} positive examples and at least one negative, have ${positiveCount}/${samples.length}` };
  }

  const { train, test, splitAt } = temporalSplit(samples, { testFraction });
  if (train.length < minSamples * (1 - testFraction) || test.length === 0) {
    return { status: 'INSUFFICIENT_DATA', reason: 'temporal split left too few train or test rows' };
  }
  const trainLabels = train.map((s) => s.label);
  if (new Set(trainLabels).size < 2) {
    return { status: 'INSUFFICIENT_DATA', reason: 'training split has only one class' };
  }

  const rawModel = fitLogisticRegression(train.map((s) => s.features), trainLabels, fitOpts);
  const model = { ...rawModel, feature_names: featureNames };

  const testLabels = test.map((s) => s.label);
  const testScores = test.map((s) => predictProbability(model, s.features));
  const evaluation = classificationReport(testLabels, testScores);

  return { status: 'OK', model, evaluation, trainSize: train.length, testSize: test.length, splitAt };
}

/** Scores rows already converted via toSample, attaching risk_score and top_factors. */
function scoreRows(model, rows, toSample) {
  return rows.map((row) => {
    const sample = toSample(row);
    if (!sample) return null;
    const riskScore = predictProbability(model, sample.features);
    const topFactors = featureContributions(model, sample.features).slice(0, 3).map(({ index, contribution }) => ({
      feature: model.feature_names[index],
      contribution: Number(contribution.toFixed(4)),
      direction: contribution >= 0 ? 'increases_risk' : 'decreases_risk',
    }));
    return { ...row, risk_score: Number(riskScore.toFixed(4)), top_factors: topFactors };
  }).filter(Boolean);
}

module.exports = {
  temporalSplit,
  trainAndEvaluate,
  scoreRows,
};
