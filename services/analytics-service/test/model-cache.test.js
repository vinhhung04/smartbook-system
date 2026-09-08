const test = require('node:test');
const assert = require('node:assert/strict');
const { getOrTrain, clear } = require('../src/lib/model-cache');

test.beforeEach(() => clear());

test('concurrent callers for the same key trigger exactly one training run', async () => {
  let calls = 0;
  const trainFn = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { trained: true };
  };
  const results = await Promise.all([
    getOrTrain('late_return', trainFn),
    getOrTrain('late_return', trainFn),
    getOrTrain('late_return', trainFn),
  ]);
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r.trained === true));
});

test('different keys train independently', async () => {
  const seen = [];
  const trainFn = (key) => async () => { seen.push(key); return key; };
  await Promise.all([
    getOrTrain('late_return', trainFn('late_return')),
    getOrTrain('no_show', trainFn('no_show')),
  ]);
  assert.deepEqual(seen.sort(), ['late_return', 'no_show']);
});

test('a failed training run is not cached - the next call retries', async () => {
  let calls = 0;
  const trainFn = async () => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
    return { trained: true };
  };
  await assert.rejects(() => getOrTrain('late_return', trainFn));
  const result = await getOrTrain('late_return', trainFn);
  assert.equal(calls, 2);
  assert.equal(result.trained, true);
});
