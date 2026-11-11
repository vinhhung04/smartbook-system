#!/usr/bin/env node
// Local VNPay SIMULATOR for development and demos without VNPay sandbox credentials.
// It is NOT VNPay and never touches real money. It stands in for the VNPay payment
// page so the whole SmartBook flow (payment link -> pay/cancel -> IPN -> return page)
// can be exercised end to end:
//   - checks the vnp_SecureHash of the incoming payment link with VNPay's rule
//     (sorted keys, encodeURIComponent with %20 -> '+', HMAC-SHA512 with the hash secret);
//   - on "pay"/"cancel" it signs a VNPay-style result the same way, calls the IPN URL
//     server to server first, then redirects the browser to the return URL.
//
// Usage (root .env must hold the same VNPAY_TMN_CODE / VNPAY_HASH_SECRET as borrow-service,
// and VNPAY_PAYMENT_URL=http://localhost:8099/paymentv2/vpcpay.html):
//   node scripts/vnpay-simulator.mjs
// Switching to the real sandbox later only means replacing the four VNPAY_* values.

import 'dotenv/config';
import crypto from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.VNPAY_SIMULATOR_PORT || 8099);
const SECRET = String(process.env.VNPAY_HASH_SECRET || '').trim();
const TMN = String(process.env.VNPAY_TMN_CODE || '').trim();
if (!SECRET || !TMN) {
  console.error('VNPAY_TMN_CODE and VNPAY_HASH_SECRET must be set in .env (the same values borrow-service uses).');
  process.exit(1);
}

function signData(params) {
  return Object.keys(params).sort()
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${key}=${encodeURIComponent(String(params[key])).replace(/%20/g, '+')}`)
    .join('&');
}
const sign = (params) => crypto.createHmac('sha512', SECRET).update(Buffer.from(signData(params), 'utf-8')).digest('hex');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pending = new Map();

function page(res, status, body) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trình giả lập VNPay (thử nghiệm)</title>
<style>body{font-family:system-ui,sans-serif;background:#f1f5f9;margin:0;display:flex;justify-content:center;padding:40px 16px}
.card{background:#fff;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.08);max-width:440px;width:100%;padding:28px}
.banner{background:#fef3c7;color:#92400e;border-radius:10px;padding:10px 12px;font-size:13px;margin-bottom:18px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:14px}dt{color:#64748b}dd{margin:0;font-weight:600;text-align:right}
.ok{color:#047857}.bad{color:#b91c1c}.actions{display:flex;gap:10px;margin-top:22px}
a.btn{flex:1;text-align:center;padding:11px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px}
.pay{background:#1d4ed8;color:#fff}.cancel{background:#e2e8f0;color:#0f172a}</style></head><body><div class="card">
<div class="banner">TRÌNH GIẢ LẬP VNPay — chỉ dùng thử nghiệm cục bộ. Không phải cổng VNPay, không trừ tiền thật.</div>${body}</div></body></html>`);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const params = Object.fromEntries(url.searchParams);

  if (url.pathname === '/paymentv2/vpcpay.html') {
    const { vnp_SecureHash: hash, ...rest } = params;
    const signatureValid = Boolean(hash) && hash === sign(rest) && rest.vnp_TmnCode === TMN;
    const id = crypto.randomUUID();
    if (signatureValid) pending.set(id, rest);
    console.log(`[open] ${rest.vnp_TxnRef} ${Number(rest.vnp_Amount) / 100} VND signature=${signatureValid ? 'valid' : 'INVALID'}`);
    return page(res, signatureValid ? 200 : 400, `
<h2 style="margin:0 0 14px">Thanh toán đơn hàng</h2>
<dl><dt>Mã giao dịch</dt><dd id="txn">${escapeHtml(rest.vnp_TxnRef)}</dd>
<dt>Số tiền</dt><dd id="amount" data-vnd="${Number(rest.vnp_Amount) / 100}">${(Number(rest.vnp_Amount) / 100).toLocaleString('vi-VN')} VND</dd>
<dt>Nội dung</dt><dd>${escapeHtml(rest.vnp_OrderInfo)}</dd>
<dt>Chữ ký</dt><dd id="sig" class="${signatureValid ? 'ok' : 'bad'}">${signatureValid ? 'Hợp lệ' : 'Không hợp lệ'}</dd></dl>
${signatureValid ? `<div class="actions"><a id="pay" class="btn pay" href="/finish?id=${id}&code=00">Thanh toán (thẻ thử nghiệm)</a>
<a id="cancel" class="btn cancel" href="/finish?id=${id}&code=24">Hủy giao dịch</a></div>` : ''}`);
  }

  if (url.pathname === '/finish') {
    const request = pending.get(params.id);
    pending.delete(params.id);
    if (!request) return page(res, 410, '<p>Phiên thanh toán không còn hiệu lực.</p>');
    const code = params.code === '00' ? '00' : '24';
    const result = {
      vnp_Amount: request.vnp_Amount,
      vnp_BankCode: 'NCB',
      vnp_OrderInfo: request.vnp_OrderInfo,
      vnp_PayDate: new Date(Date.now() + 7 * 3600 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14),
      vnp_ResponseCode: code,
      vnp_TmnCode: request.vnp_TmnCode,
      vnp_TransactionNo: String(Date.now()).slice(-8),
      vnp_TransactionStatus: code,
      vnp_TxnRef: request.vnp_TxnRef,
    };
    const query = `${signData(result)}&vnp_SecureHash=${sign(result)}`;
    const ipnUrl = request.vnp_ReturnUrl.replace(/\/return(\?.*)?$/, '/ipn');
    const ipn = await fetch(`${ipnUrl}?${query}`).then((r) => r.json()).catch((error) => ({ error: error.message }));
    console.log(`[${code === '00' ? 'paid' : 'cancelled'}] ${request.vnp_TxnRef} IPN -> ${JSON.stringify(ipn)}`);
    res.writeHead(302, { location: `${request.vnp_ReturnUrl}?${query}` });
    return res.end();
  }

  res.writeHead(404);
  res.end();
}).listen(PORT, () => console.log(`VNPay simulator (test only) on http://localhost:${PORT}/paymentv2/vpcpay.html`));
