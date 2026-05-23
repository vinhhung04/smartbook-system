const { createNotificationRecord } = require('../lib/notifications');
const { writeAuditLog } = require('../lib/audit');

function normalizeMoney(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

function toStartOfUtcDay(dateInput = new Date()) {
  const date = new Date(dateInput);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysOverdue(dueDate, now = new Date()) {
  const due = toStartOfUtcDay(dueDate);
  const current = toStartOfUtcDay(now);
  const ms = current.getTime() - due.getTime();
  if (ms <= 0) return 0;
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

async function upsertFine(tx, input) {
  const {
    customerId,
    loanItemId,
    fineType,
    amount,
    actorUserId = null,
    note = null,
  } = input;

  const finalAmount = normalizeMoney(amount);
  if (finalAmount <= 0) {
    return null;
  }

  const existing = await tx.fines.findFirst({
    where: {
      customer_id: customerId,
      loan_item_id: loanItemId,
      fine_type: fineType,
      status: { in: ['UNPAID', 'PARTIALLY_PAID'] },
    },
    orderBy: [{ issued_at: 'desc' }],
  });

  if (existing) {
    if (normalizeMoney(existing.amount) === finalAmount) {
      return existing;
    }

    return tx.fines.update({
      where: { id: existing.id },
      data: {
        amount: finalAmount,
        note: note || existing.note,
      },
    });
  }

  return tx.fines.create({
    data: {
      customer_id: customerId,
      loan_item_id: loanItemId,
      fine_type: fineType,
      amount: finalAmount,
      status: 'UNPAID',
      issued_by_user_id: actorUserId,
      note,
    },
  });
}

async function recomputeCustomerFineBalance(tx, customerId) {
  const fines = await tx.fines.findMany({
    where: { customer_id: customerId },
    include: { fine_payments: true },
  });

  const total = fines.reduce((sum, fine) => {
    if (fine.status === 'PAID' || fine.status === 'WAIVED') {
      return sum;
    }

    const paid = fine.fine_payments.reduce((acc, payment) => acc + normalizeMoney(payment.amount), 0);
    const remaining = Math.max(0, normalizeMoney(fine.amount) - normalizeMoney(fine.waived_amount) - paid);
    return sum + remaining;
  }, 0);

  await tx.customers.update({
    where: { id: customerId },
    data: { total_fine_balance: normalizeMoney(total) },
  });

  return normalizeMoney(total);
}

async function applyReturnFines(tx, input) {
  const {
    customerId,
    loan,
    items,
    returnedAt,
    actorUserId = null,
    membershipLimits,
    markLost = false,
    itemConditionOnReturn = 'GOOD',
  } = input;

  const finePerDay = normalizeMoney(membershipLimits?.fine_per_day || 0);
  const lostMultiplier = Number(membershipLimits?.lost_item_fee_multiplier || 1);
  const baseLostFee = normalizeMoney(process.env.LOST_ITEM_BASE_FEE || 100000);
  const baseDamageFee = normalizeMoney(process.env.DAMAGED_ITEM_FEE || 50000);

  const createdOrUpdated = [];

  for (const item of items) {
    const overdueDays = daysOverdue(item.due_date, returnedAt);
    if (overdueDays > 0 && finePerDay > 0) {
      const overdueFine = await upsertFine(tx, {
        customerId,
        loanItemId: item.id,
        fineType: 'OVERDUE',
        amount: overdueDays * finePerDay,
        actorUserId,
        note: `Auto overdue fine for ${overdueDays} day(s)`,
      });
      if (overdueFine) {
        createdOrUpdated.push(overdueFine);
      }
    }

    if (markLost) {
      const lostFine = await upsertFine(tx, {
        customerId,
        loanItemId: item.id,
        fineType: 'LOST',
        amount: normalizeMoney(baseLostFee * Math.max(1, lostMultiplier)),
        actorUserId,
        note: 'Lost item fine generated on return processing',
      });
      if (lostFine) {
        createdOrUpdated.push(lostFine);
      }
      continue;
    }

    if (itemConditionOnReturn === 'DAMAGED' || itemConditionOnReturn === 'POOR') {
      const damageFine = await upsertFine(tx, {
        customerId,
        loanItemId: item.id,
        fineType: 'DAMAGE',
        amount: baseDamageFee,
        actorUserId,
        note: `Damage fine generated for condition ${itemConditionOnReturn}`,
      });
      if (damageFine) {
        createdOrUpdated.push(damageFine);
      }
    }
  }

  if (createdOrUpdated.length > 0) {
    await createNotificationRecord(tx, {
      customer_id: customerId,
      channel: 'IN_APP',
      template_code: 'FINE_CREATED',
      subject: 'New fine generated',
      body: `Loan ${loan.loan_number} generated ${createdOrUpdated.length} fine record(s).`,
      reference_type: 'LOAN_TRANSACTION',
      reference_id: loan.id,
      metadata: {
        loan_id: loan.id,
        loan_number: loan.loan_number,
        fine_ids: createdOrUpdated.map((row) => row.id),
      },
    });

    await writeAuditLog(tx, {
      actor_user_id: actorUserId,
      action_name: 'GENERATE_RETURN_FINES',
      entity_type: 'LOAN_TRANSACTION',
      entity_id: loan.id,
      before_data: { loan_status: loan.status },
      after_data: {
        generated_fine_count: createdOrUpdated.length,
        fine_ids: createdOrUpdated.map((row) => row.id),
      },
    });
  }

  const totalFineBalance = await recomputeCustomerFineBalance(tx, customerId);

  return {
    fines: createdOrUpdated,
    totalFineBalance,
  };
}

async function runOverdueSweep(prisma, options = {}) {
  const now = options.now || new Date();
  const limit = Number(options.limit || 200);

  const overdueItems = await prisma.loan_items.findMany({
    where: {
      status: 'BORROWED',
      return_date: null,
      due_date: { lt: now },
    },
    take: limit,
    include: {
      loan_transactions: {
        include: {
          customers: true,
        },
      },
    },
    orderBy: [{ due_date: 'asc' }],
  });

  let processedItems = 0;
  let generatedFines = 0;

  for (const item of overdueItems) {
    const loan = item.loan_transactions;
    if (!loan) {
      continue;
    }

    const membership = await prisma.customer_memberships.findFirst({
      where: {
        customer_id: loan.customer_id,
        status: 'ACTIVE',
      },
      include: {
        membership_plans: true,
      },
      orderBy: [{ start_date: 'desc' }, { created_at: 'desc' }],
    });

    const finePerDay = normalizeMoney(membership?.membership_plans?.fine_per_day || process.env.DEFAULT_FINE_PER_DAY || 0);
    const overdueDayCount = daysOverdue(item.due_date, now);
    const amount = normalizeMoney(overdueDayCount * finePerDay);

    await prisma.$transaction(async (tx) => {
      await tx.loan_items.update({
        where: { id: item.id },
        data: { status: 'OVERDUE' },
      });

      if (loan.status === 'BORROWED') {
        await tx.loan_transactions.update({
          where: { id: loan.id },
          data: { status: 'OVERDUE' },
        });
      }

      if (amount > 0) {
        const fine = await upsertFine(tx, {
          customerId: loan.customer_id,
          loanItemId: item.id,
          fineType: 'OVERDUE',
          amount,
          actorUserId: null,
          note: `Scheduled overdue fine for ${overdueDayCount} day(s)`,
        });

        if (fine) {
          generatedFines += 1;
        }
      }

      await createNotificationRecord(tx, {
        customer_id: loan.customer_id,
        channel: 'IN_APP',
        template_code: 'LOAN_OVERDUE',
        subject: 'Loan item overdue',
        body: `Loan ${loan.loan_number} has overdue item(s). Please return as soon as possible.`,
        reference_type: 'LOAN_TRANSACTION',
        reference_id: loan.id,
        metadata: {
          loan_id: loan.id,
          loan_number: loan.loan_number,
          loan_item_id: item.id,
          overdue_days: overdueDayCount,
          overdue_fine_amount: amount,
        },
      });

      await writeAuditLog(tx, {
        actor_user_id: null,
        action_name: 'MARK_ITEM_OVERDUE',
        entity_type: 'LOAN_ITEM',
        entity_id: item.id,
        before_data: { status: item.status },
        after_data: {
          status: 'OVERDUE',
          overdue_days: overdueDayCount,
          overdue_fine_amount: amount,
        },
      });

      await recomputeCustomerFineBalance(tx, loan.customer_id);
    });

    processedItems += 1;
  }

  return {
    scanned: overdueItems.length,
    processed_items: processedItems,
    generated_fines: generatedFines,
  };
}

module.exports = {
  normalizeMoney,
  daysOverdue,
  upsertFine,
  recomputeCustomerFineBalance,
  applyReturnFines,
  runOverdueSweep,
};
