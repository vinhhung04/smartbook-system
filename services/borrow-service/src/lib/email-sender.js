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
        <h1 style="margin:0;font-size:24px;">${headerEmoji} SmartBook Library</h1>
      </div>
      <div style="padding:24px 0;">
        ${bodyHtml}
        <p style="color:#94a3b8;font-size:12px;">Đây là email tự động từ hệ thống SmartBook.</p>
      </div>
    </div>`;
}

const EMAIL_TEMPLATES = {
  LOAN_DUE_REMINDER: (data) => ({
    subject: `[SmartBook] Nhắc nhở: Sách sắp đến hạn trả`,
    html: _emailWrapper('#6366f1,#8b5cf6', '📚', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Phiếu mượn <strong>${data.loan_number || ''}</strong> sẽ đến hạn trả vào <strong>${data.due_date || ''}</strong>.</p>
      <p>Vui lòng trả sách đúng hạn để tránh phạt quá hạn.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0;font-size:14px;color:#64748b;">Nếu cần gia hạn, hãy vào <strong>Customer Portal → Loans → Yêu cầu gia hạn</strong>.</p>
      </div>`),
  }),
  LOAN_OVERDUE: (data) => ({
    subject: `[SmartBook] ⚠️ Phiếu mượn quá hạn`,
    html: _emailWrapper('#ef4444,#f97316', '⚠️', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Phiếu mượn <strong>${data.loan_number || ''}</strong> đã <strong style="color:#ef4444;">quá hạn</strong>.</p>
      <p>Phạt quá hạn sẽ được tính theo ngày. Vui lòng trả sách sớm nhất có thể.</p>`),
  }),
  LOAN_CREATED: (data) => ({
    subject: `[SmartBook] ✅ Phiếu mượn đã tạo`,
    html: _emailWrapper('#6366f1,#8b5cf6', '📖', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Phiếu mượn <strong>${data.loan_number || ''}</strong> đã được tạo thành công.</p>
      <p>Hạn trả: <strong>${data.due_date || ''}</strong>. Chúc bạn đọc sách vui vẻ!</p>`),
  }),
  LOAN_RETURNED: (data) => ({
    subject: `[SmartBook] 📚 Trả sách thành công`,
    html: _emailWrapper('#10b981,#059669', '✅', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Phiếu mượn <strong>${data.loan_number || ''}</strong> đã được trả thành công. Cảm ơn bạn!</p>`),
  }),
  LOAN_RENEWAL_REQUEST: (data) => ({
    subject: `[SmartBook] Yêu cầu gia hạn đã gửi`,
    html: _emailWrapper('#6366f1,#8b5cf6', '📋', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Yêu cầu gia hạn phiếu mượn <strong>${data.loan_number || ''}</strong> đã được gửi. Vui lòng chờ admin duyệt.</p>`),
  }),
  LOAN_RENEWAL_REVIEWED: (data) => ({
    subject: `[SmartBook] Kết quả gia hạn phiếu mượn`,
    html: _emailWrapper('#6366f1,#8b5cf6', '📋', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Yêu cầu gia hạn phiếu mượn <strong>${data.loan_number || ''}</strong> đã được <strong>${data.decision === 'APPROVE' ? 'duyệt ✅' : 'từ chối ❌'}</strong>.</p>
      ${data.decision === 'APPROVE' ? `<p>Hạn trả mới: <strong>${data.new_due_date || ''}</strong></p>` : ''}`),
  }),
  RESERVATION_CREATED: (data) => ({
    subject: `[SmartBook] ✅ Đặt trước thành công`,
    html: _emailWrapper('#6366f1,#8b5cf6', '✅', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Đặt trước <strong>${data.reservation_number || ''}</strong> đã được xác nhận.</p>
      <p>Vui lòng đến nhận sách trước thời hạn để tránh hủy tự động.</p>`),
  }),
  RESERVATION_CONFIRMED: (data) => ({
    subject: `[SmartBook] ✅ Đặt trước đã xác nhận`,
    html: _emailWrapper('#6366f1,#8b5cf6', '✅', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Đặt trước <strong>${data.reservation_number || ''}</strong> đã được xác nhận.</p>
      <p>Vui lòng đến nhận sách trước thời hạn để tránh hủy tự động.</p>`),
  }),
  RESERVATION_CANCELLED: (data) => ({
    subject: `[SmartBook] ❌ Đặt trước đã hủy`,
    html: _emailWrapper('#ef4444,#f97316', '❌', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Đặt trước <strong>${data.reservation_number || ''}</strong> đã bị hủy.</p>`),
  }),
  FINE_CREATED: (data) => ({
    subject: `[SmartBook] 💰 Thông báo phạt`,
    html: _emailWrapper('#f59e0b,#d97706', '💰', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Bạn có khoản phạt mới: <strong>${data.amount || ''}</strong> cho phiếu mượn <strong>${data.loan_number || ''}</strong>.</p>
      <p>Vui lòng thanh toán tại quầy thư viện.</p>`),
  }),
  FINE_PAYMENT_RECORDED: (data) => ({
    subject: `[SmartBook] ✅ Thanh toán phạt thành công`,
    html: _emailWrapper('#10b981,#059669', '✅', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Thanh toán phạt <strong>${data.amount || ''}</strong> đã được ghi nhận. Cảm ơn bạn!</p>`),
  }),
  FINE_WAIVED: (data) => ({
    subject: `[SmartBook] Miễn phạt`,
    html: _emailWrapper('#6366f1,#8b5cf6', '🎉', `
      <p>Xin chào <strong>${data.customer_name || 'bạn'}</strong>,</p>
      <p>Khoản phạt của bạn đã được miễn. Cảm ơn bạn đã sử dụng thư viện!</p>`),
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
