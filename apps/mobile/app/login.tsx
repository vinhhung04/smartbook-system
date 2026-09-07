import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, useAuth } from '../src/auth/auth-context';
import { colors, fonts, radius, spacing, typography } from '../src/theme/tokens';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Đăng nhập thất bại');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.brand}>
        <Text style={styles.eyebrow}>THƯ VIỆN · KHO VẬN</Text>
        <View style={styles.stamp}>
          <View style={styles.stampInner}>
            <Text style={styles.stampText}>SB</Text>
          </View>
        </View>
        <Text style={styles.title}>SmartBook Picking</Text>
        <Text style={styles.subtitle}>Đăng nhập để bắt đầu ca làm việc</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Tài khoản</Text>
          <TextInput
            style={styles.input}
            placeholder="Nhập tài khoản"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Mật khẩu</Text>
          <TextInput
            style={styles.input}
            placeholder="Nhập mật khẩu"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.button,
            (isSubmitting || !username || !password) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
          onPress={handleSubmit}
          disabled={isSubmitting || !username || !password}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>Đăng nhập</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.bg,
  },
  brand: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  eyebrow: {
    fontFamily: fonts.monoSemibold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  stamp: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    transform: [{ rotate: '-6deg' }],
  },
  stampInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampText: {
    fontFamily: fonts.monoSemibold,
    color: colors.primary,
    fontSize: 20,
  },
  title: {
    ...typography.h1,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  form: {
    gap: spacing.lg,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    ...typography.label,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  error: {
    color: colors.danger,
    textAlign: 'center',
    fontSize: 13,
    fontFamily: fonts.bodySemibold,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    paddingVertical: spacing.md + 4,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontFamily: fonts.display,
    color: colors.onPrimary,
    fontSize: 20,
    letterSpacing: 0.6,
  },
});
