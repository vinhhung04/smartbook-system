const { createNotificationRecord } = require('../lib/notifications');
const { writeAuditLog } = require('../lib/audit');
const { normalizeMoney, recomputeCustomerFineBalance } = require('./fine.service');

const VNPAY_SUCCESS_CODE = '00';

// Shared by the return-URL handler and the IPN handler — either (or both) may
// try to finalize the same txn_ref, so this must be idempotent on it.
async function finalizeVnpayPayment(prismaClient, verifiedParams) {
  const txnRef = String(verifiedParams.vnp_TxnRef || '');
  const responseCode = String(verifiedParams.vnp_ResponseCode || '');
  const vnpAmount = Number(verifiedParams.vnp_Amount || 0);
  const vnpTransactionNo = verifiedParams.vnp_TransactionNo ? String(verifiedParams.vnp_TransactionNo) : null;
  const vnpBankCode = verifiedParams.vnp_BankCode ? String(verifiedParams.vnp_BankCode) : null;

  return prismaClient.$transaction(async (tx) => {
    const intent = await tx.fine_payment_intents.findUnique({ where: { txn_ref: txnRef } });
    if (!intent) {
      return { outcome: 'NOT_FOUND' };
    }

    if (intent.status !== 'PENDING') {
      return { outcome: 'ALREADY_FINALIZED', intent };
    }

    const expectedVnpAmount = Math.round(normalizeMoney(intent.amount) * 100);
    if (vnpAmount !== expectedVnpAmount) {
      const updated = await tx.fine_payment_intents.update({
        where: { id: intent.id },
        data: { status: 'FAILED', vnp_response_code: responseCode, raw_return_params: verifiedParams, finalized_at: new Date() },
      });
      return { outcome: 'AMOUNT_MISMATCH', intent: updated };
    }

    if (responseCode !== VNPAY_SUCCESS_CODE) {
      const updated = await tx.fine_payment_intents.update({
        where: { id: intent.id },
        data: {
          status: 'FAILED',
          vnp_response_code: responseCode,
          vnp_transaction_no: vnpTransactionNo,
          vnp_bank_code: vnpBankCode,
          raw_return_params: verifiedParams,
          finalized_at: new Date(),
        },
      });
      return { outcome: 'PAYMENT_FAILED', intent: updated };
    }

    const fine = await tx.fines.findUnique({ where: { id: intent.fine_id }, include: { fine_payments: true } });
    if (!fine) {
      const updated = await tx.fine_payment_intents.update({
        where: { id: intent.id },
        data: { status: 'FAILED', vnp_response_code: responseCode, raw_return_params: verifiedParams, finalized_at: new Date() },
      });
      return { outcome: 'FINE_NOT_FOUND', intent: updated };
    }

    const paidSoFar = fine.fine_payments.reduce((sum, item) => sum + normalizeMoney(item.amount), 0);
    const remaining = Math.max(0, normalizeMoney(fine.amount) - normalizeMoney(fine.waived_amount) - paidSoFar);
    const amount = normalizeMoney(intent.amount);

    if (amount > remaining + 0.0001) {
      // Fine was settled some other way (staff counter payment, waive) between
      // intent creation and VNPay confirming — fail safe, never push remaining negative.
      const updated = await tx.fine_payment_intents.update({
        where: { id: intent.id },
        data: { status: 'FAILED', vnp_response_code: 'STALE_INTENT', raw_return_params: verifiedParams, finalized_at: new Date() },
      });
      return { outcome: 'STALE_REMAINING_BALANCE', intent: updated };
    }

    const payment = await tx.fine_payments.create({
      data: {
        fine_id: fine.id,
        payment_method: 'VNPAY',
        amount,
        transaction_reference: vnpTransactionNo || txnRef,
        paid_by_user_id: null,
        note: `VNPay txn_ref ${txnRef}`,
      },
    });

    const stillRemaining = Math.max(0, remaining - amount);
    const nextStatus = stillRemaining <= 0 ? 'PAID' : 'PARTIALLY_PAID';

    const updatedFine = await tx.fines.update({
      where: { id: fine.id },
      data: { status: nextStatus, paid_at: stillRemaining <= 0 ? new Date() : null },
    });

    const totalFineBalance = await recomputeCustomerFineBalance(tx, fine.customer_id);

    await createNotificationRecord(tx, {
      customer_id: fine.customer_id,
      channel: 'IN_APP',
      template_code: 'FINE_PAYMENT_RECORDED',
      subject: 'Fine payment confirmed via VNPay',
      body: `Payment ${amount.toFixed(2)} has been applied to fine ${fine.id} via VNPay.`,
      reference_type: 'FINE',
      reference_id: fine.id,
      metadata: {
        fine_id: fine.id,
        payment_id: payment.id,
        amount,
        remaining_balance: normalizeMoney(stillRemaining),
        payment_method: 'VNPAY',
        vnp_transaction_no: vnpTransactionNo,
      },
      status: 'SENT',
    });

    await writeAuditLog(tx, {
      actor_user_id: null,
      action_name: 'CUSTOMER_PAY_FINE_VNPAY',
      entity_type: 'FINE',
      entity_id: fine.id,
      before_data: {
        status: fine.status,
        remaining_balance: normalizeMoney(remaining),
      },
      after_data: {
        status: updatedFine.status,
        remaining_balance: normalizeMoney(stillRemaining),
        total_fine_balance: totalFineBalance,
        payment_id: payment.id,
        amount,
        payment_method: 'VNPAY',
        vnp_transaction_no: vnpTransactionNo,
      },
    });

    const finalizedIntent = await tx.fine_payment_intents.update({
      where: { id: intent.id },
      data: {
        status: 'SUCCESS',
        vnp_response_code: responseCode,
        vnp_transaction_no: vnpTransactionNo,
        vnp_bank_code: vnpBankCode,
        fine_payment_id: payment.id,
        raw_return_params: verifiedParams,
        finalized_at: new Date(),
      },
    });

    return { outcome: 'SUCCESS', intent: finalizedIntent, payment, fine: updatedFine, totalFineBalance };
  });
}

module.exports = { finalizeVnpayPayment, VNPAY_SUCCESS_CODE };
