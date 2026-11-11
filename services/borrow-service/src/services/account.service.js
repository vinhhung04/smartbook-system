const { Prisma } = require('@prisma/client');

const Decimal = Prisma.Decimal;

function normalizeMoney(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Number(parsed.toFixed(2));
}

// The only amounts a wallet can be topped up with, online or at the counter, so balances
// stay in round thousands of VND.
const WALLET_TOPUP_AMOUNTS_VND = Object.freeze([10000, 20000, 50000, 100000, 200000]);

function isAllowedTopupAmount(value) {
  let amount;
  try {
    amount = toMoney(value);
  } catch {
    return false;
  }
  return WALLET_TOPUP_AMOUNTS_VND.some((allowed) => amount.eq(allowed));
}

/** Exact money value (2 decimals) — never a float. Throws on anything non-numeric. */
function toMoney(value) {
  const amount = new Decimal(value ?? 0);
  if (!amount.isFinite()) throw new TypeError(`invalid money value: ${value}`);
  return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

class AccountError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
    this.detail = detail;
  }
}

async function ensureCustomerAccount(tx, customerId) {
  const existing = await tx.customer_accounts.findUnique({ where: { customer_id: customerId } });
  if (existing) {
    return existing;
  }

  // Two first reads for the same reader (the wallet page loads the balance and the
  // ledger together) used to race here: both found nothing, both created, and the
  // second hit the unique key — a 500 on the first visit. ON CONFLICT makes it a no-op.
  await tx.$executeRaw`INSERT INTO customer_accounts (customer_id, currency_code, status) VALUES (${customerId}::uuid, 'VND', 'ACTIVE') ON CONFLICT (customer_id) DO NOTHING`;
  return tx.customer_accounts.findUnique({ where: { customer_id: customerId } });
}

async function ensureAutoPaymentSettings(tx, customerId) {
  const existing = await tx.auto_payment_settings.findUnique({ where: { customer_id: customerId } });
  if (existing) {
    return existing;
  }

  // Same first-visit race as ensureCustomerAccount (customer_id is the primary key).
  await tx.$executeRaw`INSERT INTO auto_payment_settings (customer_id, auto_debit_borrow_fee, auto_debit_fines, allow_partial_fine_payment, min_wallet_balance_required) VALUES (${customerId}::uuid, true, false, true, 0) ON CONFLICT (customer_id) DO NOTHING`;
  return tx.auto_payment_settings.findUnique({ where: { customer_id: customerId } });
}

/**
 * Creates the account if missing and takes its row lock for the rest of the
 * transaction. Every balance change goes through this first, so a deposit hold,
 * a release, a borrow-fee debit and a top-up on the same wallet run one after
 * another instead of overwriting each other's balance.
 */
async function lockCustomerAccount(tx, customerId) {
  await tx.$executeRaw`INSERT INTO customer_accounts (customer_id) VALUES (${customerId}::uuid) ON CONFLICT (customer_id) DO NOTHING`;
  const rows = await tx.$queryRaw`SELECT * FROM customer_accounts WHERE customer_id = ${customerId}::uuid FOR UPDATE`;
  return rows[0];
}

async function getCustomerAccountSnapshot(tx, customerId) {
  const account = await ensureCustomerAccount(tx, customerId);
  const settings = await ensureAutoPaymentSettings(tx, customerId);

  return {
    account,
    settings,
    availableBalance: normalizeMoney(account.available_balance),
    heldBalance: normalizeMoney(account.held_balance),
    minWalletBalanceRequired: normalizeMoney(settings.min_wallet_balance_required),
  };
}

async function debitBorrowFee(tx, input) {
  const {
    customerId,
    actorUserId = null,
    amount,
    idempotencyKey,
    referenceId = null,
    referenceType = 'LOAN_TRANSACTION',
    note = null,
    metadata = {},
  } = input;

  const debitAmount = normalizeMoney(amount);
  if (!idempotencyKey) {
    throw new AccountError('IDEMPOTENCY_KEY_REQUIRED', 'idempotency key is required for account debit');
  }

  if (debitAmount <= 0) {
    throw new AccountError('INVALID_AMOUNT', 'debit amount must be positive');
  }

  await lockCustomerAccount(tx, customerId);
  const { account, settings, availableBalance, minWalletBalanceRequired } = await getCustomerAccountSnapshot(tx, customerId);

  if (settings.auto_debit_borrow_fee !== true) {
    throw new AccountError('AUTO_DEBIT_DISABLED', 'auto debit for borrow fee is disabled');
  }

  const existingEntry = await tx.account_ledger.findFirst({
    where: {
      customer_id: customerId,
      idempotency_key: idempotencyKey,
      entry_type: 'DEBIT',
    },
  });

  if (existingEntry) {
    return {
      idempotent: true,
      entry: existingEntry,
      debitedAmount: normalizeMoney(existingEntry.amount),
      remainingBalance: normalizeMoney(existingEntry.balance_after),
      account,
    };
  }

  if (account.status !== 'ACTIVE') {
    throw new AccountError('ACCOUNT_NOT_ACTIVE', `customer account is ${account.status}`);
  }

  const postDebitBalance = normalizeMoney(availableBalance - debitAmount);
  if (postDebitBalance < minWalletBalanceRequired) {
    throw new AccountError('INSUFFICIENT_FUNDS', 'insufficient wallet balance for auto debit', {
      available_balance: availableBalance,
      required_amount: debitAmount,
      min_wallet_balance_required: minWalletBalanceRequired,
    });
  }

  const updatedAccount = await tx.customer_accounts.update({
    where: { id: account.id },
    data: {
      available_balance: postDebitBalance,
      total_debited: normalizeMoney(normalizeMoney(account.total_debited) + debitAmount),
      updated_at: new Date(),
    },
  });

  const ledgerEntry = await tx.account_ledger.create({
    data: {
      account_id: account.id,
      customer_id: customerId,
      entry_type: 'DEBIT',
      amount: debitAmount,
      balance_before: availableBalance,
      balance_after: postDebitBalance,
      reference_type: referenceType,
      reference_id: referenceId,
      idempotency_key: idempotencyKey,
      note,
      metadata,
      created_by_user_id: actorUserId,
    },
  });

  return {
    idempotent: false,
    entry: ledgerEntry,
    debitedAmount: debitAmount,
    remainingBalance: postDebitBalance,
    account: updatedAccount,
  };
}

async function creditAccount(tx, input) {
  const {
    customerId,
    actorUserId = null,
    amount,
    idempotencyKey,
    referenceId = null,
    referenceType = 'ACCOUNT_TOPUP',
    note = null,
    metadata = {},
  } = input;

  const creditAmount = normalizeMoney(amount);
  if (!idempotencyKey) {
    throw new AccountError('IDEMPOTENCY_KEY_REQUIRED', 'idempotency key is required for account credit');
  }

  if (creditAmount <= 0) {
    throw new AccountError('INVALID_AMOUNT', 'credit amount must be positive');
  }

  await lockCustomerAccount(tx, customerId);
  const { account, availableBalance } = await getCustomerAccountSnapshot(tx, customerId);

  const existingEntry = await tx.account_ledger.findFirst({
    where: {
      customer_id: customerId,
      idempotency_key: idempotencyKey,
      entry_type: 'CREDIT',
    },
  });

  if (existingEntry) {
    return {
      idempotent: true,
      entry: existingEntry,
      creditedAmount: normalizeMoney(existingEntry.amount),
      newBalance: normalizeMoney(existingEntry.balance_after),
      account,
    };
  }

  if (account.status !== 'ACTIVE') {
    throw new AccountError('ACCOUNT_NOT_ACTIVE', `customer account is ${account.status}`);
  }

  const postCreditBalance = normalizeMoney(availableBalance + creditAmount);

  const updatedAccount = await tx.customer_accounts.update({
    where: { id: account.id },
    data: {
      available_balance: postCreditBalance,
      total_credited: normalizeMoney(normalizeMoney(account.total_credited) + creditAmount),
      updated_at: new Date(),
    },
  });

  const ledgerEntry = await tx.account_ledger.create({
    data: {
      account_id: account.id,
      customer_id: customerId,
      entry_type: 'CREDIT',
      amount: creditAmount,
      balance_before: availableBalance,
      balance_after: postCreditBalance,
      reference_type: referenceType,
      reference_id: referenceId,
      idempotency_key: idempotencyKey,
      note,
      metadata,
      created_by_user_id: actorUserId,
    },
  });

  return {
    idempotent: false,
    entry: ledgerEntry,
    creditedAmount: creditAmount,
    newBalance: postCreditBalance,
    account: updatedAccount,
  };
}

// How each held-funds movement changes the wallet. balance_before/after on the
// ledger entry always describe available_balance (as for DEBIT/CREDIT); the held
// side is recorded in the entry's metadata.
const HELD_MOVEMENTS = {
  // available -> held (deposit taken when a book is lent)
  HOLD: { availableSign: -1, heldSign: 1, debited: false, source: 'available_balance' },
  // held -> available (deposit, or its unused part, given back)
  RELEASE: { availableSign: 1, heldSign: -1, debited: false, source: 'held_balance' },
  // held -> paid out (deposit used to pay that book's fines)
  CAPTURE: { availableSign: 0, heldSign: -1, debited: true, source: 'held_balance' },
};

async function moveHeldFunds(tx, entryType, input) {
  const movement = HELD_MOVEMENTS[entryType];
  const {
    customerId,
    actorUserId = null,
    amount,
    idempotencyKey,
    referenceId = null,
    referenceType = 'LOAN_ITEM_DEPOSIT',
    note = null,
    metadata = {},
  } = input;

  if (!idempotencyKey) {
    throw new AccountError('IDEMPOTENCY_KEY_REQUIRED', `idempotency key is required for ${entryType}`);
  }
  const value = toMoney(amount);
  if (value.lte(0)) {
    throw new AccountError('INVALID_AMOUNT', `${entryType} amount must be positive`);
  }

  // Lock first: a concurrent request with the same key waits here, then finds the
  // entry below instead of writing a second one (the unique index is the backstop).
  const account = await lockCustomerAccount(tx, customerId);

  const existingEntry = await tx.account_ledger.findFirst({
    where: { customer_id: customerId, idempotency_key: idempotencyKey },
  });
  if (existingEntry) {
    if (existingEntry.entry_type !== entryType || !toMoney(existingEntry.amount).eq(value)) {
      throw new AccountError('IDEMPOTENCY_CONFLICT', 'idempotency key already used for a different ledger entry', {
        idempotency_key: idempotencyKey,
      });
    }
    return { idempotent: true, entry: existingEntry, account };
  }

  if (account.status !== 'ACTIVE') {
    throw new AccountError('ACCOUNT_NOT_ACTIVE', `customer account is ${account.status}`);
  }

  const availableBefore = toMoney(account.available_balance);
  const heldBefore = toMoney(account.held_balance);
  const sourceBalance = movement.source === 'available_balance' ? availableBefore : heldBefore;
  if (sourceBalance.lt(value)) {
    throw new AccountError(
      movement.source === 'available_balance' ? 'INSUFFICIENT_FUNDS' : 'HELD_BALANCE_TOO_LOW',
      movement.source === 'available_balance'
        ? 'insufficient wallet balance for deposit'
        : 'held balance is lower than the amount to settle',
      { available_balance: availableBefore.toNumber(), held_balance: heldBefore.toNumber(), required_amount: value.toNumber() },
    );
  }

  const availableDelta = value.mul(movement.availableSign).toFixed(2);
  const heldDelta = value.mul(movement.heldSign).toFixed(2);
  const debitedDelta = movement.debited ? value.toFixed(2) : '0';
  const rows = await tx.$queryRaw`
    UPDATE customer_accounts
       SET available_balance = available_balance + ${availableDelta}::numeric,
           held_balance = held_balance + ${heldDelta}::numeric,
           total_debited = total_debited + ${debitedDelta}::numeric,
           updated_at = now()
     WHERE id = ${account.id}::uuid
     RETURNING available_balance, held_balance`;
  const availableAfter = toMoney(rows[0].available_balance);
  const heldAfter = toMoney(rows[0].held_balance);

  const entry = await tx.account_ledger.create({
    data: {
      account_id: account.id,
      customer_id: customerId,
      entry_type: entryType,
      amount: value.toFixed(2),
      balance_before: availableBefore.toFixed(2),
      balance_after: availableAfter.toFixed(2),
      reference_type: referenceType,
      reference_id: referenceId,
      idempotency_key: idempotencyKey,
      note,
      metadata: {
        ...metadata,
        held_balance_before: heldBefore.toNumber(),
        held_balance_after: heldAfter.toNumber(),
      },
      created_by_user_id: actorUserId,
    },
  });

  return {
    idempotent: false,
    entry,
    account,
    availableBalance: availableAfter,
    heldBalance: heldAfter,
  };
}

const holdFunds = (tx, input) => moveHeldFunds(tx, 'HOLD', input);
const releaseHeldFunds = (tx, input) => moveHeldFunds(tx, 'RELEASE', input);
const captureHeldFunds = (tx, input) => moveHeldFunds(tx, 'CAPTURE', input);

/**
 * Checks a wallet against its ledger:
 * - held_balance must equal HOLD − RELEASE − CAPTURE (holds only ever move through the ledger);
 * - entries must chain (each balance_before = the previous balance_after on available_balance),
 *   and the last balance_after must equal available_balance now.
 * Opening balances written directly by seed scripts show up as the first entry's
 * balance_before, so they do not count as a break.
 */
async function reconcileCustomerAccount(tx, customerId) {
  const account = await tx.customer_accounts.findUnique({ where: { customer_id: customerId } });
  if (!account) {
    return { ok: true, entry_count: 0, account_exists: false };
  }

  const entries = await tx.account_ledger.findMany({
    where: { account_id: account.id },
    orderBy: [{ entry_seq: 'asc' }],
    select: { id: true, entry_type: true, amount: true, balance_before: true, balance_after: true },
  });

  let heldFromLedger = new Decimal(0);
  const chainBreaks = [];
  entries.forEach((entry, index) => {
    const amount = toMoney(entry.amount);
    if (entry.entry_type === 'HOLD') heldFromLedger = heldFromLedger.add(amount);
    if (entry.entry_type === 'RELEASE' || entry.entry_type === 'CAPTURE') heldFromLedger = heldFromLedger.sub(amount);
    if (index > 0 && !toMoney(entries[index - 1].balance_after).eq(toMoney(entry.balance_before))) {
      chainBreaks.push(entry.id);
    }
  });

  const availableBalance = toMoney(account.available_balance);
  const heldBalance = toMoney(account.held_balance);
  const last = entries[entries.length - 1];
  const lastBalanceAfter = last ? toMoney(last.balance_after) : null;
  const heldMatches = heldBalance.eq(heldFromLedger);
  const availableMatches = lastBalanceAfter === null || lastBalanceAfter.eq(availableBalance);

  return {
    ok: heldMatches && availableMatches && chainBreaks.length === 0,
    account_exists: true,
    entry_count: entries.length,
    available_balance: availableBalance.toNumber(),
    last_entry_balance_after: lastBalanceAfter ? lastBalanceAfter.toNumber() : null,
    available_matches: availableMatches,
    held_balance: heldBalance.toNumber(),
    held_from_ledger: heldFromLedger.toNumber(),
    held_matches: heldMatches,
    chain_breaks: chainBreaks,
  };
}

async function listAccountLedger(tx, customerId, options = {}) {
  const page = Math.max(1, Number.parseInt(String(options.page || '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(options.pageSize || '20'), 10) || 20));
  const skip = (page - 1) * pageSize;

  const account = await ensureCustomerAccount(tx, customerId);
  const where = { account_id: account.id };

  const [items, total] = await Promise.all([
    tx.account_ledger.findMany({
      where,
      orderBy: [{ created_at: 'desc' }, { entry_seq: 'desc' }],
      skip,
      take: pageSize,
    }),
    tx.account_ledger.count({ where }),
  ]);

  return {
    data: items,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

module.exports = {
  AccountError,
  WALLET_TOPUP_AMOUNTS_VND,
  isAllowedTopupAmount,
  toMoney,
  ensureCustomerAccount,
  ensureAutoPaymentSettings,
  getCustomerAccountSnapshot,
  lockCustomerAccount,
  debitBorrowFee,
  creditAccount,
  holdFunds,
  releaseHeldFunds,
  captureHeldFunds,
  reconcileCustomerAccount,
  listAccountLedger,
};
