const test = require('node:test');
const assert = require('node:assert/strict');
const vnpay = require('../src/services/vnpay.service');
let databaseCalls = 0;
const p = require.resolve('../src/lib/prisma');
require.cache[p] = { id: p, filename: p, loaded: true, exports: { prisma: {
  wallet_topup_intents: { findUnique: async () => { databaseCalls++; return null; } },
  $transaction: async () => { databaseCalls++; throw new Error('Unverified callback reached financial writes'); },
} } };
const { handleVnpayIpn, handleVnpayReturn } = require('../src/controllers/vnpay-webhook.controller');
test('public callback rejects signed contradictory status, wrong merchant and absent transaction number before database', async () => {
  const previousCode = process.env.VNPAY_TMN_CODE, previousSecret = process.env.VNPAY_HASH_SECRET;
  const merchant = 'isolated-merchant', secret = 'isolated-signature-fixture';
  process.env.VNPAY_TMN_CODE = merchant; process.env.VNPAY_HASH_SECRET = secret;
  try {
    const base = { vnp_TmnCode: merchant, vnp_TxnRef: 'isolated-transaction', vnp_ResponseCode: '00', vnp_TransactionStatus: '00', vnp_TransactionNo: '12345678', vnp_Amount: '5000000' };
    for (const extra of [{ vnp_TransactionStatus: '02' }, { vnp_TmnCode: 'another-merchant' }, { vnp_TransactionNo: '' }, { vnp_TransactionNo: '0' }]) {
      const signed = { ...base, ...extra }; signed.vnp_SecureHash = vnpay.sign(signed, secret);
      const res = { body: null, statusCode: 200, json(body) { this.body = body; return this; }, status(code) { this.statusCode = code; return this; }, setHeader() {}, send(body) { this.body = body; return this; } };
      await handleVnpayIpn({ query: signed }, res);
      assert.equal(res.body.RspCode, '97');
      await handleVnpayReturn({ query: signed }, res);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(databaseCalls, 0);
  } finally {
    if (previousCode == null) delete process.env.VNPAY_TMN_CODE; else process.env.VNPAY_TMN_CODE = previousCode;
    if (previousSecret == null) delete process.env.VNPAY_HASH_SECRET; else process.env.VNPAY_HASH_SECRET = previousSecret;
  }
});
