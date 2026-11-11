import { useEffect, useRef, useState } from 'react';
import { AppState, Text, View, type TextInputInstance } from 'react-native';

import * as authApi from '../api/auth';
import { Button, InlineAlert, TextField, fontFamily, space, useTheme } from '../design-system';
import { describeOtpError, formatCountdown, normalizeOtpInput, secondsUntil, type OtpErrorView } from '../lib/otp';
import type { OtpChallenge } from '../types/auth';

type Props = {
  challenge: OtpChallenge;
  /** Rejects with the ApiError when the code is refused; the form says why. */
  onVerify: (code: string) => Promise<void>;
  onBack: () => void;
  submitLabel: string;
};

/**
 * Emailed six-digit code. One numeric field (one-time-code autofill on iOS/Android,
 * paste works), submits itself when complete, shows the time left, and unlocks
 * "Gửi lại mã" after the server's cooldown. Nothing is persisted; times are server
 * instants, so the countdown is right again when the app comes back from background.
 */
export function OtpCodeForm({ challenge: initial, onVerify, onBack, submitLabel }: Props) {
  const { colors } = useTheme();
  const [challenge, setChallenge] = useState(initial);
  const [code, setCode] = useState('');
  const [error, setError] = useState<OtpErrorView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<TextInputInstance>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  const expiresIn = secondsUntil(challenge.expires_at, now);
  const resendIn = secondsUntil(challenge.resend_available_at, now);
  const closed = Boolean(error?.closed);

  async function verify(value: string) {
    if (inFlight.current || closed) return;
    if (value.length !== challenge.code_length) {
      setError({ message: 'Nhập đủ 6 chữ số của mã.', closed: false, needsNewCode: false, challenge: null });
      return;
    }
    inFlight.current = true;
    setVerifying(true);
    setError(null);
    setNotice(null);
    try {
      await onVerify(value);
    } catch (err) {
      const view = describeOtpError(err);
      if (view.challenge) setChallenge(view.challenge);
      setError(view);
      setCode('');
      inputRef.current?.focus();
    } finally {
      inFlight.current = false;
      setVerifying(false);
    }
  }

  function change(raw: string) {
    const value = normalizeOtpInput(raw, challenge.code_length);
    setCode(value);
    if (!closed) setError(null);
    if (value.length === challenge.code_length) void verify(value);
  }

  async function resend() {
    if (closed || resendIn > 0 || resending) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const next = await authApi.resendEmailOtp(challenge);
      setChallenge(next);
      setCode('');
      setNotice(`Đã gửi mã mới tới ${next.masked_email}. Mã cũ không còn dùng được.`);
    } catch (err) {
      const view = describeOtpError(err);
      if (view.challenge) setChallenge(view.challenge);
      setError(view);
    } finally {
      setResending(false);
    }
  }

  const hint = expiresIn > 0
    ? `Mã có hiệu lực trong ${formatCountdown(expiresIn)}. Không thấy email? Kiểm tra thư mục Spam.`
    : 'Mã đã hết hạn. Gửi lại để nhận mã mới.';

  return (
    <View style={{ gap: space.lg }}>
      {error ? <InlineAlert tone={error.needsNewCode ? 'warning' : 'danger'} message={error.message} /> : null}
      {notice ? <InlineAlert tone="success" message={notice} /> : null}

      {closed ? null : (
        <TextField
          ref={inputRef}
          label={`Mã xác thực (${challenge.code_length} chữ số)`}
          icon="keypad-outline"
          mono
          autoFocus
          value={code}
          onChangeText={change}
          placeholder="••••••"
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          returnKeyType="done"
          onSubmitEditing={() => void verify(code)}
          editable={!verifying}
          hint={hint}
          accessibilityHint={hint}
        />
      )}

      {closed ? null : (
        <Button label={submitLabel} loadingLabel="Đang xác thực…" onPress={() => void verify(code)} loading={verifying} trailingIcon="arrow-forward" />
      )}

      {closed ? null : (
        <Button
          label={resendIn > 0 ? `Gửi lại mã sau ${formatCountdown(resendIn)}` : 'Gửi lại mã'}
          loadingLabel="Đang gửi…"
          variant="secondary"
          size="md"
          onPress={() => void resend()}
          loading={resending}
          disabled={resendIn > 0}
        />
      )}

      <Button label="Quay lại đăng nhập" variant={closed ? 'primary' : 'ghost'} size="md" onPress={onBack} />

      <Text style={{ fontFamily: fontFamily.regular, fontSize: 12.5, lineHeight: 18, color: colors.textSecondary, textAlign: 'center' }}>
        SmartBook không bao giờ hỏi mã này qua điện thoại hay tin nhắn.
      </Text>
    </View>
  );
}
