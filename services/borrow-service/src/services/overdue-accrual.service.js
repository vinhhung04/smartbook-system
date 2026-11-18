const money = value => Math.round((Number(value) || 0) * 100) / 100;
const OPEN_STATUSES = new Set(['UNPAID', 'PARTIALLY_PAID']);
const { createNotificationRecord } = require('../lib/notifications');
const { writeAuditLog } = require('../lib/audit');

// Period boundaries are elapsed UTC overdue days: (from, through]. A settled
// period remains immutable; a changed daily rate always starts a new period.
function planOverdueAccrual({ episode, fines = [], overdueDays, dailyRate, dueDate }) {
  if (episode?.waived_future || overdueDays <= 0 || dailyRate <= 0) return null;
  const sameDue = value => !dueDate || !value || new Date(value).getTime() === new Date(dueDate).getTime();
  fines = fines.filter(row => sameDue(row.accrual_due_date));
  const baseline = sameDue(episode?.due_date) ? Number(episode?.baseline_days || 0) : 0;
  const covered = Math.max(baseline, ...fines.map(row => Number(row.accrual_through_days || 0)), 0);
  const newDays = Math.max(0, overdueDays - covered);
  if (!newDays) return null;
  const current = fines.find(row => OPEN_STATUSES.has(row.status)
    && Number(row.accrual_through_days) === covered
    && row.accrual_daily_rate != null && money(row.accrual_daily_rate) === money(dailyRate));
  const deltaAmount = money(newDays * dailyRate);
  return {
    targetFineId: current?.id || null,
    fromDays: current ? current.accrual_from_days : covered,
    throughDays: overdueDays,
    dailyRate: money(dailyRate),
    deltaAmount,
    amount: money((current ? Number(current.amount) : 0) + deltaAmount),
  };
}

async function accrueOverdueFine(tx, input) {
  const { customerId, loanItemId, overdueDays, dailyRate, actorUserId, note } = input;
  // upsertFine holds the episode advisory lock. Lock existing rows too so cash,
  // VNPay and deposit settlement cannot settle the stale amount we just read.
  await tx.$executeRaw`SELECT id FROM fines WHERE loan_item_id = ${loanItemId}::uuid AND fine_type = 'OVERDUE' ORDER BY id FOR UPDATE`;
  const fines = await tx.fines.findMany({ where: { loan_item_id: loanItemId, customer_id: customerId, fine_type: 'OVERDUE' } });
  const item = await tx.loan_items.findUnique({ where: { id: loanItemId }, select: { due_date: true } });
  const dueDate = item.due_date;
  // Legacy writers/imports can still supply amount-only fines after rollout.
  // Adopt them prospectively instead of inferring historical daily rates.
  const legacy = fines.filter(row => row.accrual_through_days == null);
  let episode = await tx.overdue_fine_episodes.upsert({
    where: { loan_item_id: loanItemId },
    create: { loan_item_id: loanItemId, baseline_days: legacy.length ? overdueDays : 0, due_date: dueDate }, update: {},
  });
  if (episode.due_date && new Date(episode.due_date).getTime() !== new Date(dueDate).getTime()) {
    episode = await tx.overdue_fine_episodes.update({ where: { loan_item_id: loanItemId }, data: { baseline_days: 0, due_date: dueDate } });
  }
  if (legacy.length) {
    await tx.fines.updateMany({ where: { id: { in: legacy.map(row => row.id) } }, data: { accrual_through_days: overdueDays, accrual_due_date: dueDate } });
    for (const row of legacy) { row.accrual_through_days = overdueDays; row.accrual_due_date = dueDate; }
  }
  const plan = planOverdueAccrual({ episode, fines, overdueDays, dailyRate, dueDate });
  if (!plan) return null;
  const period = { accrual_from_days: plan.fromDays, accrual_through_days: plan.throughDays, accrual_daily_rate: plan.dailyRate, accrual_due_date: dueDate };
  const fine = plan.targetFineId
    ? await tx.fines.update({ where: { id: plan.targetFineId }, data: { ...period, amount: plan.amount, note: note || undefined } })
    : await tx.fines.create({ data: {
    ...period, customer_id: customerId, loan_item_id: loanItemId, fine_type: 'OVERDUE',
    amount: plan.amount, status: 'UNPAID', issued_by_user_id: actorUserId || null,
    note: note || `Phạt quá hạn ngày ${plan.fromDays + 1}–${plan.throughDays}`,
    } });
  await writeAuditLog(tx, {
    actor_user_id: actorUserId || null, action_name: 'ACCRUE_OVERDUE_FINE', entity_type: 'FINE', entity_id: fine.id,
    after_data: { loan_item_id: loanItemId, period_from_days: plan.fromDays, period_through_days: plan.throughDays, daily_rate: plan.dailyRate, added_amount: plan.deltaAmount },
  });
  if (input.notifyAccrual) await createNotificationRecord(tx, {
    customer_id: customerId, channel: 'IN_APP', template_code: 'FINE_ACCRUED', subject: 'Phát sinh tiền phạt quá hạn',
    body: `Sách chưa trả phát sinh thêm ${plan.deltaAmount.toLocaleString('vi-VN')}đ tiền phạt quá hạn.`,
    reference_type: 'FINE', reference_id: fine.id,
    metadata: { loan_item_id: loanItemId, added_amount: plan.deltaAmount, period_from_days: plan.fromDays, period_through_days: plan.throughDays },
  });
  return fine;
}

async function previewOverdueAccrual(db, { loanItemId, overdueDays, dailyRate, fines, dueDate }) {
  let episode = await db.overdue_fine_episodes.findUnique({ where: { loan_item_id: loanItemId } });
  const rows = fines || await db.fines.findMany({ where: { loan_item_id: loanItemId, fine_type: 'OVERDUE' }, include: { fine_payments: true } });
  const overdue = rows.filter(row => row.fine_type === 'OVERDUE');
  if (overdue.some(row => row.accrual_through_days == null)) {
    // Match the prospective adoption performed by accrueOverdueFine, without
    // writing financial state merely to show a preview.
    episode = { ...episode, baseline_days: Math.max(Number(episode?.baseline_days || 0), overdueDays), due_date: dueDate };
  }
  const plan = planOverdueAccrual({ episode, fines: overdue, overdueDays, dailyRate, dueDate });
  const projected = overdue.map(row => plan?.targetFineId === row.id ? { ...row, amount: plan.amount } : row);
  if (plan && !plan.targetFineId) projected.push({ amount: plan.amount, waived_amount: 0, status: 'UNPAID', fine_payments: [], projected: true });
  return projected.filter(row => OPEN_STATUSES.has(row.status)).map(row => ({
    fine_type: 'OVERDUE',
    amount: Math.max(0, money(Number(row.amount) - Number(row.waived_amount || 0) - (row.fine_payments || []).reduce((sum, p) => sum + Number(p.amount), 0))),
    source: row.projected ? 'NEW' : plan?.targetFineId === row.id ? 'UPDATED' : 'EXISTING',
  })).filter(row => row.amount > 0);
}

module.exports = { planOverdueAccrual, accrueOverdueFine, previewOverdueAccrual };
