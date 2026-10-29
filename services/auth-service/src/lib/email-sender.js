const path = require('path');
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

// ---- branded layout ------------------------------------------------------------
// Email clients ignore most CSS: tables + inline styles carry the design everywhere;
// the <style> block only adds mobile sizing and dark mode where it is supported
// (Apple Mail, iOS Mail, Outlook.com). Colors: assets/branding/brand-tokens.json.
// The logo travels as an inline (cid:) attachment, so it shows without image hosting.

const BRAND = {
  ink: '#1D1A4A',
  lamp: '#F6DFB4',
  indigo: '#4338CA',
  bronze: '#8A6A2F', // lamp darkened for text on white (lamp itself is never text on white)
  text: '#3D3A5C',
  muted: '#77748F',
  hairline: '#E8E6F0',
  canvas: '#F1F0F5',
  paper: '#FBF8F1',
  paperEdge: '#ECE3CF',
};
const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', 'Courier New', monospace";
const LOGO_CID = 'smartbook-logo@smartbook.io.vn';
const LOGO_ATTACHMENT = {
  filename: 'smartbook.png',
  path: path.join(__dirname, '..', '..', 'assets', 'email-logo.png'),
  cid: LOGO_CID,
};

/** "19:52 · 29/10/2026" in Vietnam time, for the "requested at" line. */
function vnTime(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', hour12: false,
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute} · ${parts.day}/${parts.month}/${parts.year}`;
}

/** The frame every SmartBook email shares. `bodyHtml` is markup built from escaped values. */
function brandedEmail({ preheader, eyebrow, title, bodyHtml }) {
  return `<!doctype html>
<html lang="vi" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&display=swap" rel="stylesheet">
<style>
  body { margin:0 !important; padding:0 !important; width:100% !important; }
  @media (max-width: 600px) {
    .sb-pad { padding-left:24px !important; padding-right:24px !important; }
    .sb-title { font-size:24px !important; }
    .sb-code { font-size:32px !important; letter-spacing:9px !important; padding-left:9px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .sb-bg { background:#0E0D22 !important; }
    .sb-card { background:#18163A !important; border-color:#2B2856 !important; }
    .sb-title, .sb-strong { color:#F3F1FF !important; }
    .sb-text { color:#C9C7E3 !important; }
    .sb-muted { color:#9592B8 !important; }
    .sb-eyebrow { color:${BRAND.lamp} !important; }
    .sb-panel { background:#221F4A !important; border-color:#3A3670 !important; }
    .sb-code { color:${BRAND.lamp} !important; }
    .sb-note { background:#1E1B44 !important; }
    .sb-rule { border-color:#2B2856 !important; }
    .sb-link { color:#A5B4FC !important; }
  }
</style>
</head>
<body class="sb-bg" style="margin:0;padding:0;background:${BRAND.canvas};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}${'&#8199;&#847;'.repeat(40)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sb-bg" style="background:${BRAND.canvas};">
  <tr><td align="center" style="padding:40px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sb-card" style="max-width:560px;background:#FFFFFF;border:1px solid ${BRAND.hairline};border-radius:20px;overflow:hidden;">
      <tr><td class="sb-pad" style="background:${BRAND.ink};padding:30px 44px;">
        <img src="cid:${LOGO_CID}" width="160" height="41" alt="SmartBook" style="display:block;border:0;outline:none;width:160px;height:41px;color:#FFFFFF;font-family:${SERIF};font-size:22px;">
      </td></tr>
      <tr><td style="height:3px;line-height:3px;font-size:0;background:${BRAND.lamp};">&nbsp;</td></tr>
      <tr><td class="sb-pad" style="padding:44px 44px 8px;font-family:${SANS};">
        <p class="sb-eyebrow" style="margin:0 0 12px;font-size:11px;font-weight:600;letter-spacing:2.4px;text-transform:uppercase;color:${BRAND.bronze};">${escapeHtml(eyebrow)}</p>
        <h1 class="sb-title" style="margin:0 0 24px;font-family:${SERIF};font-size:28px;line-height:1.25;font-weight:600;letter-spacing:-0.3px;color:${BRAND.ink};">${escapeHtml(title)}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td class="sb-pad" style="padding:8px 44px 36px;font-family:${SANS};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="sb-rule" style="border-top:1px solid ${BRAND.hairline};padding-top:22px;">
          <p class="sb-muted" style="margin:0 0 6px;font-size:12.5px;line-height:1.6;color:${BRAND.muted};"><strong class="sb-strong" style="color:${BRAND.ink};font-weight:600;">SmartBook</strong> &nbsp;·&nbsp; Thư viện thông minh &nbsp;·&nbsp; <a class="sb-link" href="https://smartbook.io.vn" style="color:${BRAND.indigo};text-decoration:none;">smartbook.io.vn</a></p>
          <p class="sb-muted" style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};">Email tự động, vui lòng không trả lời. SmartBook không bao giờ hỏi mã xác thực hay mật khẩu của bạn qua điện thoại, tin nhắn hoặc email.</p>
        </td></tr></table>
      </td></tr>
    </table>
    <p class="sb-muted" style="margin:20px 0 0;font-family:${SANS};font-size:11.5px;color:#A3A1B8;">© ${new Date().getFullYear()} SmartBook</p>
  </td></tr>
</table>
</body>
</html>`;
}

function paragraph(html, { last = false } = {}) {
  return `<p class="sb-text" style="margin:0 0 ${last ? 0 : 16}px;font-size:15px;line-height:1.65;color:${BRAND.text};">${html}</p>`;
}

function strong(text) {
  return `<strong class="sb-strong" style="color:${BRAND.ink};font-weight:600;">${escapeHtml(text)}</strong>`;
}

/** A quiet aside with a lamp rule on the left (security notes). */
function note(html) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 24px;"><tr>
    <td style="width:3px;background:${BRAND.lamp};border-radius:2px;font-size:0;">&nbsp;</td>
    <td class="sb-note sb-text" style="padding:14px 18px;background:#FAF9FC;font-size:13.5px;line-height:1.6;color:${BRAND.text};border-radius:0 10px 10px 0;">${html}</td>
  </tr></table>`;
}

const OTP_COPY = {
  EMAIL_VERIFICATION: {
    eyebrow: 'Xác thực email',
    title: 'Chào mừng bạn đến với SmartBook',
    intro: 'Cảm ơn bạn đã tạo tài khoản bạn đọc. Nhập mã dưới đây để xác thực địa chỉ email và kích hoạt tài khoản của bạn.',
    cautionLead: 'Không phải bạn?',
    caution: 'Nếu bạn không tạo tài khoản SmartBook, hãy bỏ qua email này — tài khoản sẽ không được kích hoạt.',
  },
  LOGIN_2FA: {
    eyebrow: 'Đăng nhập an toàn',
    title: 'Mã đăng nhập của bạn',
    intro: 'Có yêu cầu đăng nhập vào tài khoản SmartBook của bạn. Nhập mã dưới đây để hoàn tất đăng nhập.',
    cautionLead: 'Không phải bạn đăng nhập?',
    caution: 'Đừng chia sẻ mã này với ai. Ai đó có thể đã biết mật khẩu của bạn — hãy đổi mật khẩu ngay.',
  },
};

function otpEmail(data) {
  const copy = OTP_COPY[data.purpose] || OTP_COPY.EMAIL_VERIFICATION;
  const minutes = Number(data.ttl_minutes) || 5;
  const requestedAt = vnTime();
  const body = [
    paragraph(`Xin chào ${strong(data.full_name || 'bạn')},`),
    paragraph(escapeHtml(copy.intro), { last: true }),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;"><tr>
      <td align="center" class="sb-panel" style="background:${BRAND.paper};border:1px solid ${BRAND.paperEdge};border-radius:16px;padding:26px 16px 24px;">
        <p class="sb-muted" style="margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:2.4px;text-transform:uppercase;color:${BRAND.muted};">Mã xác thực</p>
        <p class="sb-code" style="margin:0;font-family:${MONO};font-size:40px;line-height:1.1;font-weight:700;letter-spacing:12px;padding-left:12px;color:${BRAND.ink};">${escapeHtml(data.code)}</p>
        <p class="sb-muted" style="margin:14px 0 0;font-size:13px;color:${BRAND.muted};">Hết hạn sau ${strong(`${minutes} phút`)} &nbsp;·&nbsp; Chỉ dùng một lần</p>
      </td></tr></table>`,
    `<p class="sb-muted" style="margin:14px 0 0;font-size:12.5px;text-align:center;color:${BRAND.muted};">Yêu cầu lúc ${escapeHtml(requestedAt)} (giờ Việt Nam)</p>`,
    note(`${strong(copy.cautionLead)} ${escapeHtml(copy.caution)}`),
  ].join('\n');

  const text = [
    `Xin chào ${data.full_name || 'bạn'},`,
    '',
    copy.intro,
    '',
    `Mã xác thực: ${data.code}`,
    `Mã có hiệu lực trong ${minutes} phút và chỉ dùng được một lần.`,
    `Yêu cầu lúc ${requestedAt} (giờ Việt Nam).`,
    '',
    `${copy.cautionLead} ${copy.caution}`,
    'SmartBook không bao giờ hỏi mã xác thực hay mật khẩu của bạn qua điện thoại, tin nhắn hoặc email.',
    '',
    'SmartBook — https://smartbook.io.vn',
  ].join('\n');

  return {
    subject: '[SmartBook] Mã xác thực của bạn',
    html: brandedEmail({
      preheader: `${data.code} là mã xác thực SmartBook của bạn, hết hạn sau ${minutes} phút.`,
      eyebrow: copy.eyebrow,
      title: copy.title,
      bodyHtml: body,
    }),
    text,
    attachments: [LOGO_ATTACHMENT],
  };
}

function passwordResetEmail(data) {
  const url = escapeHtml(data.reset_url);
  const body = [
    paragraph(`Xin chào ${strong(data.full_name || 'bạn')},`),
    paragraph('Chúng tôi vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản SmartBook của bạn. Bấm nút dưới đây để tạo mật khẩu mới.', { last: true }),
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;"><tr>
      <td style="border-radius:12px;background:${BRAND.ink};">
        <a href="${url}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">Đặt lại mật khẩu &rarr;</a>
      </td></tr></table>`,
    `<p class="sb-muted" style="margin:16px 0 0;font-size:12.5px;line-height:1.6;color:${BRAND.muted};">Liên kết có hiệu lực trong 1 giờ. Nếu nút không hoạt động, mở địa chỉ này:<br><a class="sb-link" href="${url}" style="color:${BRAND.indigo};word-break:break-all;">${url}</a></p>`,
    note(`${strong('Không phải bạn yêu cầu?')} Hãy bỏ qua email này — mật khẩu của bạn vẫn giữ nguyên.`),
  ].join('\n');

  return {
    subject: '[SmartBook] Yêu cầu đặt lại mật khẩu',
    html: brandedEmail({
      preheader: 'Đặt lại mật khẩu SmartBook của bạn — liên kết có hiệu lực trong 1 giờ.',
      eyebrow: 'Bảo mật tài khoản',
      title: 'Đặt lại mật khẩu',
      bodyHtml: body,
    }),
    text: [
      `Xin chào ${data.full_name || 'bạn'},`,
      '',
      'Chúng tôi vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản SmartBook của bạn.',
      `Đặt lại mật khẩu (hiệu lực 1 giờ): ${data.reset_url}`,
      '',
      'Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu của bạn vẫn giữ nguyên.',
      '',
      'SmartBook — https://smartbook.io.vn',
    ].join('\n'),
    attachments: [LOGO_ATTACHMENT],
  };
}

const EMAIL_TEMPLATES = {
  PASSWORD_RESET_REQUESTED: passwordResetEmail,
  EMAIL_OTP: otpEmail,
};

/** Sends or throws EmailDeliveryError: an SMTP refusal is never reported as sent. */
async function deliverEmail(to, templateCode, data) {
  const transport = getTransporter();
  if (!transport) throw new EmailDeliveryError('SMTP is not configured');
  if (!to) throw new EmailDeliveryError('No recipient');
  const templateFn = EMAIL_TEMPLATES[templateCode];
  if (!templateFn) throw new Error(`Unknown email template: ${templateCode}`);

  const { subject, html, text, attachments } = templateFn(data);
  try {
    const info = await transport.sendMail({ from: SMTP_FROM, to, subject, html, ...(text ? { text } : {}), ...(attachments ? { attachments } : {}) });
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
