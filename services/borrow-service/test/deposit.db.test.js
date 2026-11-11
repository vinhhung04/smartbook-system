// Book deposits against a real PostgreSQL: locking, triggers and concurrency
// cannot be checked with an in-memory fake.
//
// Runs only when DEPOSIT_TEST_DATABASE_URL points at a disposable database with
// every borrow-service migration applied (it writes test customers and loans):
//   DEPOSIT_TEST_DATABASE_URL=postgresql://... node --test test/deposit.db.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { describe, test, before, after } = require('node:test');
const { PrismaClient } = require('@prisma/client');
const {
  AccountError,
  creditAccount,
  holdFunds,
  releaseHeldFunds,
  reconcileCustomerAccount,
} = require('../src/services/account.service');
const {
  holdLoanItemDeposits,
  settleLoanItemDeposits,
  previewReturnSettlement,
  splitDeposit,
} = require('../src/services/deposit.service');
const { applyReturnFines, upsertFine } = require('../src/services/fine.service');
const { finalizeVnpayPayment } = require('../src/services/vnpay-payment.service');

const url = process.env.DEPOSIT_TEST_DATABASE_URL;
const skip = url ? false : 'DEPOSIT_TEST_DATABASE_URL is not set';
let prisma;

const DAY = 24 * 60 * 60 * 1000;
const STAFF = crypto.randomUUID();
const LIMITS = { fine_per_day: 0, lost_item_fee_multiplier: 1, deposit_per_item: 30000 };

async function makeCustomer(balance = 0) {
  const customer = await prisma.customers.create({
    data: { customer_code: `T-${crypto.randomUUID().slice(0, 12)}`, full_name: 'Deposit test reader' },
  });
  if (balance > 0) {
    await prisma.$transaction((tx) => creditAccount(tx, {
      customerId: customer.id, amount: balance, idempotencyKey: `seed:${customer.id}`, referenceType: 'TEST_SEED',
    }));
  }
  return customer;
}

async function makeLoan(customerId, count, { dueInDays = 14 } = {}) {
  const loan = await prisma.loan_transactions.create({
    data: {
      loan_number: `LOAN-T-${crypto.randomUUID().slice(0, 10)}`,
      customer_id: customerId,
      warehouse_id: crypto.randomUUID(),
      handled_by_user_id: STAFF,
      due_date: new Date(Date.now() + dueInDays * DAY),
      total_items: count,
    },
  });
  const items = Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    loan_id: loan.id,
    variant_id: crypto.randomUUID(),
    item_barcode: `${loan.loan_number}-ITEM-${index + 1}`,
    due_date: loan.due_date,
  }));
  await prisma.loan_items.createMany({ data: items });
  return { loan, items };
}

async function wallet(customerId) {
  const account = await prisma.customer_accounts.findUnique({ where: { customer_id: customerId } });
  return { available: Number(account.available_balance), held: Number(account.held_balance) };
}

const hold = (customer, loan, items, amountPerItem) => prisma.$transaction((tx) => holdLoanItemDeposits(tx, {
  customerId: customer.id, loanId: loan.id, loanNumber: loan.loan_number, items, amountPerItem, actorUserId: STAFF,
}));

/** The return transaction's money part: fines under current policy, then deposits. */
const settleReturn = (customer, loan, items, { condition = 'GOOD', markLost = false, reason = null } = {}) => prisma.$transaction(async (tx) => {
  await applyReturnFines(tx, {
    customerId: customer.id, loan, items, returnedAt: new Date(), actorUserId: STAFF,
    membershipLimits: LIMITS, markLost, itemConditionOnReturn: condition,
  });
  return settleLoanItemDeposits(tx, { loanItemIds: items.map((item) => item.id), actorUserId: STAFF, returnCondition: condition, reason });
});

const addFine = (customer, item, amount, fineType = 'DAMAGE') => prisma.$transaction((tx) => upsertFine(tx, {
  customerId: customer.id, loanItemId: item.id, fineType, amount, actorUserId: STAFF, note: 'test fine',
}));

async function assertReconciled(customerId) {
  const report = await prisma.$transaction((tx) => reconcileCustomerAccount(tx, customerId));
  assert.equal(report.ok, true, `wallet does not reconcile with its ledger: ${JSON.stringify(report)}`);
}

describe('book deposits (PostgreSQL)', { skip }, () => {
  before(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();
  });
  after(async () => {
    await prisma?.$disconnect();
  });

  // ── 1. Borrowing ─────────────────────────────────────────────────────────

  test('1.1 enough money: the deposit moves from available to held, with a HOLD entry', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    const [deposit] = await hold(customer, loan, items, 30000);

    assert.equal(deposit.status, 'HELD');
    assert.equal(Number(deposit.amount), 30000);
    assert.deepEqual(await wallet(customer.id), { available: 70000, held: 30000 });
    const entry = await prisma.account_ledger.findFirst({ where: { customer_id: customer.id, entry_type: 'HOLD' } });
    assert.equal(Number(entry.amount), 30000);
    assert.equal(Number(entry.balance_before), 100000);
    assert.equal(Number(entry.balance_after), 70000);
    assert.equal(entry.reference_id, items[0].id);
    await assertReconciled(customer.id);
  });

  test('1.2 not enough money: nothing is held and the whole transaction rolls back', async () => {
    const customer = await makeCustomer(50000);
    const { loan, items } = await makeLoan(customer.id, 2);
    await assert.rejects(hold(customer, loan, items, 30000), (error) => error instanceof AccountError && error.code === 'INSUFFICIENT_FUNDS');

    assert.deepEqual(await wallet(customer.id), { available: 50000, held: 0 });
    assert.equal(await prisma.loan_item_deposits.count({ where: { customer_id: customer.id } }), 0);
    assert.equal(await prisma.account_ledger.count({ where: { customer_id: customer.id, entry_type: 'HOLD' } }), 0);
  });

  test('1.3 several books with different deposits are tracked one by one (20k + 30k + 10k of 100k)', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 3);
    await hold(customer, loan, [items[0]], 20000);
    await hold(customer, loan, [items[1]], 30000);
    await hold(customer, loan, [items[2]], 10000);

    assert.deepEqual(await wallet(customer.id), { available: 40000, held: 60000 });
    const deposits = await prisma.loan_item_deposits.findMany({ where: { loan_id: loan.id } });
    const byItem = new Map(deposits.map((row) => [row.loan_item_id, Number(row.amount)]));
    assert.deepEqual(items.map((item) => byItem.get(item.id)), [20000, 30000, 10000]);
    await assertReconciled(customer.id);
  });

  test('1.4 a repeated hold for the same book is a no-op', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    const [first] = await hold(customer, loan, items, 30000);
    const [second] = await hold(customer, loan, items, 30000);

    assert.equal(second.id, first.id);
    assert.deepEqual(await wallet(customer.id), { available: 70000, held: 30000 });
    assert.equal(await prisma.account_ledger.count({ where: { customer_id: customer.id, entry_type: 'HOLD' } }), 1);
  });

  test('1.5 two concurrent holds that only fit one at a time: exactly one succeeds', async () => {
    const customer = await makeCustomer(100000);
    const first = await makeLoan(customer.id, 2);
    const second = await makeLoan(customer.id, 2);

    const results = await Promise.allSettled([
      hold(customer, first.loan, first.items, 30000),
      hold(customer, second.loan, second.items, 30000),
    ]);
    assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
    assert.equal(results.find((row) => row.status === 'rejected').reason.code, 'INSUFFICIENT_FUNDS');
    assert.deepEqual(await wallet(customer.id), { available: 40000, held: 60000 });
    await assertReconciled(customer.id);
  });

  test('1.6 a plan without deposit holds nothing', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 2);
    assert.deepEqual(await hold(customer, loan, items, 0), []);
    assert.deepEqual(await wallet(customer.id), { available: 100000, held: 0 });
  });

  // ── 2. Returning ─────────────────────────────────────────────────────────

  test('2.1 returned in good condition: the full deposit is released', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    await hold(customer, loan, items, 30000);
    const [result] = await settleReturn(customer, loan, items);

    assert.equal(result.status, 'RELEASED');
    assert.equal(result.refunded_amount, 30000);
    assert.equal(result.captured_amount, 0);
    assert.deepEqual(await wallet(customer.id), { available: 100000, held: 0 });
    await assertReconciled(customer.id);
  });

  test('2.2 light damage (10k on a 30k deposit): 10k captured, 20k refunded, fine paid', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    await hold(customer, loan, items, 30000);
    await addFine(customer, items[0], 10000);
    const [result] = await settleReturn(customer, loan, items, { reason: 'Rách bìa nhẹ' });

    assert.equal(result.status, 'PARTIALLY_REFUNDED');
    assert.deepEqual([result.captured_amount, result.refunded_amount, result.additional_due], [10000, 20000, 0]);
    const fine = await prisma.fines.findFirst({ where: { loan_item_id: items[0].id }, include: { fine_payments: true } });
    assert.equal(fine.status, 'PAID');
    assert.equal(fine.fine_payments[0].payment_method, 'DEPOSIT');
    assert.deepEqual(await wallet(customer.id), { available: 90000, held: 0 });
    const deposit = await prisma.loan_item_deposits.findUnique({ where: { loan_item_id: items[0].id } });
    assert.equal(deposit.settlement_reason, 'Rách bìa nhẹ');
    assert.equal(deposit.settled_by_user_id, STAFF);
    await assertReconciled(customer.id);
  });

  test('2.3 damage equal to the deposit: all captured, nothing refunded', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    await hold(customer, loan, items, 30000);
    await addFine(customer, items[0], 30000);
    const [result] = await settleReturn(customer, loan, items, { reason: 'Hỏng gáy sách' });

    assert.equal(result.status, 'CAPTURED');
    assert.deepEqual([result.captured_amount, result.refunded_amount, result.additional_due], [30000, 0, 0]);
    assert.deepEqual(await wallet(customer.id), { available: 70000, held: 0 });
    await assertReconciled(customer.id);
  });

  test('2.4 damage above the deposit (50k on 30k): 30k captured, 20k left on the fine', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    await hold(customer, loan, items, 30000);
    await addFine(customer, items[0], 50000);
    const [result] = await settleReturn(customer, loan, items, { reason: 'Ướt toàn bộ' });

    assert.equal(result.status, 'CAPTURED');
    assert.deepEqual([result.captured_amount, result.refunded_amount, result.additional_due], [30000, 0, 20000]);
    const fine = await prisma.fines.findFirst({ where: { loan_item_id: items[0].id } });
    assert.equal(fine.status, 'PARTIALLY_PAID');
    assert.deepEqual(await wallet(customer.id), { available: 70000, held: 0 });
    await assertReconciled(customer.id);
  });

  test('2.5 three books, one damaged: only that book pays, the other two are released', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 3);
    await hold(customer, loan, items, 20000);
    await addFine(customer, items[1], 15000);
    const results = await settleReturn(customer, loan, items, { reason: 'Một cuốn bị gấp mép' });

    const byItem = new Map(results.map((row) => [row.loan_item_id, row]));
    assert.equal(byItem.get(items[0].id).status, 'RELEASED');
    assert.equal(byItem.get(items[1].id).captured_amount, 15000);
    assert.equal(byItem.get(items[1].id).refunded_amount, 5000);
    assert.equal(byItem.get(items[2].id).status, 'RELEASED');
    assert.deepEqual(await wallet(customer.id), { available: 85000, held: 0 });
    await assertReconciled(customer.id);
  });

  test('2.6 settling twice refunds once', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    await hold(customer, loan, items, 30000);
    await settleReturn(customer, loan, items);
    const again = await settleReturn(customer, loan, items);

    assert.deepEqual(again, []);
    assert.equal(await prisma.account_ledger.count({ where: { customer_id: customer.id, entry_type: 'RELEASE' } }), 1);
    assert.deepEqual(await wallet(customer.id), { available: 100000, held: 0 });
  });

  test('2.7 two staff settling the same return at once: one settles, the other does nothing', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    await hold(customer, loan, items, 30000);
    await addFine(customer, items[0], 10000);

    const [first, second] = await Promise.all([
      settleReturn(customer, loan, items, { reason: 'NV A' }),
      settleReturn(customer, loan, items, { reason: 'NV B' }),
    ]);
    assert.equal(first.length + second.length, 1);
    assert.equal(await prisma.account_ledger.count({ where: { customer_id: customer.id, entry_type: { in: ['CAPTURE', 'RELEASE'] } } }), 2);
    assert.equal(await prisma.fine_payments.count({ where: { fines: { loan_item_id: items[0].id } } }), 1);
    assert.deepEqual(await wallet(customer.id), { available: 90000, held: 0 });
    await assertReconciled(customer.id);
  });

  test('2.8 the preview shows the same numbers the settlement then applies', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1, { dueInDays: -3 });
    await hold(customer, loan, items, 30000);
    const limits = { ...LIMITS, fine_per_day: 5000 };
    const preview = await previewReturnSettlement(prisma, {
      items, returnedAt: new Date(), membershipLimits: limits, itemConditionOnReturn: 'DAMAGED',
    });
    const damageFee = Number(process.env.DAMAGED_ITEM_FEE || 50000);
    assert.equal(preview.items[0].penalty, 15000 + damageFee);
    assert.equal(preview.requires_reason, true);

    const [settled] = await prisma.$transaction(async (tx) => {
      await applyReturnFines(tx, {
        customerId: customer.id, loan, items, returnedAt: new Date(), actorUserId: STAFF,
        membershipLimits: limits, itemConditionOnReturn: 'DAMAGED',
      });
      return settleLoanItemDeposits(tx, { loanItemIds: [items[0].id], actorUserId: STAFF, returnCondition: 'DAMAGED', reason: 'preview check' });
    });
    assert.equal(settled.penalty, preview.items[0].penalty);
    assert.equal(settled.captured_amount, preview.items[0].deposit_captured);
    assert.equal(settled.additional_due, preview.items[0].additional_due);
  });

  // ── 3. Money integrity ───────────────────────────────────────────────────

  test('3.1 the same idempotency key never records twice, even concurrently', async () => {
    const customer = await makeCustomer(100000);
    const input = { customerId: customer.id, amount: 25000, idempotencyKey: 'same-key', referenceType: 'TEST' };
    const results = await Promise.all([
      prisma.$transaction((tx) => holdFunds(tx, input)),
      prisma.$transaction((tx) => holdFunds(tx, input)),
    ]);
    assert.equal(results.filter((row) => row.idempotent).length, 1);
    assert.deepEqual(await wallet(customer.id), { available: 75000, held: 25000 });
  });

  test('3.2 a key reused for a different movement is rejected', async () => {
    const customer = await makeCustomer(100000);
    await prisma.$transaction((tx) => holdFunds(tx, { customerId: customer.id, amount: 10000, idempotencyKey: 'k1' }));
    await assert.rejects(
      prisma.$transaction((tx) => releaseHeldFunds(tx, { customerId: customer.id, amount: 10000, idempotencyKey: 'k1' })),
      (error) => error.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  test('3.3 balances cannot go negative: release more than held is refused', async () => {
    const customer = await makeCustomer(100000);
    await prisma.$transaction((tx) => holdFunds(tx, { customerId: customer.id, amount: 10000, idempotencyKey: 'h' }));
    await assert.rejects(
      prisma.$transaction((tx) => releaseHeldFunds(tx, { customerId: customer.id, amount: 20000, idempotencyKey: 'r' })),
      (error) => error.code === 'HELD_BALANCE_TOO_LOW',
    );
    assert.deepEqual(await wallet(customer.id), { available: 90000, held: 10000 });
  });

  test('3.4 ledger entries and settled deposits cannot be edited or deleted', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    await hold(customer, loan, items, 30000);
    await settleReturn(customer, loan, items);
    const entry = await prisma.account_ledger.findFirst({ where: { customer_id: customer.id } });
    const deposit = await prisma.loan_item_deposits.findUnique({ where: { loan_item_id: items[0].id } });

    await assert.rejects(prisma.account_ledger.update({ where: { id: entry.id }, data: { amount: 1 } }), /append-only/);
    await assert.rejects(prisma.account_ledger.delete({ where: { id: entry.id } }), /append-only/);
    await assert.rejects(prisma.loan_item_deposits.update({ where: { id: deposit.id }, data: { refunded_amount: 0 } }), /already settled/);
    await assert.rejects(prisma.loan_item_deposits.delete({ where: { id: deposit.id } }), /cannot be deleted/);
    // Deleting the customer must not cascade the money history away.
    await assert.rejects(prisma.customers.delete({ where: { id: customer.id } }));
    assert.ok(await prisma.account_ledger.findUnique({ where: { id: entry.id } }));
  });

  test('3.5 the part above the deposit is paid by VNPay; a repeated callback is ignored', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    await hold(customer, loan, items, 30000);
    const fine = await addFine(customer, items[0], 50000);
    await settleReturn(customer, loan, items, { reason: 'Mất trang' });

    const txnRef = `T${Date.now()}`;
    await prisma.fine_payment_intents.create({
      data: { fine_id: fine.id, customer_id: customer.id, txn_ref: txnRef, amount: 20000, expires_at: new Date(Date.now() + 900000) },
    });
    const callback = { vnp_TxnRef: txnRef, vnp_ResponseCode: '00', vnp_Amount: '2000000', vnp_TransactionNo: 'VNP1' };
    const first = await finalizeVnpayPayment(prisma, callback);
    const repeat = await finalizeVnpayPayment(prisma, callback);

    assert.equal(first.outcome, 'SUCCESS');
    assert.equal(repeat.outcome, 'ALREADY_FINALIZED');
    const paid = await prisma.fines.findUnique({ where: { id: fine.id }, include: { fine_payments: true } });
    assert.equal(paid.status, 'PAID');
    assert.deepEqual(paid.fine_payments.map((row) => [row.payment_method, Number(row.amount)]).sort(), [['DEPOSIT', 30000], ['VNPAY', 20000]]);
    assert.equal(Number((await prisma.customers.findUnique({ where: { id: customer.id } })).total_fine_balance), 0);
    await assertReconciled(customer.id);
  });

  test('3.6 a failed VNPay callback leaves the amount still due', async () => {
    const customer = await makeCustomer(0);
    const { items } = await makeLoan(customer.id, 1);
    const fine = await addFine(customer, items[0], 20000);
    const txnRef = `F${Date.now()}`;
    await prisma.fine_payment_intents.create({
      data: { fine_id: fine.id, customer_id: customer.id, txn_ref: txnRef, amount: 20000, expires_at: new Date(Date.now() + 900000) },
    });
    const result = await finalizeVnpayPayment(prisma, { vnp_TxnRef: txnRef, vnp_ResponseCode: '24', vnp_Amount: '2000000' });

    assert.equal(result.outcome, 'PAYMENT_FAILED');
    const unpaid = await prisma.fines.findUnique({ where: { id: fine.id }, include: { fine_payments: true } });
    assert.equal(unpaid.status, 'UNPAID');
    assert.equal(unpaid.fine_payments.length, 0);
  });

  test('3.7 VNPay and the deposit paying the same fine at once never overpay it', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    await hold(customer, loan, items, 30000);
    const fine = await addFine(customer, items[0], 50000);
    const txnRef = `R${Date.now()}`;
    await prisma.fine_payment_intents.create({
      data: { fine_id: fine.id, customer_id: customer.id, txn_ref: txnRef, amount: 50000, expires_at: new Date(Date.now() + 900000) },
    });

    await Promise.all([
      finalizeVnpayPayment(prisma, { vnp_TxnRef: txnRef, vnp_ResponseCode: '00', vnp_Amount: '5000000', vnp_TransactionNo: 'VNP2' }),
      prisma.$transaction((tx) => settleLoanItemDeposits(tx, { loanItemIds: [items[0].id], actorUserId: STAFF, returnCondition: 'DAMAGED', reason: 'race' })),
    ]);

    const settledFine = await prisma.fines.findUnique({ where: { id: fine.id }, include: { fine_payments: true } });
    const totalPaid = settledFine.fine_payments.reduce((sum, row) => sum + Number(row.amount), 0);
    assert.ok(totalPaid <= 50000, `fine overpaid: ${totalPaid}`);
    const deposit = await prisma.loan_item_deposits.findUnique({ where: { loan_item_id: items[0].id } });
    const { available, held } = await wallet(customer.id);
    assert.equal(held, 0);
    assert.equal(available, 70000 + Number(deposit.refunded_amount));
    await assertReconciled(customer.id);
  });

  test('3.8 reconciliation detects a balance changed outside the ledger', async () => {
    const customer = await makeCustomer(100000);
    const { loan, items } = await makeLoan(customer.id, 1);
    await hold(customer, loan, items, 30000);
    await assertReconciled(customer.id);

    await prisma.customer_accounts.update({ where: { customer_id: customer.id }, data: { held_balance: 99999 } });
    const report = await prisma.$transaction((tx) => reconcileCustomerAccount(tx, customer.id));
    assert.equal(report.ok, false);
    assert.equal(report.held_matches, false);
    assert.equal(report.held_from_ledger, 30000);
  });
});

test('refund and additional due follow max(deposit − penalty, 0) and max(penalty − deposit, 0)', () => {
  const cases = [
    [30000, 10000, 10000, 20000, 0],
    [30000, 20000, 20000, 10000, 0],
    [30000, 30000, 30000, 0, 0],
    [30000, 50000, 30000, 0, 20000],
    [30000, 0, 0, 30000, 0],
  ];
  for (const [deposit, penalty, captured, refunded, due] of cases) {
    const split = splitDeposit(deposit, penalty);
    assert.deepEqual([split.captured.toNumber(), split.refunded.toNumber(), split.additionalDue.toNumber()], [captured, refunded, due]);
  }
});
