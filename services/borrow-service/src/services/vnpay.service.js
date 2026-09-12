const crypto = require('crypto');

const INTENT_TTL_MS = 15 * 60 * 1000;

function getEnvConfig() {
  const tmnCode = String(process.env.VNPAY_TMN_CODE || '').trim();
  const hashSecret = String(process.env.VNPAY_HASH_SECRET || '').trim();
  if (!tmnCode || !hashSecret) {
    return null;
  }
  return {
    tmnCode,
    hashSecret,
    paymentUrl: process.env.VNPAY_PAYMENT_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
    returnUrl: process.env.VNPAY_RETURN_URL || 'http://localhost:3000/webhooks/vnpay/return',
  };
}

function sortObject(obj) {
  const sorted = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

// VNPay requires the amount param as an integer = amount_in_VND * 100 (no decimals).
// Fine amounts in this system are always whole VND in practice; this asserts
// that explicitly since a silent x100-on-a-fractional-amount is the single
// most common real-world VNPay integration bug.
function toVnpAmount(vndAmount) {
  const numeric = Number(vndAmount);
  const whole = Math.round(numeric);
  if (!Number.isFinite(numeric) || whole <= 0) {
    throw new Error(`toVnpAmount: amount must be a positive finite number, got ${vndAmount}`);
  }
  if (Math.abs(numeric - whole) > 1e-6) {
    throw new Error(`toVnpAmount: fine amount ${vndAmount} has a fractional-đồng remainder; VNPay requires whole VND`);
  }
  return whole * 100;
}

// VNPay's documented signing rule: sort params by key, encode each value with
// encodeURIComponent then turn %20 into '+' (classic x-www-form-urlencoded
// space encoding), join as key=value&key=value. Express's query parser
// decodes '+' back to a space on the way in, mirroring this encode step, so
// verifySignedParams can rebuild the identical sign-data string.
function buildSignData(params) {
  const sorted = sortObject(params);
  const parts = [];
  for (const key of Object.keys(sorted)) {
    const value = sorted[key];
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${key}=${encodeURIComponent(String(value)).replace(/%20/g, '+')}`);
  }
  return parts.join('&');
}

function sign(params, hashSecret) {
  const signData = buildSignData(params);
  return crypto.createHmac('sha512', hashSecret).update(Buffer.from(signData, 'utf-8')).digest('hex');
}

// VNPay expects vnp_CreateDate/vnp_ExpireDate in Vietnam wall-clock time
// (UTC+7, no DST) regardless of the server's own timezone — containers
// default to UTC, so date.getHours() etc. would be 7 hours off.
function formatVnpDate(date) {
  const vnTime = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${vnTime.getUTCFullYear()}${pad(vnTime.getUTCMonth() + 1)}${pad(vnTime.getUTCDate())}${pad(vnTime.getUTCHours())}${pad(vnTime.getUTCMinutes())}${pad(vnTime.getUTCSeconds())}`;
}

function buildPaymentUrl({ txnRef, amountVnd, orderInfo, ipAddr, bankCode, config }) {
  const cfg = config || getEnvConfig();
  if (!cfg) {
    const err = new Error('VNPay is not configured');
    err.code = 'VNPAY_NOT_CONFIGURED';
    throw err;
  }

  const now = new Date();
  const params = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: cfg.tmnCode,
    vnp_Locale: 'vn',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: txnRef,
    vnp_OrderInfo: orderInfo,
    vnp_OrderType: 'other',
    vnp_Amount: String(toVnpAmount(amountVnd)),
    vnp_ReturnUrl: cfg.returnUrl,
    vnp_IpAddr: ipAddr || '127.0.0.1',
    vnp_CreateDate: formatVnpDate(now),
    vnp_ExpireDate: formatVnpDate(new Date(now.getTime() + INTENT_TTL_MS)),
    ...(bankCode ? { vnp_BankCode: bankCode } : {}),
  };

  const secureHash = sign(params, cfg.hashSecret);
  const sorted = sortObject(params);
  const encodedPairs = Object.keys(sorted)
    .filter((k) => sorted[k] !== undefined && sorted[k] !== null && sorted[k] !== '')
    .map((k) => `${k}=${encodeURIComponent(String(sorted[k])).replace(/%20/g, '+')}`);
  encodedPairs.push(`vnp_SecureHash=${secureHash}`);

  return {
    paymentUrl: `${cfg.paymentUrl}?${encodedPairs.join('&')}`,
    expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
  };
}

// Shared by both the return-URL handler and the IPN handler.
function verifySignedParams(queryParams, config) {
  const cfg = config || getEnvConfig();
  if (!cfg) {
    return { valid: false, reason: 'VNPAY_NOT_CONFIGURED', params: null };
  }

  const received = { ...queryParams };
  const receivedHash = received.vnp_SecureHash;
  delete received.vnp_SecureHash;
  delete received.vnp_SecureHashType;

  const expectedHash = sign(received, cfg.hashSecret);
  const a = Buffer.from(String(expectedHash).toLowerCase(), 'utf-8');
  const b = Buffer.from(String(receivedHash || '').toLowerCase(), 'utf-8');
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  return { valid, params: received };
}

module.exports = {
  getEnvConfig,
  sortObject,
  buildSignData,
  sign,
  toVnpAmount,
  formatVnpDate,
  buildPaymentUrl,
  verifySignedParams,
  INTENT_TTL_MS,
};
