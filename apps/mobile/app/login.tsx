import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import Svg, { Line, Path, Rect } from 'react-native-svg';

import { ApiError, useAuth } from '../src/auth/auth-context';
import { colors, fonts, radius, spacing } from '../src/theme/loginTokens';

// Role is unknown until the JWT comes back, so this screen deliberately has
// its own neutral token set (loginTokens) rather than the staff-green or
// customer-amber palette — it can't visually commit to either side yet.
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
    <View style={styles.root}>
      <LinearGradient colors={[colors.paperTop, colors.paperBottom]} style={StyleSheet.absoluteFill} />

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <MotiView
          from={{ opacity: 0, translateY: 10 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 420 }}
          style={styles.brand}
        >
          <Text style={styles.eyebrow}>THƯ VIỆN · KHO VẬN</Text>
          <OpenBookMark />
          <Text style={styles.title}>SmartBook</Text>
          <Text style={styles.subtitle}>Đăng nhập để tiếp tục</Text>
        </MotiView>

        <MotiView
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 420, delay: 150 }}
          style={styles.card}
        >
          <View style={styles.punchHole} />
          <View style={styles.cardRule} />

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Tài khoản</Text>
              <View style={styles.underlineRow}>
                <Ionicons name="person-outline" size={18} color={colors.inkMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Nhập tài khoản"
                  placeholderTextColor={colors.inkMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={username}
                  onChangeText={setUsername}
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Mật khẩu</Text>
              <View style={styles.underlineRow}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.inkMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Nhập mật khẩu"
                  placeholderTextColor={colors.inkMuted}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                />
              </View>
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
              <LinearGradient
                colors={[colors.accent, colors.accentDeep]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              {isSubmitting ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.buttonText}>Đăng nhập</Text>
              )}
            </Pressable>
          </View>
        </MotiView>
      </SafeAreaView>
    </View>
  );
}

const SPARKLES = [
  { top: -6, left: 18, delay: 0 },
  { top: 10, left: 152, delay: 450 },
  { top: 66, left: 4, delay: 900 },
  { top: 78, left: 168, delay: 300 },
];

/**
 * The screen's signature: a hand-drawn open book (react-native-svg — already
 * a dependency, used for the pickup QR code) with a hanging bookmark ribbon,
 * replacing the round "SB" stamp from earlier passes. The whole book
 * breathes gently on a loop, and a few gold motes drift upward around it —
 * the "add animation" ask, answered as sunlight through a library window
 * rather than generic sparkle effects.
 */
function OpenBookMark() {
  return (
    <View style={styles.bookWrap}>
      {SPARKLES.map((s, i) => (
        <MotiView
          key={i}
          from={{ opacity: 0, translateY: 0, scale: 0.6 }}
          animate={{ opacity: [0, 1, 0], translateY: -16, scale: 1 }}
          transition={{ type: 'timing', duration: 2200, delay: s.delay, loop: true }}
          style={[styles.sparkle, { top: s.top, left: s.left }]}
        />
      ))}

      <MotiView
        from={{ scale: 1 }}
        animate={{ scale: [1, 1.015, 1] }}
        transition={{ type: 'timing', duration: 2600, loop: true }}
      >
        <Svg width={112} height={78} viewBox="0 0 180 120">
          <Path
            d="M90,16 C62,9 28,12 16,21 L16,98 C28,105 62,102 90,110 Z"
            fill={colors.cardStock}
            stroke={colors.ink}
            strokeWidth={1.5}
          />
          <Path
            d="M90,16 C118,9 152,12 164,21 L164,98 C152,105 118,102 90,110 Z"
            fill={colors.cardStock}
            stroke={colors.ink}
            strokeWidth={1.5}
          />
          <Line x1={90} y1={14} x2={90} y2={112} stroke={colors.accent} strokeWidth={2.5} />

          {[36, 48, 60].map((y) => (
            <Line key={`l-${y}`} x1={30} y1={y} x2={72} y2={y - 2} stroke={colors.inkMuted} strokeWidth={1} opacity={0.5} />
          ))}
          {[36, 48, 60].map((y) => (
            <Line key={`r-${y}`} x1={108} y1={y - 2} x2={150} y2={y} stroke={colors.inkMuted} strokeWidth={1} opacity={0.5} />
          ))}

          <Rect x={82} y={0} width={16} height={62} fill={colors.gold} />
          <Path d="M82,62 L98,62 L90,74 Z" fill={colors.gold} />
        </Svg>
      </MotiView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paperBottom,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  brand: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  eyebrow: {
    fontFamily: fonts.monoSemibold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.inkMuted,
    marginBottom: spacing.md,
  },
  bookWrap: {
    width: 112,
    height: 78,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  sparkle: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.gold,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 30,
    color: colors.ink,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.inkSoft,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.cardStock,
    borderRadius: radius.lg,
    paddingTop: spacing.xl + spacing.sm,
    overflow: 'hidden',
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  punchHole: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.inkMuted,
    backgroundColor: colors.paperTop,
  },
  cardRule: {
    height: 1,
    backgroundColor: colors.cardRule,
    marginHorizontal: spacing.xl,
    marginBottom: spacing.lg,
  },
  form: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontFamily: fonts.monoSemibold,
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.inkSoft,
  },
  underlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: 1.5,
    borderColor: colors.cardRule,
    paddingBottom: spacing.sm,
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    paddingVertical: 2,
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
    borderRadius: radius.pill,
    paddingVertical: spacing.md + 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
    overflow: 'hidden',
    shadowColor: colors.accentDeep,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    fontFamily: fonts.display,
    color: colors.onAccent,
    fontSize: 18,
    letterSpacing: 0.4,
  },
});
