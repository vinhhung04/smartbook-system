import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { ApiError, useAuth } from '../src/auth/auth-context';
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
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      await login(username.trim(), password);
    } catch (err) {
      setError(describeLoginError(err));
    } finally {
      setIsSubmitting(false);
    }
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
                <View style={{ width: 36, height: 36, borderRadius: radii.sm, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="book" size={19} color={brand.ink} />
                </View>
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
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </ThemeProvider>
  );
}
