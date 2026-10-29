import { ApiError } from '../api/client';
import { describeOtpError, formatCountdown, normalizeOtpInput, secondsUntil } from './otp';

const httpError = (status: number, code: string, details: Record<string, unknown> = {}) =>
  new ApiError(status, 'x', 'http', false, code, { code, ...details });

describe('describeOtpError', () => {
  it('says how many tries are left after a wrong code', () => {
    expect(describeOtpError(httpError(400, 'OTP_INVALID', { attempts_remaining: 2 })).message).toBe('Mã không đúng. Bạn còn 2 lần thử.');
  });

  it('points expired and exhausted codes to a new code, and closes a dead challenge', () => {
    expect(describeOtpError(httpError(410, 'OTP_EXPIRED')).needsNewCode).toBe(true);
    expect(describeOtpError(httpError(429, 'OTP_TOO_MANY_ATTEMPTS')).needsNewCode).toBe(true);
    expect(describeOtpError(httpError(410, 'OTP_CHALLENGE_INVALID')).closed).toBe(true);
  });

  it('passes on the refreshed challenge the server sent', () => {
    const challenge = { id: 'c', attempts_remaining: 3 };
    expect(describeOtpError(httpError(400, 'OTP_INVALID', { challenge })).challenge).toEqual(challenge);
  });

  it('handles cooldown, mail outage and a dropped network', () => {
    expect(describeOtpError(httpError(429, 'OTP_RESEND_COOLDOWN', { retry_after_seconds: 30 })).message).toBe('Vui lòng đợi 30 giây rồi gửi lại.');
    expect(describeOtpError(httpError(503, 'EMAIL_DELIVERY_UNAVAILABLE')).message).toMatch(/Chưa gửi được email/);
    expect(describeOtpError(new ApiError(0, 'offline', 'network')).message).toMatch(/Không kết nối/);
  });
});

describe('countdown and input helpers', () => {
  it('counts down from server instants', () => {
    const now = Date.parse('2026-10-29T08:00:00Z');
    expect(secondsUntil('2026-10-29T08:01:30Z', now)).toBe(90);
    expect(secondsUntil('2026-10-29T07:00:00Z', now)).toBe(0);
    expect(formatCountdown(90)).toBe('1:30');
  });

  it('keeps only the digits of a pasted code', () => {
    expect(normalizeOtpInput('123 456')).toBe('123456');
    expect(normalizeOtpInput('1234567')).toBe('123456');
  });
});
