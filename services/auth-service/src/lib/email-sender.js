const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'SmartBook Library <noreply@smartbook.io.vn>';

let transporter = null;

class EmailDeliveryError extends Error {}

function isEmailConfigured() {
  return Boolean(SMTP_HOST);
}

function getTransporter() {
  if (!SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      // No credentials for a local relay/catcher (Mailpit in docker-compose.yml).
      ...(SMTP_USER ? { auth: { user: SMTP_USER, pass: SMTP_PASS } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// Logs name the domain only: the full address is personal data.
function logRecipient(to) {
  const domain = String(to || '').split('@')[1];
  return domain ? `***@${domain}` : '***';
}

function _emailWrapper(headerBg, headerEmoji, bodyHtml) {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:linear-gradient(135deg,${headerBg});padding:24px;border-radius:12px;color:white;text-align:center;">
        <h1 style="margin:0;font-size:24px;">${headerEmoji} SmartBook</h1>
      </div>
      <div style="padding:24px 0;">
        ${bodyHtml}
        <p style="color:#94a3b8;font-size:12px;">Đây là email tự động từ hệ thống SmartBook.</p>
      </div>
    </div>`;
}

const OTP_PURPOSE_TEXT = {
  EMAIL_VERIFICATION: 'Bạn vừa tạo tài khoản bạn đọc SmartBook. Nhập mã dưới đây để xác thực địa chỉ email và kích hoạt tài khoản.',
  LOGIN_2FA: 'Có yêu cầu đăng nhập vào tài khoản SmartBook của bạn. Nhập mã dưới đây để hoàn tất đăng nhập.',
};

// Table layout and inline styles only: that is what Gmail, Outlook and mobile mail apps
// render consistently. Every value from outside is escaped.
function otpEmail(data) {
  const name = escapeHtml(data.full_name || 'bạn');
  const code = escapeHtml(data.code);
  const minutes = escapeHtml(data.ttl_minutes || 5);
  const purpose = escapeHtml(OTP_PURPOSE_TEXT[data.purpose] || OTP_PURPOSE_TEXT.EMAIL_VERIFICATION);
  const html = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Mã xác thực SmartBook</title></head>
<body style="margin:0;padding:0;background:#f4f3ee;">
<div style="display:none;max-height:0;overflow:hidden;">Mã xác thực SmartBook của bạn có hiệu lực trong ${minutes} phút.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3ee;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1d1a4a;">
      <tr><td style="background:#1d1a4a;padding:22px 28px;">
        <span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#ffffff;letter-spacing:-0.3px;">SmartBook</span>
        <span style="display:block;font-size:12px;color:#c7c4ef;margin-top:2px;">smartbook.io.vn</span>
      </td></tr>
      <tr><td style="padding:28px 28px 8px;">
        <p style="margin:0 0 12px;font-size:16px;">Xin chào <strong>${name}</strong>,</p>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#3f3d63;">${purpose}</p>
        <p style="margin:0 0 6px;font-size:13px;color:#6b6990;">Mã xác thực của bạn</p>
        <p style="margin:0 0 20px;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#1d1a4a;background:#f1f0fb;border-radius:12px;padding:14px 0;text-align:center;">${code}</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#3f3d63;">Mã có hiệu lực trong <strong>${minutes} phút</strong> và chỉ dùng được một lần. SmartBook sẽ không bao giờ hỏi mã này qua điện thoại hay tin nhắn.</p>
      </td></tr>
      <tr><td style="padding:0 28px 28px;">
        <p style="margin:0;padding:14px 16px;background:#fff7ed;border-radius:10px;font-size:13px;line-height:1.5;color:#7c2d12;">Nếu bạn không yêu cầu mã này, hãy bỏ qua email. Nếu bạn nhận được mã đăng nhập mà không hề đăng nhập, hãy đổi mật khẩu ngay — có thể ai đó đã biết mật khẩu của bạn.</p>
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #ecebf5;font-size:12px;color:#8b89a8;">Email tự động từ SmartBook — https://smartbook.io.vn. Vui lòng không trả lời email này.</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
  const text = [
    `Xin chào ${data.full_name || 'bạn'},`,
    '',
    OTP_PURPOSE_TEXT[data.purpose] || OTP_PURPOSE_TEXT.EMAIL_VERIFICATION,
    '',
    `Mã xác thực: ${data.code}`,
    `Mã có hiệu lực trong ${data.ttl_minutes || 5} phút và chỉ dùng được một lần.`,
    '',
    'Nếu bạn không yêu cầu mã này, hãy bỏ qua email. Nếu bạn nhận được mã đăng nhập mà không hề đăng nhập, hãy đổi mật khẩu ngay.',
    '',
    'SmartBook — https://smartbook.io.vn',
  ].join('\n');
  return { subject: '[SmartBook] Mã xác thực của bạn', html, text };
}

const EMAIL_TEMPLATES = {
  PASSWORD_RESET_REQUESTED: (data) => ({
    subject: `[SmartBook] Yêu cầu đặt lại mật khẩu`,
    html: _emailWrapper('#6366f1,#8b5cf6', '🔒', `
      <p>Xin chào <strong>${escapeHtml(data.full_name || 'bạn')}</strong>,</p>
      <p>Chúng tôi vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${escapeHtml(data.reset_url)}" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Đặt lại mật khẩu</a>
      </p>
      <p style="color:#64748b;font-size:13px;">Liên kết này có hiệu lực trong 1 giờ. Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>`),
  }),
  EMAIL_OTP: otpEmail,
};

/** Sends or throws EmailDeliveryError: an SMTP refusal is never reported as sent. */
async function deliverEmail(to, templateCode, data) {
  const transport = getTransporter();
  if (!transport) throw new EmailDeliveryError('SMTP is not configured');
  if (!to) throw new EmailDeliveryError('No recipient');
  const templateFn = EMAIL_TEMPLATES[templateCode];
  if (!templateFn) throw new Error(`Unknown email template: ${templateCode}`);

  const { subject, html, text } = templateFn(data);
  try {
    const info = await transport.sendMail({ from: SMTP_FROM, to, subject, html, ...(text ? { text } : {}) });
    if (Array.isArray(info?.rejected) && info.rejected.length) {
      throw new EmailDeliveryError('Recipient rejected by the SMTP server');
    }
    console.log(`[EMAIL] Sent ${templateCode} to ${logRecipient(to)}`);
  } catch (err) {
    console.error(`[EMAIL] Failed to send ${templateCode} to ${logRecipient(to)}: ${err.message}`);
    throw err instanceof EmailDeliveryError ? err : new EmailDeliveryError(err.message);
  }
}

/** Fire-and-forget variant for mail whose failure must not change the response (password reset). */
async function sendEmail(to, templateCode, data) {
  try {
    await deliverEmail(to, templateCode, data);
    return true;
  } catch (_err) {
    return false;
  }
}

module.exports = { sendEmail, deliverEmail, isEmailConfigured, EmailDeliveryError, EMAIL_TEMPLATES, escapeHtml };
