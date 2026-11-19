const { getMeter } = require('@smartbook/shared/metrics');
const meter = getMeter('borrow-service');
let state = null;
let sampledAt = 0;
for (const [metric, key] of [
  ['reconciliation_automatic_pending_total', 'automaticPending'],
  ['reconciliation_manual_pending_total', 'manualPending'],
  ['reconciliation_failed_total', 'failed'],
  ['reconciliation_oldest_automatic_seconds', 'oldestAutomaticSeconds'],
  ['reconciliation_oldest_manual_seconds', 'oldestManualSeconds'],
]) {
  meter.createObservableGauge(metric).addCallback(result => {
    // Absence before a successful query is unknown, not an invented zero.
    if (state) {
      const count = key === 'oldestAutomaticSeconds' ? state.automaticPending
        : key === 'oldestManualSeconds' ? state.manualPending : 0;
      result.observe(state[key] + (count > 0 ? Math.max(0, Date.now() - sampledAt) / 1000 : 0));
    }
  });
}
meter.createObservableGauge('reconciliation_last_success_unixtime').addCallback(result => {
  if (state) result.observe(sampledAt / 1000);
});
function setReconciliationQueueState(value) { state = value; sampledAt = Date.now(); }
module.exports = { setReconciliationQueueState };
