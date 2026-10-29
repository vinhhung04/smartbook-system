import { useEffect, useRef, useState, type FormEvent } from 'react';
import axios from 'axios';
import { toast } from 'sonner';
import { authService, type LoginResponse, type LoginResult } from '@/services/auth';
import { getApiErrorMessage } from '@/services/api';

export type AuthPortal = 'staff' | 'customer';

/**
 * "Ghi nhớ tài khoản" keeps only the identifier (never the password or the
 * session) on this device. Staff keys are the ones the old login page used, so
 * identifiers saved before the redesign are still filled in.
 */
const REMEMBER_KEYS: Record<AuthPortal, { flag: string; identifier: string }> = {
  staff: { flag: 'smartbook-remember', identifier: 'smartbook-saved-identifier' },
  customer: { flag: 'smartbook-customer-remember', identifier: 'smartbook-customer-saved-identifier' },
};

function readRemembered(portal: AuthPortal) {
  try {
    const keys = REMEMBER_KEYS[portal];
    const on = localStorage.getItem(keys.flag) === 'true';
    return { on, identifier: on ? localStorage.getItem(keys.identifier) || '' : '' };
  } catch {
    return { on: false, identifier: '' };
  }
}

function writeRemembered(portal: AuthPortal, on: boolean, identifier: string) {
  try {
    const keys = REMEMBER_KEYS[portal];
    if (on) {
      localStorage.setItem(keys.flag, 'true');
      localStorage.setItem(keys.identifier, identifier);
    } else {
      localStorage.removeItem(keys.flag);
      localStorage.removeItem(keys.identifier);
    }
  } catch {
    // Storage unavailable (private mode): the login itself still works.
  }
}

/**
 * Plain-language reason a login failed. 401 is one message whatever the cause:
 * the backend answers "Invalid credentials" for a wrong password and an unknown
 * account alike, and the page must not tell the two apart either.
 */
export function describeLoginError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (!error.response) return 'Không kết nối được máy chủ. Kiểm tra kết nối mạng rồi thử lại.';
    if (status === 401) return 'Tên đăng nhập hoặc mật khẩu không đúng.';
    const code = (error.response?.data as { code?: string } | undefined)?.code;
    // Second factor or verification code could not be emailed: no session, by design.
    if (code === 'EMAIL_DELIVERY_UNAVAILABLE') return 'Chưa gửi được mã xác thực qua email. Vui lòng thử lại sau ít phút.';
    if (code === 'OTP_SEND_LIMIT') return 'Tài khoản đã yêu cầu quá nhiều mã xác thực. Vui lòng thử lại sau khoảng một giờ.';
    if (status === 429) return 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.';
    if (status && status >= 500) return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau ít phút.';
  }
  return getApiErrorMessage(error, 'Đăng nhập không thành công. Vui lòng thử lại.');
}

interface FieldErrors {
  identifier?: string;
  password?: string;
}

/** A login that needs an emailed code first. Held in memory only, never stored. */
export type LoginChallenge = Extract<LoginResult, { kind: 'challenge' }>;

interface UseLoginFormOptions {
  portal: AuthPortal;
  /** Returns a message when this portal must refuse the signed-in account; the session is then cleared. */
  refuse?: (data: LoginResponse) => string | null;
  onSuccess: (data: LoginResponse) => void;
}

/** State and submit flow shared by the staff and customer login pages. */
export function useLoginForm({ portal, refuse, onSuccess }: UseLoginFormOptions) {
  const [remembered] = useState(() => readRemembered(portal));
  const [identifier, setIdentifierValue] = useState(remembered.identifier);
  const [password, setPasswordValue] = useState('');
  const [remember, setRemember] = useState(remembered.on);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<LoginChallenge | null>(null);
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // A ref, not state: a second Enter in the same tick must not send a second request.
  const inFlight = useRef(false);

  // With a mouse or trackpad, start where the typing starts (the password when the
  // account is remembered). Not on touch screens: that would throw up the keyboard.
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    (remembered.identifier ? passwordRef : identifierRef).current?.focus();
  }, [remembered.identifier]);

  // Back from the code step the form mounts again: continue at the password.
  const hadChallenge = useRef(false);
  useEffect(() => {
    if (challenge) hadChallenge.current = true;
    else if (hadChallenge.current) passwordRef.current?.focus();
  }, [challenge]);

  const setIdentifier = (value: string) => {
    setIdentifierValue(value);
    setErrors((prev) => ({ ...prev, identifier: undefined }));
    setFormError(null);
  };
  const setPassword = (value: string) => {
    setPasswordValue(value);
    setErrors((prev) => ({ ...prev, password: undefined }));
    setFormError(null);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (inFlight.current) return;

    const nextErrors: FieldErrors = {};
    if (!identifier.trim()) nextErrors.identifier = 'Nhập tên đăng nhập hoặc email.';
    if (!password) nextErrors.password = 'Nhập mật khẩu.';
    if (nextErrors.identifier || nextErrors.password) {
      setErrors(nextErrors);
      (nextErrors.identifier ? identifierRef : passwordRef).current?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      await handleResult(await authService.login({ identifier, password }));
    } catch (error) {
      setFormError(describeLoginError(error));
      // Wrong credentials: put the reader straight back into the password to retry.
      if (axios.isAxiosError(error) && error.response?.status === 401) passwordRef.current?.select();
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  async function finish(data: LoginResponse) {
    const refusal = refuse?.(data) ?? null;
    if (refusal) {
      await authService.logout();
      setChallenge(null);
      setFormError(refusal);
      return;
    }
    writeRemembered(portal, remember, identifier);
    toast.success('Đăng nhập thành công');
    onSuccess(data);
  }

  async function handleResult(result: LoginResult) {
    if (result.kind === 'authenticated') {
      await finish(result.data);
      return;
    }
    // A second factor does not need the password again: drop it from memory now.
    // Email verification does: once confirmed, the same sign-in is repeated for the user.
    if (result.status === 'OTP_REQUIRED') setPasswordValue('');
    setChallenge(result);
  }

  /** Called by the code step; rejects with the API error so the step can explain it. */
  const verifyCode = async (code: string) => {
    if (!challenge) return;
    if (challenge.status === 'OTP_REQUIRED') {
      await finish(await authService.verifyLoginOtp(challenge.challenge.id, code));
      return;
    }
    await authService.verifyEmailOtp(challenge.challenge.id, code);
    try {
      await handleResult(await authService.login({ identifier, password }));
    } catch {
      // Verified, but the follow-up sign-in failed (rate limit, network): sign in by hand.
      setChallenge(null);
      setPasswordValue('');
      toast.success('Email đã được xác thực.');
      setFormError('Email đã được xác thực. Vui lòng đăng nhập lại.');
    }
  };

  /** Back from the code step to the form, with the password to be typed again. */
  const cancelChallenge = () => {
    setChallenge(null);
    setPasswordValue('');
    setFormError(null);
  };

  return {
    challenge,
    verifyCode,
    cancelChallenge,
    identifier,
    setIdentifier,
    password,
    setPassword,
    remember,
    setRemember,
    errors,
    formError,
    submitting,
    submit,
    identifierRef,
    passwordRef,
  };
}
