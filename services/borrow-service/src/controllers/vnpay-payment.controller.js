const { prisma } = require('../lib/prisma');
const { ensureCurrentCustomer } = require('./customer.controller');
const { normalizeMoney } = require('../services/fine.service');
const { createFinePaymentIntent } = require('../services/fine-payment-intent.service');
const vnpayService = require('../services/vnpay.service');

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function createVnpayFinePayment(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy hồ sơ bạn đọc' });
    }

    const fineId = String(req.body?.fine_id || '').trim();
    if (!isUuid(fineId)) {
      return res.status(400).json({ message: 'fine_id phải là UUID hợp lệ' });
    }

    if (!vnpayService.getEnvConfig()) {
      return res.status(503).json({
        message: 'Cổng thanh toán VNPay chưa được cấu hình. Vui lòng thanh toán tại quầy thư viện hoặc thử lại sau.',
      });
    }

    const result = await createFinePaymentIntent(prisma, { customerId: customer.id, fineId, ipAddr: req.ip });
    return res.status(result.code).json(result.payload);
  } catch (error) {
    console.error('createVnpayFinePayment error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

async function getVnpayFinePaymentStatus(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy hồ sơ bạn đọc' });
    }

    const txnRef = String(req.params.txnRef || '').trim();
    const intent = await prisma.fine_payment_intents.findUnique({ where: { txn_ref: txnRef } });
    if (!intent || intent.customer_id !== customer.id) {
      return res.status(404).json({ message: 'Không tìm thấy giao dịch thanh toán' });
    }

    let status = intent.status;
    if (status === 'PENDING' && new Date() > intent.expires_at) {
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
