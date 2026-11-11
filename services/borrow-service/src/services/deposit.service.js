const { Prisma } = require('@prisma/client');
const { writeAuditLog } = require('../lib/audit');
const { toMoney, holdFunds, releaseHeldFunds, captureHeldFunds } = require('./account.service');
const { computeReturnFineAmounts } = require('./fine.service');

// Per-book deposits. A deposit is held from the wallet's available balance when a
// book is lent, and settled exactly once when it comes back (or is declared
// lost): it first pays that book's open fines, the rest goes back to the
// customer. Fines larger than the deposit stay open for the difference and are
// paid like any other fine (VNPay or at the counter).

const Decimal = Prisma.Decimal;
const ZERO = new Decimal(0);

// Returns that need a written reason before a deposit can be used to pay for them.
const REASON_REQUIRED_CONDITIONS = new Set(['DAMAGED', 'POOR', 'LOST']);

function getDepositPerItem(membershipLimits) {
  const amount = toMoney(membershipLimits?.deposit_per_item || 0);
  return amount.gt(0) ? amount : ZERO;
}

function settlementNeedsReason({ markLost = false, itemConditionOnReturn = 'GOOD' } = {}) {
  return markLost || REASON_REQUIRED_CONDITIONS.has(String(itemConditionOnReturn || 'GOOD').trim().toUpperCase());
}

function fineRemaining(fine) {
  const paid = (fine.fine_payments || []).reduce((sum, row) => sum.add(toMoney(row.amount)), ZERO);
  const remaining = toMoney(fine.amount).sub(toMoney(fine.waived_amount)).sub(paid);
  return remaining.gt(0) ? remaining : ZERO;
}

/** Refund = max(deposit − penalty, 0); additional due = max(penalty − deposit, 0). */
function splitDeposit(depositAmount, penalty) {
  const deposit = toMoney(depositAmount);
  const owed = toMoney(penalty);
  const captured = Decimal.min(deposit, owed);
  return {
    captured,
    refunded: deposit.sub(captured),
    additionalDue: owed.sub(captured),
  };
}

function settledStatus(captured, refunded) {
  if (captured.eq(0)) return 'RELEASED';
  if (refunded.eq(0)) return 'CAPTURED';
  return 'PARTIALLY_REFUNDED';
}

/**
 * Holds `amountPerItem` for every new loan item, inside the loan-creation
 * transaction. Throws AccountError INSUFFICIENT_FUNDS (and so rolls the loan
 * back) when the wallet cannot cover all of them.
 */
async function holdLoanItemDeposits(tx, { customerId, loanId, loanNumber, items, amountPerItem, actorUserId = null }) {
  const amount = toMoney(amountPerItem || 0);
  if (amount.lte(0) || !items || items.length === 0) return [];

  const deposits = [];
  for (const item of items) {
    // One deposit per loan item: a repeated call returns the existing one.
    const existing = await tx.loan_item_deposits.findUnique({ where: { loan_item_id: item.id } });
    if (existing) {
      deposits.push(existing);
      continue;
    }

    const hold = await holdFunds(tx, {
      customerId,
      actorUserId,
      amount,
      idempotencyKey: `deposit-hold:${item.id}`,
      referenceType: 'LOAN_ITEM_DEPOSIT',
      referenceId: item.id,
      note: `Giữ tiền cọc sách ${item.item_barcode || item.id} (phiếu ${loanNumber})`,
      metadata: { loan_id: loanId, loan_number: loanNumber, loan_item_id: item.id, variant_id: item.variant_id },
    });

    deposits.push(await tx.loan_item_deposits.create({
      data: {
        customer_id: customerId,
        account_id: hold.account.id,
        loan_id: loanId,
        loan_item_id: item.id,
        variant_id: item.variant_id,
        inventory_unit_id: item.inventory_unit_id || null,
        amount: amount.toFixed(2),
        status: 'HELD',
        held_by_user_id: actorUserId,
      },
    }));
  }

  await writeAuditLog(tx, {
    actor_user_id: actorUserId,
    action_name: 'HOLD_LOAN_DEPOSITS',
    entity_type: 'LOAN_TRANSACTION',
    entity_id: loanId,
    after_data: {
      deposit_ids: deposits.map((row) => row.id),
      deposit_per_item: amount.toNumber(),
      deposit_total: amount.mul(deposits.length).toNumber(),
    },
  });

  return deposits;
}

/**
 * Settles one HELD deposit after the return's fines have been written. Locks the
 * deposit, then the book's open fines, then (inside capture/release) the wallet —
 * always in that order, so it cannot deadlock with fine payments or wallet writes.
 * A deposit that is no longer HELD is left alone: settling twice is a no-op.
 */
async function settleLoanItemDeposit(tx, { depositId, actorUserId = null, returnCondition = null, reason = null }) {
  const lockedRows = await tx.$queryRaw`SELECT * FROM loan_item_deposits WHERE id = ${depositId}::uuid FOR UPDATE`;
  const deposit = lockedRows[0];
  if (!deposit || deposit.status !== 'HELD') {
    return { skipped: true, deposit_id: depositId, status: deposit?.status || null };
  }

  const openFineIds = await tx.$queryRaw`
    SELECT id FROM fines
     WHERE loan_item_id = ${deposit.loan_item_id}::uuid AND status NOT IN ('PAID', 'WAIVED')
     ORDER BY issued_at ASC, id ASC
       FOR UPDATE`;
  const fines = openFineIds.length === 0 ? [] : await tx.fines.findMany({
    where: { id: { in: openFineIds.map((row) => row.id) } },
    include: { fine_payments: true },
    orderBy: [{ issued_at: 'asc' }, { id: 'asc' }],
  });

  const penalty = fines.reduce((sum, fine) => sum.add(fineRemaining(fine)), ZERO);
  const { captured, refunded, additionalDue } = splitDeposit(deposit.amount, penalty);

  // Pay the book's fines from the deposit, oldest first.
  const allocations = [];
  let left = captured;
  for (const fine of fines) {
    if (left.lte(0)) break;
    const remaining = fineRemaining(fine);
    if (remaining.lte(0)) continue;
    const pay = Decimal.min(remaining, left);
    const payment = await tx.fine_payments.create({
      data: {
        fine_id: fine.id,
        payment_method: 'DEPOSIT',
        amount: pay.toFixed(2),
        transaction_reference: deposit.id,
        paid_by_user_id: actorUserId,
        note: `Khấu trừ từ tiền cọc ${deposit.id}`,
      },
    });
    const stillRemaining = remaining.sub(pay);
    await tx.fines.update({
      where: { id: fine.id },
      data: {
        status: stillRemaining.lte(0) ? 'PAID' : 'PARTIALLY_PAID',
        paid_at: stillRemaining.lte(0) ? new Date() : null,
      },
    });
    allocations.push({ fine_id: fine.id, fine_type: fine.fine_type, payment_id: payment.id, amount: pay.toNumber(), remaining_after: stillRemaining.toNumber() });
    left = left.sub(pay);
  }

  const ledgerMetadata = { loan_id: deposit.loan_id, loan_item_id: deposit.loan_item_id, deposit_id: deposit.id };
  let captureEntry = null;
  let releaseEntry = null;
  if (captured.gt(0)) {
    captureEntry = (await captureHeldFunds(tx, {
      customerId: deposit.customer_id,
      actorUserId,
      amount: captured,
      idempotencyKey: `deposit-capture:${deposit.id}`,
      referenceType: 'LOAN_ITEM_DEPOSIT',
      referenceId: deposit.loan_item_id,
      note: 'Khấu trừ tiền cọc để thanh toán tiền phạt',
      metadata: { ...ledgerMetadata, fine_allocations: allocations },
    })).entry;
  }
  if (refunded.gt(0)) {
    releaseEntry = (await releaseHeldFunds(tx, {
      customerId: deposit.customer_id,
      actorUserId,
      amount: refunded,
      idempotencyKey: `deposit-release:${deposit.id}`,
      referenceType: 'LOAN_ITEM_DEPOSIT',
      referenceId: deposit.loan_item_id,
      note: captured.gt(0) ? 'Hoàn phần tiền cọc còn lại' : 'Hoàn tiền cọc',
      metadata: ledgerMetadata,
    })).entry;
  }

  const status = settledStatus(captured, refunded);
  const settled = await tx.loan_item_deposits.update({
    where: { id: deposit.id },
    data: {
      status,
      captured_amount: captured.toFixed(2),
      refunded_amount: refunded.toFixed(2),
      return_condition: returnCondition,
      settlement_reason: reason ? String(reason).slice(0, 1000) : null,
      settled_by_user_id: actorUserId,
      settled_at: new Date(),
      updated_at: new Date(),
    },
  });

  await writeAuditLog(tx, {
    actor_user_id: actorUserId,
    action_name: 'SETTLE_LOAN_DEPOSIT',
    entity_type: 'LOAN_ITEM',
    entity_id: deposit.loan_item_id,
    before_data: { deposit_id: deposit.id, status: deposit.status, amount: toMoney(deposit.amount).toNumber() },
    after_data: {
      status,
      return_condition: returnCondition,
      reason: reason || null,
      penalty: penalty.toNumber(),
      captured_amount: captured.toNumber(),
      refunded_amount: refunded.toNumber(),
      additional_due: additionalDue.toNumber(),
      fine_allocations: allocations,
      capture_ledger_entry_id: captureEntry?.id || null,
      release_ledger_entry_id: releaseEntry?.id || null,
    },
  });

  return {
    skipped: false,
    deposit_id: deposit.id,
    loan_item_id: deposit.loan_item_id,
    status,
    deposit_amount: toMoney(deposit.amount).toNumber(),
    penalty: penalty.toNumber(),
    captured_amount: captured.toNumber(),
    refunded_amount: refunded.toNumber(),
    additional_due: additionalDue.toNumber(),
    fine_allocations: allocations,
    deposit: settled,
  };
}

async function settleLoanItemDeposits(tx, { loanItemIds, actorUserId = null, returnCondition = null, reason = null }) {
  if (!loanItemIds || loanItemIds.length === 0) return [];
  const deposits = await tx.loan_item_deposits.findMany({
    where: { loan_item_id: { in: loanItemIds }, status: 'HELD' },
    orderBy: [{ id: 'asc' }],
    select: { id: true },
  });
  const results = [];
  for (const row of deposits) {
    results.push(await settleLoanItemDeposit(tx, { depositId: row.id, actorUserId, returnCondition, reason }));
  }
  return results.filter((row) => !row.skipped);
}

/**
 * What returning `items` now would charge and refund, without writing anything.
 * Mirrors applyReturnFines + upsertFine (the newest fine per type gets the new
 * amount unless it is already PAID/WAIVED) and then settleLoanItemDeposit.
 */
async function previewReturnSettlement(db, { items, returnedAt = new Date(), membershipLimits, markLost = false, itemConditionOnReturn = 'GOOD' }) {
  const itemIds = items.map((item) => item.id);
  const [existingFines, deposits] = await Promise.all([
    db.fines.findMany({ where: { loan_item_id: { in: itemIds } }, include: { fine_payments: true }, orderBy: [{ issued_at: 'desc' }] }),
    db.loan_item_deposits.findMany({ where: { loan_item_id: { in: itemIds } } }),
  ]);
  const depositByItem = new Map(deposits.map((row) => [row.loan_item_id, row]));

  const rows = items.map((item) => {
    const itemFines = existingFines.filter((fine) => fine.loan_item_id === item.id);
    const charges = computeReturnFineAmounts({ item, returnedAt, membershipLimits, markLost, itemConditionOnReturn });
    const chargedTypes = new Set(charges.map((charge) => charge.fineType));
    const lines = [];

    for (const charge of charges) {
      const existing = itemFines.find((fine) => fine.fine_type === charge.fineType);
      if (existing && (existing.status === 'PAID' || existing.status === 'WAIVED')) continue;
      const due = existing
        ? fineRemaining({ ...existing, amount: charge.amount })
        : toMoney(charge.amount);
      if (due.gt(0)) lines.push({ fine_type: charge.fineType, amount: due.toNumber(), source: existing ? 'UPDATED' : 'NEW' });
    }
    for (const fine of itemFines) {
      if (chargedTypes.has(fine.fine_type) || fine.status === 'PAID' || fine.status === 'WAIVED') continue;
      const due = fineRemaining(fine);
      if (due.gt(0)) lines.push({ fine_type: fine.fine_type, amount: due.toNumber(), source: 'EXISTING' });
    }

    const penalty = lines.reduce((sum, line) => sum.add(toMoney(line.amount)), ZERO);
    const deposit = depositByItem.get(item.id) || null;
    const held = deposit && deposit.status === 'HELD';
    const split = held ? splitDeposit(deposit.amount, penalty) : { captured: ZERO, refunded: ZERO, additionalDue: penalty };

    return {
      loan_item_id: item.id,
      item_barcode: item.item_barcode || null,
      deposit_id: deposit?.id || null,
      deposit_amount: deposit ? toMoney(deposit.amount).toNumber() : 0,
      deposit_status: deposit?.status || null,
      fines: lines,
      penalty: penalty.toNumber(),
      deposit_captured: split.captured.toNumber(),
      deposit_refunded: split.refunded.toNumber(),
      additional_due: split.additionalDue.toNumber(),
    };
  });

  const sum = (key) => rows.reduce((total, row) => total.add(toMoney(row[key])), ZERO).toNumber();
  return {
    items: rows,
    totals: {
      deposit_amount: sum('deposit_amount'),
      penalty: sum('penalty'),
      deposit_captured: sum('deposit_captured'),
      deposit_refunded: sum('deposit_refunded'),
      additional_due: sum('additional_due'),
    },
    requires_reason: rows.some((row) => row.deposit_status === 'HELD') && settlementNeedsReason({ markLost, itemConditionOnReturn }),
  };
}

module.exports = {
  REASON_REQUIRED_CONDITIONS,
  getDepositPerItem,
  settlementNeedsReason,
  splitDeposit,
  holdLoanItemDeposits,
  settleLoanItemDeposit,
  settleLoanItemDeposits,
  previewReturnSettlement,
};
