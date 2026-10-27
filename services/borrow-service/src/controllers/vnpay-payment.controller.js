const crypto = require('crypto');
const { prisma } = require('../lib/prisma');
const { ensureCurrentCustomer } = require('./customer.controller');
const { normalizeMoney } = require('../services/fine.service');
const vnpayService = require('../services/vnpay.service');

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function generateTxnRef() {
  const datePart = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const randomPart = crypto.randomBytes(4).toString('hex');
  return `SB${datePart}${randomPart}`;
}

async function createVnpayFinePayment(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const fineId = String(req.body?.fine_id || '').trim();
    if (!isUuid(fineId)) {
      return res.status(400).json({ message: 'fine_id must be a valid uuid' });
    }

    if (!vnpayService.getEnvConfig()) {
      return res.status(503).json({
        message: 'Cổng thanh toán VNPay chưa được cấu hình. Vui lòng thanh toán tại quầy thư viện hoặc thử lại sau.',
      });
    }

    const fine = await prisma.fines.findUnique({ where: { id: fineId }, include: { fine_payments: true } });
    if (!fine || fine.customer_id !== customer.id) {
      return res.status(404).json({ message: 'Fine not found' });
    }
    if (fine.status === 'PAID' || fine.status === 'WAIVED') {
      return res.status(409).json({ message: `Cannot pay fine with status ${fine.status}` });
    }

    const paidSoFar = fine.fine_payments.reduce((sum, item) => sum + normalizeMoney(item.amount), 0);
    const remaining = Math.max(0, normalizeMoney(fine.amount) - normalizeMoney(fine.waived_amount) - paidSoFar);
    if (remaining <= 0) {
      return res.status(409).json({ message: 'Fine is already fully settled' });
    }

    // One live payment per fine. If the reader already paid an earlier link that VNPay
    // has not confirmed yet, a second link would be paid too and then rejected as
    // STALE_INTENT by finalizeVnpayPayment — money taken, nothing recorded. Make them
    // wait for the first link to be confirmed or to expire (INTENT_TTL_MS) instead.
    const pendingIntent = await prisma.fine_payment_intents.findFirst({
      where: { fine_id: fine.id, status: { in: ['PENDING', 'PROCESSING'] }, expires_at: { gt: new Date() } },
      orderBy: { created_at: 'desc' },
      select: { txn_ref: true, expires_at: true, amount: true, status: true },
    });
    if (pendingIntent) {
      return res.status(409).json({
        message: 'Khoản phạt này đang có một giao dịch VNPay chờ xác nhận. Nếu bạn đã thanh toán, vui lòng đợi hệ thống xác nhận; nếu chưa, hãy thử lại sau khi giao dịch cũ hết hạn.',
        code: 'PAYMENT_PENDING',
        data: {
          txn_ref: pendingIntent.txn_ref,
          expires_at: pendingIntent.expires_at,
          amount: normalizeMoney(pendingIntent.amount),
        },
      });
    }

    const txnRef = generateTxnRef();
    const orderInfo = `Thanh toan phi phat ${fine.id}`;
    const { paymentUrl, expiresAt } = vnpayService.buildPaymentUrl({
      txnRef,
      amountVnd: remaining,
      orderInfo,
      ipAddr: req.ip,
    });

    await prisma.fine_payment_intents.create({
      data: {
        fine_id: fine.id,
        customer_id: customer.id,
        txn_ref: txnRef,
        amount: remaining,
        status: 'PENDING',
        vnp_order_info: orderInfo,
        expires_at: expiresAt,
      },
    });

    return res.status(201).json({
      message: 'Payment link created',
      data: { payment_url: paymentUrl, txn_ref: txnRef, amount: remaining, expires_at: expiresAt },
    });
  } catch (error) {
    console.error('createVnpayFinePayment error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getVnpayFinePaymentStatus(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Customer profile not found' });
    }

    const txnRef = String(req.params.txnRef || '').trim();
    const intent = await prisma.fine_payment_intents.findUnique({ where: { txn_ref: txnRef } });
    if (!intent || intent.customer_id !== customer.id) {
      return res.status(404).json({ message: 'Payment intent not found' });
    }

    let status = intent.status;
    if (status === 'PENDING' && new Date() > intent.expires_at) {
      await prisma.fine_payment_intents.update({ where: { id: intent.id }, data: { status: 'EXPIRED' } });
      status = 'EXPIRED';
    }

    return res.json({
      data: {
        status,
        fine_id: intent.fine_id,
        amount: normalizeMoney(intent.amount),
        vnp_transaction_no: intent.vnp_transaction_no,
        finalized_at: intent.finalized_at,
      },
    });
  } catch (error) {
    console.error('getVnpayFinePaymentStatus error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = { createVnpayFinePayment, getVnpayFinePaymentStatus };
