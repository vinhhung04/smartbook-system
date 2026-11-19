const { createNotificationRecord } = require('../lib/notifications');
const { writeAuditLog } = require('../lib/audit');
const { normalizeMoney, recomputeCustomerFineBalance, lockFineAccrual, refreshFineAccrual } = require('./fine.service');
const { lockCustomerFineBalance } = require('./fine-lock.service');

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
    let intent = await tx.fine_payment_intents.findUnique({ where: { txn_ref: txnRef } });
    if (!intent) {
      return { outcome: 'NOT_FOUND' };
    }

    // Customer is always first, including callbacks for distinct intents/fines.
    // An expired/failed local intent is not evidence that the provider took no money.
    await lockCustomerFineBalance(tx, intent.customer_id);
    intent = await tx.fine_payment_intents.findUnique({ where: { txn_ref: txnRef } });
    const providerSucceeded = responseCode === VNPAY_SUCCESS_CODE
      && (verifiedParams.vnp_TransactionStatus == null || String(verifiedParams.vnp_TransactionStatus) === '00');
    if (vnpAmount !== Math.round(normalizeMoney(intent.amount) * 100)) return { outcome: 'AMOUNT_MISMATCH', intent };
    if (intent.status === 'SUCCESS' && providerSucceeded && intent.vnp_transaction_no !== vnpTransactionNo) return { outcome: 'TRANSACTION_CONFLICT', intent };
    if (intent.status === 'SUCCESS' || (intent.status !== 'PENDING' && !providerSucceeded)) {
      return { outcome: 'ALREADY_FINALIZED', intent,
        settlement: intent.status === 'SUCCESS' ? await tx.provider_payment_settlements.findUnique({ where: { intent_id: intent.id } }) : null };
    }
    if (providerSucceeded && (!vnpTransactionNo || vnpTransactionNo === '0')) return { outcome: 'INVALID_TRANSACTION', intent };

    // Atomically claim the intent before doing any work: the Return-URL handler and the IPN
    // handler can legitimately race to finalize the same txn_ref (see comment above). An
    // UPDATE ... WHERE status = the observed status takes a row lock, so a concurrent claim blocks until
    // this transaction commits, then correctly sees 0 rows matched instead of double-processing
    // the same payment (mirrors claimDraftReceiptForPosting in goods-receipt-posting.service.js).
    const claim = await tx.fine_payment_intents.updateMany({
      where: { id: intent.id, status: intent.status },
      data: { status: 'PROCESSING' },
    });
    if (claim.count !== 1) {
      const current = await tx.fine_payment_intents.findUnique({ where: { id: intent.id } });
      return { outcome: 'ALREADY_FINALIZED', intent: current };
    }

    if (!providerSucceeded) {
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

    // Provider transaction identity cannot be assigned to two local intents.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`provider-payment:VNPAY:${vnpTransactionNo}`}, 0))`;
    const duplicateTransaction = await tx.provider_payment_settlements.findUnique({
      where: { provider_provider_transaction_no: { provider: 'VNPAY', provider_transaction_no: vnpTransactionNo } },
    });
    if (duplicateTransaction) {
      // Undo the temporary claim; do not acknowledge an unallocated second receipt.
      await tx.fine_payment_intents.update({ where: { id: intent.id }, data: { status: intent.status } });
      return { outcome: 'TRANSACTION_CONFLICT', intent };
    }

    // Row-lock the fine: a counter payment or a deposit settlement for the same fine
    // waits until this one commits, so the remaining balance below cannot go stale.
    await lockFineAccrual(tx, intent.fine_id);
    await tx.$executeRaw`SELECT id FROM fines WHERE id = ${intent.fine_id}::uuid FOR UPDATE`;
    let fine = await tx.fines.findUnique({ where: { id: intent.fine_id }, include: { fine_payments: true } });
    if (!fine) {
      const updated = await tx.fine_payment_intents.update({
        where: { id: intent.id },
        data: { status: 'FAILED', vnp_response_code: responseCode, raw_return_params: verifiedParams, finalized_at: new Date() },
      });
      return { outcome: 'FINE_NOT_FOUND', intent: updated };
    }

    await refreshFineAccrual(tx, fine);
    fine = await tx.fines.findUnique({ where: { id: intent.fine_id }, include: { fine_payments: true } });

    const paidSoFar = fine.fine_payments.reduce((sum, item) => sum + normalizeMoney(item.amount), 0);
    const remaining = ['PAID', 'WAIVED'].includes(fine.status) ? 0
      : Math.max(0, normalizeMoney(fine.amount) - normalizeMoney(fine.waived_amount) - paidSoFar);
    const receivedAmount = normalizeMoney(intent.amount);
    const amount = Math.min(receivedAmount, remaining);
    const unappliedAmount = normalizeMoney(receivedAmount - amount);

    const payment = amount > 0 ? await tx.fine_payments.create({
      data: {
        fine_id: fine.id,
        payment_method: 'VNPAY',
        amount,
        transaction_reference: vnpTransactionNo || txnRef,
        paid_by_user_id: null,
        note: `VNPay txn_ref ${txnRef}`,
      },
    }) : null;

    const settlement = await tx.provider_payment_settlements.create({ data: {
      intent_id: intent.id, provider: 'VNPAY', txn_ref: txnRef, provider_transaction_no: vnpTransactionNo,
      customer_id: intent.customer_id, fine_id: fine.id, fine_payment_id: payment?.id || null,
      received_amount: receivedAmount, applied_amount: amount, unapplied_amount: unappliedAmount,
      raw_callback: verifiedParams,
    } });
    if (unappliedAmount > 0) await tx.integration_outbox.create({ data: {
      aggregate_type: 'PROVIDER_PAYMENT_SETTLEMENT', aggregate_id: settlement.id,
      event_type: 'PAYMENT_UNAPPLIED', payload: { settlement_id: settlement.id, intent_id: intent.id,
        fine_id: fine.id, customer_id: fine.customer_id, received_amount: receivedAmount, unapplied_amount: unappliedAmount },
    } });

    const stillRemaining = Math.max(0, remaining - amount);
    const nextStatus = stillRemaining <= 0 ? 'PAID' : 'PARTIALLY_PAID';

    const updatedFine = amount > 0 ? await tx.fines.update({
      where: { id: fine.id },
      data: { status: nextStatus, paid_at: stillRemaining <= 0 ? new Date() : null },
    }) : fine;

    const totalFineBalance = await recomputeCustomerFineBalance(tx, fine.customer_id);

    await createNotificationRecord(tx, {
      customer_id: fine.customer_id,
      channel: 'IN_APP',
      template_code: 'FINE_PAYMENT_RECORDED',
      subject: 'Thanh toán tiền phạt qua VNPay thành công',
      body: `Đã nhận ${receivedAmount.toLocaleString('vi-VN')}đ qua VNPay, áp dụng ${amount.toLocaleString('vi-VN')}đ vào khoản phạt.${unappliedAmount > 0 ? ` Còn ${unappliedAmount.toLocaleString('vi-VN')}đ chờ đối soát; không cần thanh toán lại khoản này.` : ''}`,
      reference_type: 'FINE',
      reference_id: fine.id,
      metadata: {
        fine_id: fine.id,
        payment_id: payment?.id || null,
        settlement_id: settlement.id, received_amount: receivedAmount, unapplied_amount: unappliedAmount,
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
        payment_id: payment?.id || null,
        settlement_id: settlement.id, received_amount: receivedAmount, unapplied_amount: unappliedAmount,
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
        fine_payment_id: payment?.id || null,
        raw_return_params: verifiedParams,
        finalized_at: new Date(),
      },
    });

    return { outcome: 'SUCCESS', intent: finalizedIntent, payment, settlement, fine: updatedFine, totalFineBalance };
  });
}

module.exports = { finalizeVnpayPayment, VNPAY_SUCCESS_CODE };
