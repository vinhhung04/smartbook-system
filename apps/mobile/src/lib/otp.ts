import { ApiError } from '../api/client';
import type { OtpChallenge } from '../types/auth';

/**
 * What the code screen says about an auth-service OTP answer. The rules (5 minutes,
 * 5 tries, 60 s resend cooldown) are enforced on the server; this only words its
 * typed codes — the same wording as the web (apps/web/src/lib/otp.ts).
 */
export type OtpErrorView = {
  message: string;
  /** The challenge is over: only "log in again" is left. */
  closed: boolean;
  /** A fresh code is the way forward (expired / out of tries). */
  needsNewCode: boolean;
  /** The server's updated view of the challenge, when it sent one. */
  challenge: OtpChallenge | null;
};

export function describeOtpError(error: unknown): OtpErrorView {
  const status = error instanceof ApiError && error.kind === 'http' ? error.status : 0;
  const details = (error instanceof ApiError ? error.details : null) ?? {};
  const challenge = (details.challenge as OtpChallenge | undefined) ?? null;
  const view = (message: string, extra: Partial<OtpErrorView> = {}): OtpErrorView => ({ message, closed: false, needsNewCode: false, challenge, ...extra });

  if (status === 0) return view('Không kết nối được máy chủ SmartBook. Kiểm tra mạng rồi thử lại.');
  switch (error instanceof ApiError ? error.code : null) {
    case 'OTP_INVALID': {
      const left = Number(details.attempts_remaining);
      return view(Number.isFinite(left) && left > 0 ? `Mã không đúng. Bạn còn ${left} lần thử.` : 'Mã không đúng.');
    }
    case 'OTP_FORMAT':
      return view('Nhập đủ 6 chữ số của mã.');
    case 'OTP_EXPIRED':
      return view('Mã đã hết hạn. Bấm "Gửi lại mã" để nhận mã mới.', { needsNewCode: true });
    case 'OTP_TOO_MANY_ATTEMPTS':
      return view('Bạn đã nhập sai 5 lần. Bấm "Gửi lại mã" để nhận mã mới.', { needsNewCode: true });
    case 'OTP_CHALLENGE_INVALID':
      return view('Phiên xác thực đã kết thúc. Vui lòng đăng nhập lại để nhận mã mới.', { closed: true });
    case 'OTP_RESEND_COOLDOWN': {
      const wait = Number(details.retry_after_seconds);
      return view(Number.isFinite(wait) && wait > 0 ? `Vui lòng đợi ${wait} giây rồi gửi lại.` : 'Vui lòng đợi một chút rồi gửi lại.');
    }
    case 'OTP_SEND_LIMIT':
      return view('Bạn đã yêu cầu quá nhiều mã. Vui lòng thử lại sau khoảng một giờ.', { closed: true });
    case 'EMAIL_DELIVERY_UNAVAILABLE':
      return view('Chưa gửi được email lúc này. Vui lòng bấm "Gửi lại mã" sau ít phút.');
    case 'AUTH_STATE_UNAVAILABLE':
      return view('Máy chủ đang bận, chưa hoàn tất được đăng nhập. Vui lòng đăng nhập lại sau ít phút.', { closed: true });
    default:
      break;
  }
  if (status === 403) return view('Tài khoản đang bị khóa hoặc chưa được kích hoạt. Liên hệ quản trị viên.', { closed: true });
  if (status === 429) return view('Bạn thao tác quá nhanh. Vui lòng đợi một lúc rồi thử lại.');
  if (status >= 500) return view('Máy chủ đang gặp sự cố. Vui lòng thử lại sau ít phút.');
  return view('Chưa xác thực được mã. Vui lòng thử lại.');
}

/** Whole seconds left until `iso`, never negative. Wall-clock based, so it is right again after the app resumes. */
export function secondsUntil(iso: string | null | undefined, now: number): number {
  const at = Date.parse(String(iso || ''));
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
}

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Digits only, at most `length` — a pasted "123 456" still fills the code. */
export function normalizeOtpInput(raw: string, length = 6): string {
  return String(raw || '').replace(/\D/g, '').slice(0, length);
}
