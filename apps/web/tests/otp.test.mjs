// Unit tests for the emailed-code step's presentation rules (src/lib/otp.ts).
// Run: pnpm --filter web test:unit (transpiled with Vite's esbuild, as in book-ocr.test.mjs).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const source = await readFile(new URL('../src/lib/otp.ts', import.meta.url), 'utf8');
const { code } = await transformWithEsbuild(source, 'otp.ts', { loader: 'ts', format: 'esm' });
const otp = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('wrong code says how many tries are left', () => {
  const view = otp.describeOtpError(400, { code: 'OTP_INVALID', attempts_remaining: 3 });
  assert.equal(view.message, 'Mã không đúng. Bạn còn 3 lần thử.');
  assert.equal(view.closed, false);
});

test('expired and exhausted codes point to a new code; a dead challenge closes the step', () => {
  assert.equal(otp.describeOtpError(410, { code: 'OTP_EXPIRED' }).needsNewCode, true);
  assert.equal(otp.describeOtpError(429, { code: 'OTP_TOO_MANY_ATTEMPTS' }).needsNewCode, true);
  const dead = otp.describeOtpError(410, { code: 'OTP_CHALLENGE_INVALID' });
  assert.equal(dead.closed, true);
  assert.match(dead.message, /đăng nhập lại/);
});

test('cooldown, delivery failure, network and generic rate limit', () => {
  assert.equal(otp.describeOtpError(429, { code: 'OTP_RESEND_COOLDOWN', retry_after_seconds: 42 }).message, 'Vui lòng đợi 42 giây rồi gửi lại.');
  assert.match(otp.describeOtpError(503, { code: 'EMAIL_DELIVERY_UNAVAILABLE' }).message, /Chưa gửi được email/);
  assert.match(otp.describeOtpError(0, null).message, /Không kết nối/);
  assert.match(otp.describeOtpError(429, { code: 'RATE_LIMITED' }).message, /quá nhanh/);
  assert.equal(otp.describeOtpError(403, { message: 'User is not active' }).closed, true);
});

test('countdown helpers', () => {
  const now = Date.parse('2026-10-29T08:00:00Z');
  assert.equal(otp.secondsUntil('2026-10-29T08:04:32Z', now), 272);
  assert.equal(otp.secondsUntil('2026-10-29T07:59:00Z', now), 0);
  assert.equal(otp.secondsUntil(null, now), 0);
  assert.equal(otp.formatCountdown(272), '4:32');
  assert.equal(otp.formatCountdown(5), '0:05');
});

test('pasted codes are reduced to their digits', () => {
  assert.equal(otp.normalizeOtpInput('123 456'), '123456');
  assert.equal(otp.normalizeOtpInput('Mã: 987-654-321'), '987654');
  assert.equal(otp.normalizeOtpInput('ab'), '');
});
