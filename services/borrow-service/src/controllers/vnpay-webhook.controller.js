const crypto = require('crypto');
const { prisma } = require('../lib/prisma');
const vnpayService = require('../services/vnpay.service');
const { finalizeVnpayPayment } = require('../services/vnpay-payment.service');
const { finalizeVnpayTopup } = require('../services/wallet-topup.service');

// One VNPay merchant serves two kinds of payment links: fines and wallet top-ups. The
// txn_ref says which one a callback is for; both return the same outcome names.
async function finalizeVnpayCallback(prismaClient, verifiedParams) {
  const txnRef = String(verifiedParams.vnp_TxnRef || '');
  const topup = txnRef
    ? await prismaClient.wallet_topup_intents.findUnique({ where: { txn_ref: txnRef }, select: { id: true } })
    : null;
  if (topup) {
    return { kind: 'TOPUP', ...(await finalizeVnpayTopup(prismaClient, verifiedParams)) };
  }
  return { kind: 'FINE', ...(await finalizeVnpayPayment(prismaClient, verifiedParams)) };
}

const FRONTEND_URL = String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

// Self-contained HTML served directly by borrow-service, not a redirect into
// the web SPA — this Return URL is opened by both the web app (full-page
// navigation) and mobile (system browser via Linking.openURL), and the SPA
// requires a login session a mobile-opened browser tab won't have.
function renderResultPage(status, detail = '', nonce = '') {
  const isSuccess = status === 'success';
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8" />
<title>${isSuccess ? 'Thanh toán thành công' : 'Thanh toán thất bại'}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style nonce="${nonce}">body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc}
.card{max-width:420px;padding:32px;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.08);background:#fff;text-align:center}
h1{font-size:20px;color:${isSuccess ? '#059669' : '#dc2626'}}
a{display:inline-block;margin-top:16px;color:#2563eb;text-decoration:none;font-weight:600}</style>
</head><body><div class="card">
<h1>${isSuccess ? 'Thanh toán thành công' : 'Thanh toán không thành công'}</h1>
<p>${detail || (isSuccess ? 'Khoản phạt của bạn đã được ghi nhận.' : 'Vui lòng thử lại hoặc thanh toán tại quầy thư viện.')}</p>
<a href="${FRONTEND_URL}/customer/fines?payment=${status}">Quay lại SmartBook</a>
</div></body></html>`;
}

// The service-wide CSP (default-src 'self') blocks the page's inline <style>, so the
// result page rendered unstyled. Only this response allows that one style block, by nonce.
function sendResultPage(res, httpStatus, status, detail = '') {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy', `default-src 'self'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
  return res.status(httpStatus).send(renderResultPage(status, detail, nonce));
}

async function handleVnpayReturn(req, res) {
  const verification = vnpayService.verifySignedParams(req.query);
  if (!verification.valid) {
    return sendResultPage(res, 400, 'failed', 'Chữ ký không hợp lệ.');
  }

  try {
    const result = await finalizeVnpayCallback(prisma, verification.params);
    const succeeded = result.outcome === 'SUCCESS' || (result.outcome === 'ALREADY_FINALIZED' && result.intent?.status === 'SUCCESS');
    const detail = result.kind === 'TOPUP'
      ? (succeeded ? 'Tiền đã được nạp vào ví của bạn.' : 'Chưa nạp được tiền vào ví. Vui lòng thử lại hoặc nạp tại quầy thư viện.')
      : '';
    return sendResultPage(res, 200, succeeded ? 'success' : 'failed', detail);
  } catch (error) {
    console.error('handleVnpayReturn error:', error);
    return sendResultPage(res, 500, 'failed', 'Đã có lỗi xảy ra, vui lòng liên hệ thư viện.');
  }
}

// VNPay's IPN notification is delivered as GET, with the same param set as
// the Return URL; the response contract is a fixed JSON {RspCode, Message}
// shape, NOT a redirect. "00" here means "we processed this notification
// correctly" — it is sent even when the underlying payment itself failed.
async function handleVnpayIpn(req, res) {
  const verification = vnpayService.verifySignedParams(req.query);
  if (!verification.valid) {
    return res.json({ RspCode: '97', Message: 'Invalid signature' });
  }

  try {
    const result = await finalizeVnpayCallback(prisma, verification.params);
    switch (result.outcome) {
      case 'NOT_FOUND':
        return res.json({ RspCode: '01', Message: 'Order not found' });
      case 'ALREADY_FINALIZED':
        return res.json({ RspCode: '02', Message: 'Order already confirmed' });
      case 'AMOUNT_MISMATCH':
        return res.json({ RspCode: '04', Message: 'Invalid amount' });
      case 'SUCCESS':
      case 'PAYMENT_FAILED':
      case 'STALE_REMAINING_BALANCE':
      case 'FINE_NOT_FOUND':
        return res.json({ RspCode: '00', Message: 'Confirm Success' });
      default:
        return res.json({ RspCode: '99', Message: 'Unknown error' });
    }
  } catch (error) {
    console.error('handleVnpayIpn error:', error);
    return res.json({ RspCode: '99', Message: 'Unknown error' });
  }
}

module.exports = { handleVnpayReturn, handleVnpayIpn, finalizeVnpayCallback };
