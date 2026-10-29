// Transactional email templates (lib/email-sender.js): escaping, the inline logo,
// and a plain-text part that still carries the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { EMAIL_TEMPLATES } = require('../src/lib/email-sender');

test('OTP email: subject, code in both parts, inline logo that exists', () => {
  const mail = EMAIL_TEMPLATES.EMAIL_OTP({ code: '482913', purpose: 'LOGIN_2FA', full_name: 'Hùng', ttl_minutes: 5 });
  assert.equal(mail.subject, '[SmartBook] Mã xác thực của bạn');
  assert.ok(mail.html.includes('482913'));
  assert.match(mail.text, /Mã xác thực: 482913/);
  assert.match(mail.html, /Mã đăng nhập của bạn/);
  const [logo] = mail.attachments;
  assert.ok(mail.html.includes(`cid:${logo.cid}`));
  assert.ok(fs.existsSync(logo.path), 'assets/email-logo.png must ship with the service');
});

test('verification email wording differs from the login one', () => {
  const mail = EMAIL_TEMPLATES.EMAIL_OTP({ code: '000001', purpose: 'EMAIL_VERIFICATION', full_name: 'Bạn đọc' });
  assert.match(mail.html, /Xác thực email/);
  assert.match(mail.html, /Hết hạn sau/);
});

test('untrusted values are escaped', () => {
  const otp = EMAIL_TEMPLATES.EMAIL_OTP({ code: '123456', purpose: 'LOGIN_2FA', full_name: '<img src=x onerror=alert(1)>' });
  assert.ok(!otp.html.includes('<img src=x'));
  assert.ok(otp.html.includes('&lt;img src=x onerror=alert(1)&gt;'));

  const reset = EMAIL_TEMPLATES.PASSWORD_RESET_REQUESTED({ full_name: 'A', reset_url: 'https://smartbook.io.vn/r?t="><script>' });
  assert.ok(!reset.html.includes('"><script>'));
  assert.match(reset.text, /https:\/\/smartbook\.io\.vn\/r\?t=/);
});
