const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLeadTimeHistory, deliveriesFromSeedSql, deliveriesFromTables } = require('../eval/lead-time-backtest');

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2025, 0, 1);
const iso = (ms) => new Date(ms).toISOString();

// Sequential orders 40 days apart: each delivery is received before the next
// order, so when predicting delivery k every earlier one is already known.
function sequential(leadTimes, { declared = 7, variant = 'v1', supplier = 's1' } = {}) {
  return leadTimes.map((lt, i) => ({
    variant_id: variant,
    supplier_id: supplier,
    order_date: iso(T0 + i * 40 * DAY_MS),
    received_at: iso(T0 + (i * 40 + lt) * DAY_MS),
    declared_lead_time_days: declared,
  }));
}

const method = (result, name) => result.methods.find((m) => m.method === name);

test('rolling protocol: delivery k is predicted from the median of deliveries 1..k-1 only', () => {
  // Lead times 10,12,14 | 11,13,20,9,15. Learned predictions for deliveries 4..8:
  //   median(10,12,14)=12, median(+11)=11.5->12, median(+13)=12,
  //   median(+20)=12.5->13, median(+9)=12  -> abs errors 1,1,8,4,3 -> MAE 3.4
  // Fixed 14 on the same deliveries: 3,1,6,5,1 -> 3.2. Declared 7: 4,6,13,2,8 -> 6.6
  const result = evaluateLeadTimeHistory(sequential([10, 12, 14, 11, 13, 20, 9, 15]));
  assert.equal(result.status, 'OK');
  assert.equal(result.paired_samples, 5);
  assert.equal(method(result, 'LEARNED_MEDIAN').paired.mae, 3.4);
  assert.equal(method(result, 'LEARNED_MEDIAN').paired.median_absolute_error, 3);
  assert.equal(method(result, 'FIXED_14_DAYS').paired.mae, 3.2);
  assert.equal(method(result, 'SUPPLIER_DECLARED').paired.mae, 6.6);
  assert.equal(method(result, 'LEARNED_MEDIAN').applicable.samples, 5); // first 3 cannot be learned
  assert.equal(method(result, 'FIXED_14_DAYS').applicable.samples, 8);
  // The production resolver falls back to the declared 7 days for the first 3.
  assert.equal(method(result, 'PRODUCTION_RESOLVER').applicable.samples, 8);
});

test('a delivery still in transit when the target was ordered is not used', () => {
  // Three deliveries all ordered on day 0 (none received yet when the 4th is
  // ordered on day 1) -> nothing to learn from for any of them.
  const deliveries = [10, 11, 12, 13].map((lt, i) => ({
    variant_id: 'v1', supplier_id: 's1', order_date: iso(T0 + (i === 3 ? 1 : 0) * DAY_MS), received_at: iso(T0 + lt * DAY_MS), declared_lead_time_days: 7,
  }));
  const result = evaluateLeadTimeHistory(deliveries, { minEvaluationSamples: 1 });
  assert.equal(result.paired_samples, 0);
  assert.equal(method(result, 'LEARNED_MEDIAN').applicable.samples, 0);
});

test('supplier-level history is used when the variant has fewer than 3 deliveries', () => {
  const other = sequential([20, 20, 20], { variant: 'v2' });
  const target = { variant_id: 'v1', supplier_id: 's1', order_date: iso(T0 + 200 * DAY_MS), received_at: iso(T0 + 222 * DAY_MS), declared_lead_time_days: 7 };
  const result = evaluateLeadTimeHistory([...other, target], { minEvaluationSamples: 1 });
  assert.equal(result.paired_samples, 1);
  assert.equal(method(result, 'LEARNED_MEDIAN').paired.mae, 2); // predicted 20, actual 22
});

test('too few observations -> INSUFFICIENT_DATA with no error metrics', () => {
  const result = evaluateLeadTimeHistory(sequential([10, 12, 14, 11]));
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(result.paired_samples, 1);
  for (const m of result.methods) {
    assert.equal(m.applicable.mae, null);
    if (m.paired) assert.equal(m.paired.mae, null);
  }
  assert.match(result.note, /withheld/);
});

test('empty history is INSUFFICIENT_DATA, not an error', () => {
  const result = evaluateLeadTimeHistory([]);
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(result.deliveries, 0);
});

test('delivery extraction mirrors getLeadTimeHistory: cancelled receipts dropped, one row per receipt+variant', () => {
  const deliveries = deliveriesFromTables({
    purchaseOrders: [{ id: 'po1', supplier_id: 's1', order_date: '2026-01-01' }],
    goodsReceipts: [
      { id: 'gr1', purchase_order_id: 'po1', received_at: '2026-01-10 10:00:00+07', cancelled_at: null },
      { id: 'gr2', purchase_order_id: 'po1', received_at: '2026-01-12 10:00:00+07', cancelled_at: '2026-01-13 10:00:00+07' },
    ],
    goodsReceiptItems: [
      { goods_receipt_id: 'gr1', variant_id: 'v1' },
      { goods_receipt_id: 'gr1', variant_id: 'v1' }, // second line of the same variant
      { goods_receipt_id: 'gr2', variant_id: 'v1' },
    ],
    supplierVariants: [
      { variant_id: 'v1', lead_time_days: '9', is_preferred: 'FALSE' },
      { variant_id: 'v1', lead_time_days: '5', is_preferred: 'TRUE' },
    ],
  });
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].declared_lead_time_days, 5); // preferred supplier first
});

test('the repository seed holds exactly the one purchase order it documents', () => {
  const deliveries = deliveriesFromSeedSql();
  assert.equal(deliveries.length, 2);
  assert.deepEqual(deliveries.map((d) => d.declared_lead_time_days).sort(), [5, 7]);
  const result = evaluateLeadTimeHistory(deliveries);
  assert.equal(result.status, 'INSUFFICIENT_DATA');
});
