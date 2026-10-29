import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { ApiError, useAuth, type LoginOutcome } from '../src/auth/auth-context';
import * as authApi from '../src/api/auth';
import { OtpCodeForm } from '../src/components/OtpCodeForm';
import { BrandMark } from '../src/components/BrandMark';
import { getApiConfigError } from '../src/api/config';
import { Button, InlineAlert, PasswordField, TextField, ThemeProvider, brand, fontFamily, loginTheme, radii, space } from '../src/design-system';

// auth-service answers in English; the people holding the phone read Vietnamese.
const LOGIN_ERRORS: Record<string, string> = {
  'Invalid credentials': 'Sai tài khoản hoặc mật khẩu.',
  'User is not active': 'Tài khoản đang bị khóa hoặc chưa được kích hoạt. Liên hệ quản trị viên.',
  'Account locked due to too many failed login attempts. Contact an administrator.':
    'Tài khoản đã bị khóa do nhập sai mật khẩu quá nhiều lần. Liên hệ quản trị viên.',
  'Identifier and password are required': 'Vui lòng nhập tài khoản và mật khẩu.',
};

function describeLoginError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Đăng nhập thất bại';
  if (err.kind === 'network' || err.kind === 'timeout') {
    return 'Không kết nối được máy chủ SmartBook. Kiểm tra mạng (hoặc địa chỉ máy chủ) rồi thử lại.';
  }
  if (err.code === 'EMAIL_DELIVERY_UNAVAILABLE') return 'Chưa gửi được mã xác thực qua email. Vui lòng thử lại sau ít phút.';
  if (err.code === 'OTP_SEND_LIMIT') return 'Tài khoản đã yêu cầu quá nhiều mã xác thực. Vui lòng thử lại sau khoảng một giờ.';
  if (err.status === 429) return 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.';
  return LOGIN_ERRORS[err.message] ?? err.message;
}

const { colors, type } = loginTheme;

/**
 * Role is unknown until the JWT comes back, so this screen wears the brand
 * alone (ink and white) and commits to neither the reader nor the staff look.
 * The root layout sends the account to its area after sign-in (resolveAppArea).
 */
export default function LoginScreen() {
  const { login, completeOtpLogin } = useAuth();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // An emailed-code step, held in this screen's memory only (never in SecureStore).
  const [challenge, setChallenge] = useState<Extract<LoginOutcome, { kind: 'challenge' }>['response'] | null>(null);
  const usernameRef = useRef<TextInputInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const configError = getApiConfigError();

  async function handleSubmit() {
    if (isSubmitting) return;
    const next = {
      username: username.trim() ? undefined : 'Nhập tên đăng nhập hoặc email.',
      password: password ? undefined : 'Nhập mật khẩu.',
    };
    if (next.username || next.password) {
      setFieldErrors(next);
      (next.username ? usernameRef : passwordRef).current?.focus();
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const outcome = await login(username.trim(), password);
      if (outcome.kind === 'challenge') {
        // a second factor does not need the password again; email verification does (re-login)
        if (outcome.response.status === 'OTP_REQUIRED') setPassword('');
        setChallenge(outcome.response);
      }
    } catch (err) {
      setError(describeLoginError(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  // Signed in only when this resolves; the root layout then opens the account's area.
  async function verifyCode(code: string) {
    if (!challenge) return;
    if (challenge.status === 'OTP_REQUIRED') {
      await completeOtpLogin(challenge.challenge.id, code);
      return;
    }
    await authApi.verifyEmailOtp(challenge.challenge.id, code);
    try {
      const outcome = await login(username.trim(), password);
      setChallenge(outcome.kind === 'challenge' ? outcome.response : null);
    } catch {
      setChallenge(null);
      setPassword('');
      setError('Email đã được xác thực. Vui lòng đăng nhập lại.');
    }
  }

  function leaveChallenge() {
    setChallenge(null);
    setPassword('');
    setError(null);
  }

  return (
    <ThemeProvider name="login">
      <StatusBar style="light" />
      <View style={{ flex: 1, backgroundColor: brand.ink }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={{ flexGrow: 1 }}
            keyboardShouldPersistTaps="handled"
            bounces={false}
            contentInsetAdjustmentBehavior="never"
          >
            {/* The brand band: who this is, before what to do. */}
            <View style={{ paddingTop: insets.top + space.xxl, paddingHorizontal: space.xl, paddingBottom: space.xxxl, gap: space.xl }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }} accessibilityRole="header" accessibilityLabel="SmartBook">
                <BrandMark size={30} />
                <Text style={{ fontFamily: fontFamily.serif, fontSize: 22, color: '#FFFFFF', letterSpacing: -0.3 }}>SmartBook</Text>
              </View>
              <View style={{ gap: space.sm }}>
                <Text style={{ fontFamily: fontFamily.serif, fontSize: 34, lineHeight: 39, letterSpacing: -0.6, color: '#FFFFFF' }}>
                  Thư viện của bạn,{'\n'}trong túi áo.
                </Text>
                <Text style={{ fontFamily: fontFamily.regular, fontSize: 15.5, lineHeight: 23, color: colors.onInkMuted }}>
                  Một tài khoản cho bạn đọc và nhân viên. Ứng dụng tự mở đúng khu vực của tài khoản bạn.
                </Text>
              </View>
            </View>

            {/* No entrance motion: this is where typing starts, so the form is simply there. */}
            <View
              style={{
                flexGrow: 1,
                backgroundColor: colors.bg,
                borderTopLeftRadius: radii.xl,
                borderTopRightRadius: radii.xl,
                borderCurve: 'continuous',
                paddingHorizontal: space.xl,
                paddingTop: space.xl,
                paddingBottom: insets.bottom + space.xl,
                gap: space.lg,
              }}
            >
              {challenge ? (
                <>
                  <View style={{ gap: space.xs, marginBottom: space.xs }}>
                    <Text style={type.title} accessibilityRole="header">
                      {challenge.status === 'OTP_REQUIRED' ? 'Nhập mã đăng nhập' : 'Xác thực email'}
                    </Text>
                    <Text style={type.caption}>
                      {challenge.status === 'OTP_REQUIRED'
                        ? `Để bảo vệ tài khoản, chúng tôi vừa gửi mã 6 chữ số tới ${challenge.challenge.masked_email}.`
                        : `Chúng tôi vừa gửi mã 6 chữ số tới ${challenge.challenge.masked_email}. Nhập mã để kích hoạt tài khoản.`}
                    </Text>
                  </View>
                  <OtpCodeForm
                    key={challenge.challenge.id}
                    challenge={challenge.challenge}
                    onVerify={verifyCode}
                    onBack={leaveChallenge}
                    submitLabel={challenge.status === 'OTP_REQUIRED' ? 'Xác nhận và đăng nhập' : 'Xác thực và đăng nhập'}
                  />
                </>
              ) : (
                <>
                  <View style={{ gap: space.xs, marginBottom: space.xs }}>
                    <Text style={type.title} accessibilityRole="header">Đăng nhập</Text>
                    <Text style={type.caption}>Dùng tài khoản thư viện đã được cấp cho bạn.</Text>
                  </View>

                  {configError ? (
                    <InlineAlert tone="warning" title="Ứng dụng chưa được cấu hình máy chủ" message={configError} />
                  ) : null}

                  <TextField
                    ref={usernameRef}
                    label="Tài khoản"
                    icon="person-outline"
                    placeholder="Nhập tài khoản"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    value={username}
                    onChangeText={(value) => { setUsername(value); setFieldErrors((prev) => ({ ...prev, username: undefined })); setError(null); }}
                    error={fieldErrors.username}
                    editable={!isSubmitting}
                  />
                  <PasswordField
                    ref={passwordRef}
                    label="Mật khẩu"
                    icon="lock-closed-outline"
                    placeholder="Nhập mật khẩu"
                    autoComplete="password"
                    textContentType="password"
                    returnKeyType="go"
                    onSubmitEditing={handleSubmit}
                    value={password}
                    onChangeText={(value) => { setPassword(value); setFieldErrors((prev) => ({ ...prev, password: undefined })); setError(null); }}
                    error={fieldErrors.password}
                    editable={!isSubmitting}
                  />

                  {error ? <InlineAlert tone="danger" message={error} /> : null}

                  <Button label="Đăng nhập" loadingLabel="Đang đăng nhập…" onPress={handleSubmit} loading={isSubmitting} trailingIcon="arrow-forward" />

                  <Text style={[type.caption, { textAlign: 'center', marginTop: space.xs }]}>
                    Quên mật khẩu? Đặt lại trên website SmartBook, hoặc nhờ quản trị viên hỗ trợ.
                  </Text>
                </>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </ThemeProvider>
  );
}
