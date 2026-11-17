const test = require('node:test');
const assert = require('node:assert/strict');
const { toMoney } = require('../src/services/account.service');
const { splitDeposit, settlementNeedsReason, getDepositPerItem } = require('../src/services/deposit.service');
const { computeReturnFineAmounts, daysOverdue } = require('../src/services/fine.service');

for (const [deposit, fine, captured, refund, due] of [
  [0, 0, '0.00', '0.00', '0.00'],
  [30000, 0, '0.00', '30000.00', '0.00'],
  [30000, 10000, '10000.00', '20000.00', '0.00'],
  [30000, 30000, '30000.00', '0.00', '0.00'],
  [30000, 50000, '30000.00', '0.00', '20000.00'],
  ['10.005', '3.005', '3.01', '7.00', '0.00'],
]) {
  test(`deposit ${deposit}, fine ${fine}: exact per-item capture/refund/additional due`, () => {
    const result = splitDeposit(deposit, fine);
    assert.deepEqual(Object.values(result).map(v => v.toFixed(2)), [captured, refund, due]);
    assert.equal(result.captured.add(result.refunded).eq(toMoney(deposit)), true);
    assert.equal(result.captured.add(result.additionalDue).eq(toMoney(fine)), true);
  });
}
for (const value of [NaN, Infinity, -Infinity, 'not-money']) {
  test(`wallet rejects non-numeric money ${value}`, () => assert.throws(() => toMoney(value)));
}
test('money uses half-up decimal rounding without binary float addition', () => {
  assert.equal(toMoney('1.005').toFixed(2), '1.01');
  assert.equal(toMoney('0.1').add(toMoney('0.2')).toFixed(2), '0.30');
});
test('deposit policy defaults to zero and never holds a negative configured deposit', () => {
  for (const limits of [undefined, {}, { deposit_per_item: -5 }]) assert.equal(getDepositPerItem(limits).toNumber(), 0);
  assert.equal(getDepositPerItem({ deposit_per_item: '20000.005' }).toFixed(2), '20000.01');
});
test('damage, poor condition and loss require a written settlement reason', () => {
  for (const itemConditionOnReturn of ['DAMAGED', 'poor', 'LOST']) assert.equal(settlementNeedsReason({ itemConditionOnReturn }), true);
  assert.equal(settlementNeedsReason({ markLost: true }), true);
  assert.equal(settlementNeedsReason({ itemConditionOnReturn: 'GOOD' }), false);
});
test('overdue policy uses UTC calendar days, clamps early returns, and keeps item due dates independent', () => {
  const returnedAt = new Date('2026-01-12T00:01:00Z');
  assert.equal(daysOverdue('2026-01-12T23:00:00Z', returnedAt), 0);
  assert.equal(daysOverdue('2026-01-10T23:59:00Z', returnedAt), 2);
  const fees = ['2026-01-10', '2026-01-11', '2026-01-13'].map(due_date => computeReturnFineAmounts({
    item: { due_date }, returnedAt, membershipLimits: { fine_per_day: 2500 },
  }).reduce((sum, charge) => sum + charge.amount, 0));
  assert.deepEqual(fees, [5000, 2500, 0]);
});
test('lost items replace damage charges but retain the independently calculated overdue fine', () => {
  const oldLost = process.env.LOST_ITEM_BASE_FEE;
  const oldDamage = process.env.DAMAGED_ITEM_FEE;
  process.env.LOST_ITEM_BASE_FEE = '100000'; process.env.DAMAGED_ITEM_FEE = '50000';
  try {
    const input = { item: { due_date: '2026-01-01' }, returnedAt: new Date('2026-01-03'), membershipLimits: { fine_per_day: 2000, lost_item_fee_multiplier: 1.5 }, itemConditionOnReturn: 'DAMAGED' };
    assert.deepEqual(computeReturnFineAmounts(input).map(c => [c.fineType, c.amount]), [['OVERDUE', 4000], ['DAMAGE', 50000]]);
    assert.deepEqual(computeReturnFineAmounts({ ...input, markLost: true }).map(c => [c.fineType, c.amount]), [['OVERDUE', 4000], ['LOST', 150000]]);
  } finally {
    if (oldLost === undefined) delete process.env.LOST_ITEM_BASE_FEE; else process.env.LOST_ITEM_BASE_FEE = oldLost;
    if (oldDamage === undefined) delete process.env.DAMAGED_ITEM_FEE; else process.env.DAMAGED_ITEM_FEE = oldDamage;
  }
});
