const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'SmartBook Library <noreply@smartbook.vn>';

let transporter = null;

function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
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

const EMAIL_TEMPLATES = {
  PASSWORD_RESET_REQUESTED: (data) => ({
    subject: `[SmartBook] Yêu cầu đặt lại mật khẩu`,
    html: _emailWrapper('#6366f1,#8b5cf6', '🔒', `
      <p>Xin chào <strong>${data.full_name || 'bạn'}</strong>,</p>
      <p>Chúng tôi vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.</p>
      <p style="text-align:center;margin:24px 0;">
        <a href="${data.reset_url}" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Đặt lại mật khẩu</a>
      </p>
      <p style="color:#64748b;font-size:13px;">Liên kết này có hiệu lực trong 1 giờ. Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.</p>`),
  }),
};

async function sendEmail(to, templateCode, data) {
  const transport = getTransporter();
  if (!transport || !to) return false;

  const templateFn = EMAIL_TEMPLATES[templateCode];
  if (!templateFn) return false;

  try {
    const { subject, html } = templateFn(data);
    await transport.sendMail({ from: SMTP_FROM, to, subject, html });
    console.log(`[EMAIL] Sent ${templateCode} to ${to}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL] Failed to send ${templateCode} to ${to}:`, err.message);
    return false;
  }
}

module.exports = { sendEmail, EMAIL_TEMPLATES };
