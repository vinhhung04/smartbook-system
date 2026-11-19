const test = require('node:test');
const assert = require('node:assert/strict');
test('PRA08: oldest pending age keeps increasing when a worker stops sweeping; no invented initial zero', () => {
  const callbacks = new Map();
  const p = require.resolve('@smartbook/shared/metrics');
  const previousModule = require.cache[p];
  const originalNow = Date.now;
  let now = 1000;
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { getMeter: () => ({ createObservableGauge: name => ({ addCallback: fn => callbacks.set(name, fn) }) }) } };
  try {
    Date.now = () => now;
    const { setReconciliationQueueState } = require('../src/lib/reconciliation-metrics');
    const observed = [];
    const read = () => callbacks.get('reconciliation_oldest_manual_seconds')({ observe: value => observed.push(value) });
    read(); assert.deepEqual(observed, []);
    setReconciliationQueueState({ automaticPending: 0, manualPending: 1, failed: 0, oldestAutomaticSeconds: 0, oldestManualSeconds: 120 });
    read(); assert.equal(observed.at(-1), 120);
    now += 5000;
    read(); assert.equal(observed.at(-1), 125);
  } finally { Date.now = originalNow; if (previousModule) require.cache[p] = previousModule; else delete require.cache[p]; }
});
