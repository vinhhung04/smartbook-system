const nodemailer = require("nodemailer");

// Same SMTP settings as auth-service / borrow-service (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
// SMTP_FROM). In local docker-compose these point at mailpit. Authentication is optional so the
// mailpit relay (no credentials) works.

let transporter = null;

function getTransporter() {
  const host = process.env.SMTP_HOST || "";
  if (!host) return null;
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = process.env.SMTP_USER || "";
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      ...(user ? { auth: { user, pass: process.env.SMTP_PASS || "" } } : {}),
    });
  }
  return transporter;
}

/**
 * Send one email and report the real outcome. "accepted" only means the SMTP relay accepted the
 * message — it is NOT proof of delivery to the mailbox or that anyone read it.
 * @returns {Promise<{ok: true, messageId: string|null} | {ok: false, error: string}>}
 */
async function sendMail({ to, subject, html, text }) {
  const transport = getTransporter();
  if (!transport) return { ok: false, error: "SMTP chưa được cấu hình (SMTP_HOST)" };
  try {
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || "SmartBook <noreply@smartbook.vn>",
      to,
      subject,
      html,
      text,
    });
    const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
    if (rejected.length > 0) return { ok: false, error: `SMTP từ chối người nhận: ${rejected.join(", ")}` };
    return { ok: true, messageId: info?.messageId || null };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 500) };
  }
}

function resetTransporterForTests() {
  transporter = null;
}

module.exports = { sendMail, resetTransporterForTests };
