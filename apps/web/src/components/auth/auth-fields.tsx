import { forwardRef, useId, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { useAuthTone } from './auth-tone';

const FIELD_SHELL = 'group/field flex items-center gap-2.5 bg-card px-3.5 ring-1 ring-border transition-[box-shadow,background-color] duration-150 hover:ring-foreground/25 focus-within:ring-2 focus-within:ring-indigo-600 hover:focus-within:ring-indigo-600 dark:focus-within:ring-indigo-400 dark:hover:focus-within:ring-indigo-400';
const FIELD_INVALID = 'ring-2 ring-destructive hover:ring-destructive focus-within:ring-destructive hover:focus-within:ring-destructive dark:focus-within:ring-destructive dark:hover:focus-within:ring-destructive';
const INPUT = 'h-full min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/80 read-only:cursor-default disabled:cursor-not-allowed';

function FieldMessage({ id, tone, children }: { id: string; tone: 'error' | 'warning'; children: ReactNode }) {
  const Icon = tone === 'error' ? AlertCircle : TriangleAlert;
  return (
    <p
      id={id}
      className={cn('mt-2 flex items-start gap-1.5 text-[13px] leading-snug', tone === 'error' ? 'text-destructive' : 'text-amber-700 dark:text-amber-400')}
    >
      <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

interface AuthFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string;
  icon: LucideIcon;
  error?: string;
  /** Extra control at the right end of the field (e.g. the password toggle). */
  trailing?: ReactNode;
  /** Text under the field that is not an error (e.g. the Caps Lock warning). */
  notice?: string;
}

/**
 * Labelled input with an icon. The error sits right under the field, is tied to
 * it with aria-describedby and carries an icon, so it never relies on colour.
 */
export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(function AuthField(
  { label, icon: Icon, error, trailing, notice, id, ...input },
  ref,
) {
  const tone = useAuthTone();
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const noticeId = `${inputId}-notice`;
  const describedBy = [error ? errorId : null, notice && !error ? noticeId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={inputId} className="mb-2 block text-[13.5px] font-medium text-foreground">{label}</label>
      <div className={cn(FIELD_SHELL, tone === 'staff' ? 'h-11 rounded-lg' : 'h-12 rounded-xl', error && FIELD_INVALID, input.disabled && 'opacity-60')}>
        <Icon className={cn('h-4 w-4 shrink-0 transition-colors', error ? 'text-destructive' : 'text-muted-foreground group-focus-within/field:text-indigo-600 dark:group-focus-within/field:text-indigo-400')} aria-hidden="true" />
        <input ref={ref} id={inputId} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={INPUT} {...input} />
        {trailing}
      </div>
      {error ? <FieldMessage id={errorId} tone="error">{error}</FieldMessage> : null}
      {notice && !error ? <FieldMessage id={noticeId} tone="warning">{notice}</FieldMessage> : null}
    </div>
  );
});

type PasswordFieldProps = Omit<AuthFieldProps, 'type' | 'trailing' | 'notice' | 'icon'> & { icon: LucideIcon };

/**
 * Password input with a show/hide toggle and a Caps Lock warning. Clicking the
 * toggle keeps the caret in the field (pointerdown is not allowed to steal
 * focus); from the keyboard it is a normal button.
 */
export const AuthPasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function AuthPasswordField(
  { onKeyDown, onKeyUp, onBlur, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const readCaps = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState('CapsLock'));
  return (
    <AuthField
      {...props}
      ref={ref}
      type={visible ? 'text' : 'password'}
      notice={capsLock ? 'Caps Lock đang bật.' : undefined}
      onKeyDown={(event) => { readCaps(event); onKeyDown?.(event); }}
      onKeyUp={(event) => { readCaps(event); onKeyUp?.(event); }}
      onBlur={(event) => { setCapsLock(false); onBlur?.(event); }}
      trailing={(
        <button
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          aria-pressed={visible}
          className="-mr-2 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      )}
    />
  );
});

/** "Ghi nhớ tài khoản": says exactly what is kept, because only the identifier is. */
export function AuthRememberCheckbox({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  const hintId = useId();
  return (
    <label className="inline-flex min-h-10 cursor-pointer select-none items-center gap-2.5 text-[13.5px] text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={hintId}
        className="h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2 dark:accent-indigo-400 dark:[color-scheme:dark]"
      />
      Ghi nhớ tài khoản
      <span id={hintId} className="sr-only">Chỉ lưu tên đăng nhập trên thiết bị này, không lưu mật khẩu.</span>
    </label>
  );
}

/** A required agreement; its error sits under it like any field's. */
export function AuthConsentCheckbox({ id, checked, onChange, error, children }: { id: string; checked: boolean; onChange: (value: boolean) => void; error?: string; children: ReactNode }) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-[13.5px] leading-snug text-foreground">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="mt-px h-[18px] w-[18px] shrink-0 cursor-pointer rounded accent-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2 dark:accent-indigo-400 dark:[color-scheme:dark]"
        />
        <span>{children}</span>
      </label>
      {error ? <FieldMessage id={errorId} tone="error">{error}</FieldMessage> : null}
    </div>
  );
}

interface AuthSubmitButtonProps {
  submitting: boolean;
  label: string;
  busyLabel: string;
  testId?: string;
}

/**
 * Primary action. While the request runs it stays focusable (aria-disabled, not
 * disabled) so focus is not dropped to the page, and a second press is ignored
 * by the form's in-flight guard.
 */
export function AuthSubmitButton({ submitting, label, busyLabel, testId }: AuthSubmitButtonProps) {
  const tone = useAuthTone();
  return (
    <button
      type="submit"
      data-testid={testId}
      aria-disabled={submitting || undefined}
      className={cn(
        'group/submit relative inline-flex w-full items-center justify-center gap-2 font-semibold text-white transition-[background-color,transform,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.985] aria-disabled:cursor-progress aria-disabled:opacity-80 aria-disabled:active:scale-100',
        tone === 'staff'
          ? 'h-11 rounded-lg bg-[#1d1a4a] text-[14.5px] hover:bg-[#2b2766] dark:bg-indigo-500 dark:hover:bg-indigo-400'
          : 'h-12 rounded-full bg-indigo-700 text-[15px] shadow-[0_12px_24px_-14px_rgba(55,48,163,0.8)] hover:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-400',
      )}
    >
      {submitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      {submitting ? busyLabel : label}
      {submitting ? null : <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover/submit:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />}
    </button>
  );
}

/** Why the last attempt failed, announced once, with the way forward in the words. */
export function AuthFormAlert({ message }: { message: string | null }) {
  return (
    <div aria-live="assertive" aria-atomic="true">
      {message ? (
        <p
          key={message}
          className="flex items-start gap-2.5 rounded-xl bg-destructive/10 px-3.5 py-3 text-[13.5px] leading-snug text-destructive ring-1 ring-destructive/25 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none dark:bg-destructive/15"
        >
          <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="text-foreground">{message}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The way to the other portal, phrased as the question the visitor is asking themselves. */
export function AuthPortalSwitch({ question, action, to }: { question: string; action: string; to: string }) {
  return (
    <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13.5px] text-muted-foreground">
      {question}
      <Link
        to={to}
        className="group inline-flex min-h-10 items-center gap-1 rounded-md font-semibold text-foreground hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 dark:hover:text-indigo-300"
      >
        {action}
        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
      </Link>
    </p>
  );
}
