const crypto = require('crypto');
const { prisma } = require('../lib/prisma');
const { ensureCurrentCustomer } = require('./customer.controller');
const vnpayService = require('../services/vnpay.service');
const { toMoney, WALLET_TOPUP_AMOUNTS_VND, isAllowedTopupAmount } = require('../services/account.service');

const ALLOWED_AMOUNTS_TEXT = WALLET_TOPUP_AMOUNTS_VND.map((value) => `${value.toLocaleString('vi-VN')}đ`).join(', ');

// A reader tops up their own wallet online through VNPay. The wallet is credited only
// when VNPay's signed return/IPN callback confirms the payment (vnpay-webhook.controller),
// never from this request or from the browser coming back.

function generateTopupTxnRef() {
  const datePart = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `TU${datePart}${crypto.randomBytes(4).toString('hex')}`;
}

// POST /my/account/topups/vnpay/create { amount }
async function createVnpayTopup(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy hồ sơ bạn đọc' });
    }

    if (!isAllowedTopupAmount(req.body?.amount)) {
      return res.status(400).json({
        message: `Chỉ nạp được các mức: ${ALLOWED_AMOUNTS_TEXT}.`,
        code: 'INVALID_TOPUP_AMOUNT',
        allowed_amounts: WALLET_TOPUP_AMOUNTS_VND,
      });
    }
    const amount = toMoney(req.body.amount);

    if (!vnpayService.getEnvConfig()) {
      return res.status(503).json({
        message: 'Cổng thanh toán VNPay chưa được cấu hình. Vui lòng nạp tiền tại quầy thư viện hoặc thử lại sau.',
      });
    }

    const account = await prisma.customer_accounts.findUnique({ where: { customer_id: customer.id }, select: { status: true } });
    if (account && account.status !== 'ACTIVE') {
      return res.status(409).json({ message: 'Ví của bạn đang bị khóa, không thể nạp tiền.', code: 'ACCOUNT_NOT_ACTIVE' });
    }

    const txnRef = generateTopupTxnRef();
    const orderInfo = `Nap tien vi SmartBook ${customer.customer_code || customer.id}`;
    const { paymentUrl, expiresAt } = vnpayService.buildPaymentUrl({
      txnRef,
      amountVnd: amount.toNumber(),
      orderInfo,
      ipAddr: req.ip,
    });

    await prisma.wallet_topup_intents.create({
      data: {
        customer_id: customer.id,
        txn_ref: txnRef,
        amount: amount.toFixed(2),
        status: 'PENDING',
        vnp_order_info: orderInfo,
        expires_at: expiresAt,
      },
    });

    return res.status(201).json({
      message: 'Payment link created',
      data: { payment_url: paymentUrl, txn_ref: txnRef, amount: amount.toNumber(), expires_at: expiresAt },
    });
  } catch (error) {
    console.error('createVnpayTopup error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

// GET /my/account/topups/vnpay/status/:txnRef
async function getVnpayTopupStatus(req, res) {
  try {
    const customer = await ensureCurrentCustomer(req);
    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy hồ sơ bạn đọc' });
    }

    const txnRef = String(req.params.txnRef || '').trim();
    const intent = await prisma.wallet_topup_intents.findUnique({ where: { txn_ref: txnRef } });
    if (!intent || intent.customer_id !== customer.id) {
      return res.status(404).json({ message: 'Không tìm thấy giao dịch nạp tiền' });
    }

    // Reported as expired but not stored: a reader who paid just before the link expired
    // must still be credited when VNPay's IPN arrives late, and finalize only accepts PENDING.
    const status = intent.status === 'PENDING' && new Date() > intent.expires_at ? 'EXPIRED' : intent.status;

    return res.json({
      data: {
        status,
        amount: toMoney(intent.amount).toNumber(),
        vnp_transaction_no: intent.vnp_transaction_no,
        finalized_at: intent.finalized_at,
      },
    });
  } catch (error) {
    console.error('getVnpayTopupStatus error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

module.exports = { createVnpayTopup, getVnpayTopupStatus };
