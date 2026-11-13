const { prisma } = require('../lib/prisma');
const { writeAuditLog } = require('../lib/audit');
const { createNotificationRecord } = require('../lib/notifications');
const {
  AccountError,
  WALLET_TOPUP_AMOUNTS_VND,
  isAllowedTopupAmount,
  toMoney,
  creditAccount,
  getCustomerAccountSnapshot,
  listAccountLedger,
  reconcileCustomerAccount,
} = require('../services/account.service');

// Staff view of a customer's wallet, and money paid in at the library counter by a
// staff member who has taken the cash or seen the transfer (borrow.write). Readers can
// also top up online through VNPay (wallet-topup.controller); both accept the same
// fixed amounts (WALLET_TOPUP_AMOUNTS_VND).

const TOPUP_METHODS = new Set(['CASH', 'TRANSFER']);

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

// GET /borrow/customers/:id/account
async function getCustomerAccount(req, res) {
  const customerId = String(req.params.id || '').trim();
  if (!isUuid(customerId)) {
    return res.status(400).json({ message: 'Mã bạn đọc không hợp lệ' });
  }

  try {
    const customer = await prisma.customers.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy bạn đọc' });
    }

    const [snapshot, ledger, heldDeposits, reconciliation] = await prisma.$transaction(async (tx) => [
      await getCustomerAccountSnapshot(tx, customerId),
      await listAccountLedger(tx, customerId, { page: req.query.page, pageSize: req.query.pageSize }),
      await tx.loan_item_deposits.findMany({
        where: { customer_id: customerId, status: 'HELD' },
        orderBy: [{ held_at: 'desc' }],
      }),
      await reconcileCustomerAccount(tx, customerId),
    ]);

    return res.json({
      data: {
        customer_id: customerId,
        account_id: snapshot.account.id,
        status: snapshot.account.status,
        currency_code: snapshot.account.currency_code,
        available_balance: snapshot.availableBalance,
        held_balance: snapshot.heldBalance,
        held_deposits: heldDeposits,
        reconciliation,
        ledger: ledger.data,
      },
      meta: ledger.meta,
    });
  } catch (error) {
    console.error('getCustomerAccount error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// POST /borrow/customers/:id/account/topups { amount, method: CASH|TRANSFER, reference?, note? }
// Header Idempotency-Key is required: a retried request records the money once.
async function recordCounterTopup(req, res) {
  const customerId = String(req.params.id || '').trim();
  const actorUserId = req.user?.id || null;
  const idempotencyKey = String(req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || '').trim();
  const method = String(req.body?.method || 'CASH').trim().toUpperCase();
  const reference = req.body?.reference ? String(req.body.reference).trim().slice(0, 100) : null;
  const note = req.body?.note ? String(req.body.note).trim().slice(0, 500) : null;

  if (!isUuid(customerId)) {
    return res.status(400).json({ message: 'Mã bạn đọc không hợp lệ' });
  }
  if (!idempotencyKey) {
    return res.status(400).json({ message: 'Cần header Idempotency-Key khi nạp tiền' });
  }
  if (!TOPUP_METHODS.has(method)) {
    return res.status(400).json({ message: 'method phải là CASH hoặc TRANSFER' });
  }

  if (!isAllowedTopupAmount(req.body?.amount)) {
    return res.status(400).json({
      message: `Chỉ nạp được các mức: ${WALLET_TOPUP_AMOUNTS_VND.map((value) => `${value.toLocaleString('vi-VN')}đ`).join(', ')}.`,
      code: 'INVALID_TOPUP_AMOUNT',
      allowed_amounts: WALLET_TOPUP_AMOUNTS_VND,
    });
  }
  const amount = toMoney(req.body.amount);

  try {
    const customer = await prisma.customers.findUnique({ where: { id: customerId }, select: { id: true, status: true } });
    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy bạn đọc' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const credit = await creditAccount(tx, {
        customerId,
        actorUserId,
        amount: amount.toNumber(),
        idempotencyKey: `counter-topup:${idempotencyKey}`,
        referenceType: 'COUNTER_TOPUP',
        note: note || `Nạp tiền tại quầy (${method === 'CASH' ? 'tiền mặt' : 'chuyển khoản'})`,
        metadata: { method, reference },
      });

      if (!credit.idempotent) {
        await writeAuditLog(tx, {
          actor_user_id: actorUserId,
          action_name: 'COUNTER_WALLET_TOPUP',
          entity_type: 'CUSTOMER_ACCOUNT',
          entity_id: credit.account.id,
          after_data: {
            customer_id: customerId,
            ledger_entry_id: credit.entry.id,
            amount: credit.creditedAmount,
            method,
            reference,
            available_balance: credit.newBalance,
          },
        });

        await createNotificationRecord(tx, {
          customer_id: customerId,
          channel: 'IN_APP',
          template_code: 'WALLET_TOPUP_RECORDED',
          subject: 'Đã nạp tiền vào ví',
          body: `Thư viện đã ghi nhận ${credit.creditedAmount.toLocaleString('vi-VN')}đ vào ví của bạn. Số dư khả dụng: ${credit.newBalance.toLocaleString('vi-VN')}đ.`,
          reference_type: 'ACCOUNT_LEDGER',
          reference_id: credit.entry.id,
          metadata: { amount: credit.creditedAmount, method },
        });
      }

      return credit;
    });

    return res.status(result.idempotent ? 200 : 201).json({
      message: result.idempotent ? 'Top-up already recorded' : 'Top-up recorded',
      data: {
        ledger_entry_id: result.entry.id,
        credited_amount: result.creditedAmount,
        available_balance: result.newBalance,
        idempotent: result.idempotent,
      },
    });
  } catch (error) {
    if (error instanceof AccountError) {
      return res.status(409).json({ message: error.message, code: error.code, detail: error.detail || undefined });
    }
    console.error('recordCounterTopup error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = { getCustomerAccount, recordCounterTopup };
