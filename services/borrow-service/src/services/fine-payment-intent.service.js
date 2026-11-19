const crypto = require('node:crypto');
const { lockCustomerFineBalance } = require('./fine-lock.service');
const { lockFineAccrual, refreshFineAccrual, normalizeMoney, recomputeCustomerFineBalance } = require('./fine.service');
const vnpay = require('./vnpay.service');

async function createFinePaymentIntent(prisma, { customerId, fineId, ipAddr }) {
  return prisma.$transaction(async tx => {
    await lockCustomerFineBalance(tx, customerId);
    let fine = await tx.fines.findUnique({ where: { id: fineId }, include: { fine_payments: true } });
    if (!fine || fine.customer_id !== customerId) return { code: 404, payload: { message: 'Không tìm thấy khoản phạt' } };
    await lockFineAccrual(tx, fineId);
    await refreshFineAccrual(tx, fine);
    await recomputeCustomerFineBalance(tx, customerId);
    fine = await tx.fines.findUnique({ where: { id: fineId }, include: { fine_payments: true } });
    const remaining = normalizeMoney(Number(fine.amount) - Number(fine.waived_amount)
      - fine.fine_payments.reduce((sum, p) => sum + Number(p.amount), 0));
    if (['PAID', 'WAIVED'].includes(fine.status) || remaining <= 0) return { code: 409, payload: { message: 'Khoản phạt đã được thanh toán đủ hoặc miễn' } };
    const pending = await tx.fine_payment_intents.findFirst({
      where: { fine_id: fineId, OR: [{ status: 'PROCESSING' }, { status: 'PENDING', expires_at: { gt: new Date() } }] },
      orderBy: { created_at: 'desc' },
    });
    if (pending) return { code: 409, payload: {
      message: 'Khoản phạt này đang có một giao dịch VNPay chờ xác nhận.', code: 'PAYMENT_PENDING',
      data: { txn_ref: pending.txn_ref, expires_at: pending.expires_at, amount: normalizeMoney(pending.amount) },
    } };
    // Expiry permits a replacement link, but never prevents a verified late receipt.
    await tx.fine_payment_intents.updateMany({ where: { fine_id: fineId, status: 'PENDING', expires_at: { lte: new Date() } }, data: { status: 'EXPIRED' } });
    const txnRef = `SB${crypto.randomBytes(16).toString('hex')}`;
    const orderInfo = `Thanh toan phi phat ${fineId}`;
    const { paymentUrl, expiresAt } = vnpay.buildPaymentUrl({ txnRef, amountVnd: remaining, orderInfo, ipAddr });
    await tx.fine_payment_intents.create({ data: { fine_id: fineId, customer_id: customerId, txn_ref: txnRef,
      amount: remaining, vnp_order_info: orderInfo, expires_at: expiresAt } });
    return { code: 201, payload: { message: 'Payment link created',
      data: { payment_url: paymentUrl, txn_ref: txnRef, amount: remaining, expires_at: expiresAt } } };
  });
}
module.exports = { createFinePaymentIntent };
