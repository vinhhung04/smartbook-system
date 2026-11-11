const { createNotificationRecord } = require('../lib/notifications');
const { writeAuditLog } = require('../lib/audit');
const { creditAccount, toMoney } = require('./account.service');
const { VNPAY_SUCCESS_CODE } = require('./vnpay-payment.service');

// Online wallet top-up through VNPay. Same shape as finalizeVnpayPayment (fines): the
// return URL and the IPN can both arrive, in either order and more than once, so the
// intent is claimed atomically first and every outcome is final. A successful top-up
// credits the wallet through account_ledger with a key derived from txn_ref, so even a
// replayed callback can never credit twice.

async function finalizeVnpayTopup(prismaClient, verifiedParams) {
  const txnRef = String(verifiedParams.vnp_TxnRef || '');
  const responseCode = String(verifiedParams.vnp_ResponseCode || '');
  const vnpAmount = Number(verifiedParams.vnp_Amount || 0);
  const vnpTransactionNo = verifiedParams.vnp_TransactionNo ? String(verifiedParams.vnp_TransactionNo) : null;
  const vnpBankCode = verifiedParams.vnp_BankCode ? String(verifiedParams.vnp_BankCode) : null;

  return prismaClient.$transaction(async (tx) => {
    const intent = await tx.wallet_topup_intents.findUnique({ where: { txn_ref: txnRef } });
    if (!intent) {
      return { outcome: 'NOT_FOUND' };
    }
    if (intent.status !== 'PENDING') {
      return { outcome: 'ALREADY_FINALIZED', intent };
    }

    // Claim before doing anything: a concurrent return/IPN for the same txn_ref blocks
    // on this row lock, then matches 0 rows instead of processing it a second time.
    const claim = await tx.wallet_topup_intents.updateMany({
      where: { id: intent.id, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (claim.count !== 1) {
      return { outcome: 'ALREADY_FINALIZED', intent: await tx.wallet_topup_intents.findUnique({ where: { id: intent.id } }) };
    }

    const fail = (outcome, code) => tx.wallet_topup_intents.update({
      where: { id: intent.id },
      data: {
        status: 'FAILED',
        vnp_response_code: code,
        vnp_transaction_no: vnpTransactionNo,
        vnp_bank_code: vnpBankCode,
        raw_return_params: verifiedParams,
        finalized_at: new Date(),
      },
    }).then((updated) => ({ outcome, intent: updated }));

    const amount = toMoney(intent.amount);
    if (vnpAmount !== amount.mul(100).toNumber()) {
      return fail('AMOUNT_MISMATCH', responseCode);
    }
    if (responseCode !== VNPAY_SUCCESS_CODE) {
      return fail('PAYMENT_FAILED', responseCode);
    }

    const credit = await creditAccount(tx, {
      customerId: intent.customer_id,
      actorUserId: null,
      amount: amount.toNumber(),
      idempotencyKey: `vnpay-topup:${txnRef}`,
      referenceType: 'VNPAY_TOPUP',
      referenceId: intent.id,
      note: 'Nạp tiền vào ví qua VNPay',
      metadata: { txn_ref: txnRef, vnp_transaction_no: vnpTransactionNo, vnp_bank_code: vnpBankCode },
    });

    const finalized = await tx.wallet_topup_intents.update({
      where: { id: intent.id },
      data: {
        status: 'SUCCESS',
        vnp_response_code: responseCode,
        vnp_transaction_no: vnpTransactionNo,
        vnp_bank_code: vnpBankCode,
        ledger_entry_id: credit.entry.id,
        raw_return_params: verifiedParams,
        finalized_at: new Date(),
      },
    });

    await createNotificationRecord(tx, {
      customer_id: intent.customer_id,
      channel: 'IN_APP',
      template_code: 'WALLET_TOPUP_RECORDED',
      subject: 'Đã nạp tiền vào ví',
      body: `Đã nạp ${amount.toNumber().toLocaleString('vi-VN')}đ vào ví qua VNPay. Số dư khả dụng: ${Number(credit.newBalance).toLocaleString('vi-VN')}đ.`,
      reference_type: 'ACCOUNT_LEDGER',
      reference_id: credit.entry.id,
      metadata: { amount: amount.toNumber(), txn_ref: txnRef, provider: 'VNPAY' },
      status: 'SENT',
    });

    await writeAuditLog(tx, {
      actor_user_id: null,
      action_name: 'CUSTOMER_WALLET_TOPUP_VNPAY',
      entity_type: 'CUSTOMER_ACCOUNT',
      entity_id: credit.account.id,
      after_data: {
        customer_id: intent.customer_id,
        intent_id: intent.id,
        ledger_entry_id: credit.entry.id,
        amount: amount.toNumber(),
        available_balance: credit.newBalance,
        vnp_transaction_no: vnpTransactionNo,
      },
    });

    return { outcome: 'SUCCESS', intent: finalized, ledgerEntry: credit.entry, availableBalance: credit.newBalance };
  });
}

module.exports = { finalizeVnpayTopup };
