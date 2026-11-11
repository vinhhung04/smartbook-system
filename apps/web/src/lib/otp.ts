/**
 * Presentation rules for the emailed-code step. The rules themselves (expiry, five
 * attempts, 60 s resend cooldown) live in auth-service; this only turns its typed
 * answers into what the page says and allows next.
 */

export interface OtpErrorBody {
  code?: string;
  message?: string;
  attempts_remaining?: number;
  retry_after_seconds?: number;
}

export interface OtpErrorView {
  message: string;
  /** The challenge is over: only "start again" is left (no resend, no input). */
  closed: boolean;
  /** A new code is the way forward (expired / out of attempts). */
  needsNewCode: boolean;
}

/** `status` is the HTTP status, 0 when no response came back. */
export function describeOtpError(status: number, body: OtpErrorBody | null | undefined): OtpErrorView {
  const code = body?.code;
  const view = (message: string, extra: Partial<OtpErrorView> = {}): OtpErrorView => ({ message, closed: false, needsNewCode: false, ...extra });
  if (status === 0) return view('Không kết nối được máy chủ. Kiểm tra kết nối mạng rồi thử lại.');
  switch (code) {
    case 'OTP_INVALID': {
      const left = Number(body?.attempts_remaining);
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
      const wait = Number(body?.retry_after_seconds);
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

/** Whole seconds left until `iso`, never negative. */
export function secondsUntil(iso: string | null | undefined, now: number): number {
  const at = Date.parse(String(iso || ''));
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
}

/** 272 -> "4:32" */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Digits only, at most `length` (a pasted "123 456" or "Mã: 123456" still works). */
export function normalizeOtpInput(raw: string, length = 6): string {
  return String(raw || '').replace(/\D/g, '').slice(0, length);
}

/** Title and subtitle for the page that shows the code step. */
export function otpStepCopy(purpose: 'EMAIL_VERIFICATION' | 'LOGIN_2FA', maskedEmail: string) {
  return purpose === 'LOGIN_2FA'
    ? { title: 'Nhập mã đăng nhập', subtitle: `Để bảo vệ tài khoản, chúng tôi vừa gửi mã 6 chữ số tới ${maskedEmail}.` }
    : { title: 'Xác thực email của bạn', subtitle: `Chúng tôi vừa gửi mã 6 chữ số tới ${maskedEmail}. Nhập mã để kích hoạt tài khoản.` };
}
