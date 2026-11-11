import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import axios from 'axios';
import { Loader2, MailCheck } from 'lucide-react';
import { authService, type OtpChallenge } from '@/services/auth';
import { describeOtpError, formatCountdown, normalizeOtpInput, secondsUntil, type OtpErrorBody, type OtpErrorView } from '@/lib/otp';
import { cn } from '@/components/ui/utils';
import { AuthFormAlert, AuthSubmitButton } from './auth-fields';
import { useAuthTone } from './auth-tone';

function readError(error: unknown): { status: number; body: (OtpErrorBody & { challenge?: OtpChallenge }) | null } {
  if (axios.isAxiosError(error)) return { status: error.response?.status ?? 0, body: error.response?.data ?? null };
  return { status: 0, body: null };
}

interface OtpCodeInputProps {
  id: string;
  value: string;
  length: number;
  onChange: (value: string) => void;
  invalid: boolean;
  disabled: boolean;
  describedBy?: string;
  inputRef: RefObject<HTMLInputElement>;
}

/**
 * One real <input> (numeric keyboard, paste, one-time-code autofill, a single field
 * for screen readers) laid over six boxes that only draw what it holds.
 */
function OtpCodeInput({ id, value, length, onChange, invalid, disabled, describedBy, inputRef }: OtpCodeInputProps) {
  const tone = useAuthTone();
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, length - 1);
  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        value={value}
        onChange={(event) => onChange(normalizeOtpInput(event.target.value, length))}
        // keep the caret at the end: the boxes show no caret anywhere else
        onSelect={(event) => event.currentTarget.setSelectionRange(value.length, value.length)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        // no maxLength: the browser would cut a pasted "123 456" to "123 45" before
        // normalizeOtpInput could drop the space; the value is capped there instead
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        spellCheck={false}
        // 16px so iOS does not zoom; invisible, the boxes below are what is seen
        className="absolute inset-0 z-10 h-full w-full cursor-text bg-transparent text-[16px] text-transparent caret-transparent opacity-0 outline-none disabled:cursor-not-allowed"
      />
      <div aria-hidden="true" className="grid grid-cols-6 gap-2 sm:gap-2.5">
        {Array.from({ length }, (_, index) => {
          const digit = value[index] ?? '';
          const isActive = focused && index === active && !disabled;
          return (
            <div
              key={index}
              className={cn(
                'flex items-center justify-center bg-card font-mono text-[22px] font-semibold tabular-nums text-foreground ring-1 transition-[box-shadow] duration-150',
                tone === 'staff' ? 'h-12 rounded-lg' : 'h-14 rounded-xl',
                invalid ? 'ring-2 ring-destructive' : isActive ? 'ring-2 ring-indigo-600 dark:ring-indigo-400' : 'ring-border',
                disabled && 'opacity-60',
              )}
            >
              {digit || (isActive ? <span className="h-6 w-px animate-pulse bg-foreground motion-reduce:animate-none" /> : null)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface OtpVerificationStepProps {
  challenge: OtpChallenge;
  /** Rejects with the API error when the code is refused; the step shows why. */
  onVerify: (code: string) => Promise<void>;
  onBack: () => void;
  backLabel: string;
  submitLabel?: string;
  /** Shown on arrival, e.g. when the first email could not be sent. */
  initialError?: string | null;
}

/**
 * The emailed-code step: six-digit entry (submits itself once complete), the time
 * left on the code, a resend that unlocks after the server's cooldown, and plain
 * messages for wrong / expired / exhausted codes. Nothing here is persisted.
 */
export function OtpVerificationStep({ challenge: initial, onVerify, onBack, backLabel, submitLabel = 'Xác nhận', initialError = null }: OtpVerificationStepProps) {
  const [challenge, setChallenge] = useState(initial);
  const [code, setCode] = useState('');
  const [error, setError] = useState<OtpErrorView | null>(initialError ? { message: initialError, closed: false, needsNewCode: true } : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const inputId = useId();
  const hintId = `${inputId}-hint`;

  // Times come from the server as instants, so a tab or phone that slept catches up on the next tick.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const expiresIn = secondsUntil(challenge.expires_at, now);
  const resendIn = secondsUntil(challenge.resend_available_at, now);
  const closed = Boolean(error?.closed);
  const canResend = !closed && resendIn === 0 && !resending;

  const verify = async (value: string) => {
    if (inFlight.current || closed) return;
    if (value.length !== challenge.code_length) {
      setError(describeOtpError(400, { code: 'OTP_FORMAT' }));
      inputRef.current?.focus();
      return;
    }
    inFlight.current = true;
    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      await onVerify(value);
    } catch (err) {
      const { status, body } = readError(err);
      if (body?.challenge) setChallenge(body.challenge);
      setError(describeOtpError(status, body));
      setCode('');
      inputRef.current?.focus();
    } finally {
      inFlight.current = false;
      setVerifying(false);
    }
  };

  const change = (value: string) => {
    setCode(value);
    if (!closed) setError(null);
    if (value.length === challenge.code_length) void verify(value);
  };

  const resend = async () => {
    if (!canResend) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const next = await authService.resendEmailOtp(challenge);
      setChallenge(next);
      setCode('');
      setNotice(`Đã gửi mã mới tới ${next.masked_email}. Mã cũ không còn dùng được.`);
      inputRef.current?.focus();
    } catch (err) {
      const { status, body } = readError(err);
      if (body?.challenge) setChallenge(body.challenge);
      setError(describeOtpError(status, body));
    } finally {
      setResending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void verify(code);
  };

  return (
    <form className="space-y-5" noValidate onSubmit={submit} aria-busy={verifying || undefined}>
      <AuthFormAlert message={error?.message ?? null} />
      <div role="status" aria-live="polite">
        {notice ? (
          <p className="flex items-start gap-2.5 rounded-xl bg-emerald-500/10 px-3.5 py-3 text-[13.5px] leading-snug text-foreground ring-1 ring-emerald-600/25">
            <MailCheck className="mt-px h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
            {notice}
          </p>
        ) : null}
      </div>

      {closed ? null : (
        <div>
          <label htmlFor={inputId} className="mb-2 block text-[13.5px] font-medium text-foreground">
            Mã xác thực ({challenge.code_length} chữ số)
          </label>
          <OtpCodeInput
            id={inputId}
            inputRef={inputRef}
            value={code}
            length={challenge.code_length}
            onChange={change}
            invalid={Boolean(error) && !error?.needsNewCode}
            disabled={verifying}
            describedBy={hintId}
          />
          <p id={hintId} className="mt-2.5 text-[13px] leading-snug text-muted-foreground">
            {expiresIn > 0
              ? <>Mã có hiệu lực trong <span className="font-medium tabular-nums text-foreground">{formatCountdown(expiresIn)}</span>. Có thể dán cả mã từ email. Không thấy email? Kiểm tra thư mục Spam.</>
              : 'Mã đã hết hạn. Gửi lại để nhận mã mới.'}
          </p>
        </div>
      )}

      {closed ? null : <AuthSubmitButton submitting={verifying} label={submitLabel} busyLabel="Đang xác thực…" testId="otp-submit" />}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {closed ? null : (
          <button
            type="button"
            onClick={() => void resend()}
            aria-disabled={!canResend || undefined}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-sm text-[13.5px] font-semibold text-indigo-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground aria-disabled:no-underline dark:text-indigo-300 dark:aria-disabled:text-muted-foreground"
          >
            {resending ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {resending ? 'Đang gửi…' : resendIn > 0 ? <>Gửi lại mã sau <span className="tabular-nums">{formatCountdown(resendIn)}</span></> : 'Gửi lại mã'}
          </button>
        )}
        <button
          type="button"
          onClick={onBack}
          className={cn(
            'inline-flex min-h-10 items-center rounded-sm text-[13.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60',
            closed ? 'font-semibold text-indigo-700 hover:underline dark:text-indigo-300' : 'text-muted-foreground hover:text-foreground hover:underline',
          )}
        >
          {backLabel}
        </button>
      </div>
    </form>
  );
}
