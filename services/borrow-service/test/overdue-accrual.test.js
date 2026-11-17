const test = require('node:test');
const assert = require('node:assert/strict');
const { planOverdueAccrual } = require('../src/services/overdue-accrual.service');

const fine = (extra = {}) => ({ id: 'fine', amount: 50000, status: 'PAID', accrual_from_days: 0, accrual_through_days: 10, accrual_daily_rate: 5000, ...extra });
test('SB03: payment preserves settled history and charges only later overdue days', () => {
  const settled = fine();
  const plan = planOverdueAccrual({ fines: [settled], overdueDays: 20, dailyRate: 5000 });
  assert.equal(plan.amount, 50000);
  assert.equal(plan.fromDays, 10);
  assert.equal(plan.throughDays, 20);
  assert.equal(plan.targetFineId, null);
  assert.equal(settled.amount, 50000);
});
test('SB03: ordinary waiver permits future days, whole-episode waiver does not', () => {
  assert.equal(planOverdueAccrual({ fines: [fine({ status: 'WAIVED' })], overdueDays: 12, dailyRate: 5000 }).amount, 10000);
  assert.equal(planOverdueAccrual({ episode: { waived_future: true }, fines: [fine({ status: 'WAIVED' })], overdueDays: 12, dailyRate: 5000 }), null);
});
test('SB03: replay never bills the same overdue day twice', () => {
  assert.equal(planOverdueAccrual({ fines: [fine()], overdueDays: 10, dailyRate: 5000 }), null);
});
test('SB03: open current-rate period extends only by newly elapsed days', () => {
  const plan = planOverdueAccrual({ fines: [fine({ status: 'PARTIALLY_PAID' })], overdueDays: 12, dailyRate: 5000 });
  assert.equal(plan.amount, 60000);
  assert.equal(plan.targetFineId, 'fine');
  assert.equal(plan.deltaAmount, 10000);
});
test('SB03: a changed rate starts a new period without repricing old days', () => {
  const plan = planOverdueAccrual({ fines: [fine({ status: 'UNPAID' })], overdueDays: 12, dailyRate: 7000 });
  assert.equal(plan.amount, 14000);
  assert.equal(plan.targetFineId, null);
});
test('SB03: migration baseline never backbills historical settled episodes', () => {
  const episode = { baseline_days: 30 };
  assert.equal(planOverdueAccrual({ episode, fines: [fine()], overdueDays: 30, dailyRate: 5000 }), null);
  assert.equal(planOverdueAccrual({ episode, fines: [fine()], overdueDays: 31, dailyRate: 5000 }).amount, 5000);
});
test('SB03: renewal starts a new day basis without hiding fines after the new deadline', () => {
  const oldDue = new Date('2026-10-01Z'); const newDue = new Date('2026-11-01Z');
  const plan = planOverdueAccrual({ episode: { baseline_days: 30, due_date: oldDue }, fines: [fine({ accrual_due_date: oldDue })], dueDate: newDue, overdueDays: 2, dailyRate: 5000 });
  assert.equal(plan.amount, 10000); assert.equal(plan.fromDays, 0);
});
