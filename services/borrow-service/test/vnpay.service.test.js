const assert = require('node:assert/strict');
const test = require('node:test');
const crypto = require('node:crypto');
const vnpayService = require('../src/services/vnpay.service');

const TEST_CONFIG = {
  tmnCode: 'TESTTMN01',
  hashSecret: 'TEST_SECRET_DO_NOT_USE_IN_PROD',
  paymentUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  returnUrl: 'http://localhost:3000/webhooks/vnpay/return',
};

test('sign() matches an independently hand-built sign-data string (sorted keys, plain values)', () => {
  const params = { vnp_Amount: '10000000', vnp_Command: 'pay', vnp_TxnRef: 'TESTREF001' };
  const expectedSignData = 'vnp_Amount=10000000&vnp_Command=pay&vnp_TxnRef=TESTREF001';
  const expectedHash = crypto.createHmac('sha512', TEST_CONFIG.hashSecret)
    .update(Buffer.from(expectedSignData, 'utf-8')).digest('hex');
  assert.equal(vnpayService.sign(params, TEST_CONFIG.hashSecret), expectedHash);
});

test('sign() encodes spaces in values as "+" per VNPay convention (not %20)', () => {
  const params = { vnp_OrderInfo: 'Thanh toan phi phat' };
  const expectedSignData = `vnp_OrderInfo=${encodeURIComponent('Thanh toan phi phat').replace(/%20/g, '+')}`;
  const expectedHash = crypto.createHmac('sha512', TEST_CONFIG.hashSecret)
    .update(Buffer.from(expectedSignData, 'utf-8')).digest('hex');
  assert.equal(vnpayService.sign(params, TEST_CONFIG.hashSecret), expectedHash);
});

test('toVnpAmount multiplies whole-VND amounts by 100', () => {
  assert.equal(vnpayService.toVnpAmount(100000), 10000000);
});

test('toVnpAmount rejects a fractional-đồng amount', () => {
  assert.throws(() => vnpayService.toVnpAmount(100000.5));
});

test('toVnpAmount rejects a non-positive amount', () => {
  assert.throws(() => vnpayService.toVnpAmount(0));
  assert.throws(() => vnpayService.toVnpAmount(-500));
});

test('formatVnpDate renders Vietnam wall-clock time (UTC+7) regardless of server timezone', () => {
  const utcMidnight = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
  assert.equal(vnpayService.formatVnpDate(utcMidnight), '20260101070000');
});

test('buildPaymentUrl -> verifySignedParams round-trips successfully', () => {
  const { paymentUrl } = vnpayService.buildPaymentUrl({
    txnRef: 'RT001', amountVnd: 50000, orderInfo: 'Test payment', config: TEST_CONFIG,
  });
  const parsed = Object.fromEntries(new URL(paymentUrl).searchParams.entries());
  const result = vnpayService.verifySignedParams(parsed, TEST_CONFIG);
  assert.equal(result.valid, true);
  assert.equal(result.params.vnp_TxnRef, 'RT001');
});

test('verifySignedParams rejects a tampered amount', () => {
  const { paymentUrl } = vnpayService.buildPaymentUrl({
    txnRef: 'RT002', amountVnd: 50000, orderInfo: 'Test payment', config: TEST_CONFIG,
  });
  const parsed = Object.fromEntries(new URL(paymentUrl).searchParams.entries());
  parsed.vnp_Amount = '999999999';
  const result = vnpayService.verifySignedParams(parsed, TEST_CONFIG);
  assert.equal(result.valid, false);
});

test('verifySignedParams rejects a missing/blank secure hash', () => {
  const { paymentUrl } = vnpayService.buildPaymentUrl({
    txnRef: 'RT003', amountVnd: 50000, orderInfo: 'Test payment', config: TEST_CONFIG,
  });
  const parsed = Object.fromEntries(new URL(paymentUrl).searchParams.entries());
  delete parsed.vnp_SecureHash;
  const result = vnpayService.verifySignedParams(parsed, TEST_CONFIG);
  assert.equal(result.valid, false);
});

test('buildPaymentUrl throws a VNPAY_NOT_CONFIGURED error when no config/env is available', () => {
  const originalTmn = process.env.VNPAY_TMN_CODE;
  const originalSecret = process.env.VNPAY_HASH_SECRET;
  delete process.env.VNPAY_TMN_CODE;
  delete process.env.VNPAY_HASH_SECRET;
  try {
    assert.throws(
      () => vnpayService.buildPaymentUrl({ txnRef: 'RT004', amountVnd: 1000, orderInfo: 'x' }),
      (error) => error.code === 'VNPAY_NOT_CONFIGURED',
    );
  } finally {
    if (originalTmn !== undefined) process.env.VNPAY_TMN_CODE = originalTmn;
    if (originalSecret !== undefined) process.env.VNPAY_HASH_SECRET = originalSecret;
  }
});
