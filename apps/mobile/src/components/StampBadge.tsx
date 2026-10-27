import { StyleSheet, Text } from 'react-native';
import { MotiView } from 'moti';
import { useReducedMotion } from 'react-native-reanimated';

import { colors, fonts, radius, spacing } from '../theme/tokens';

type Tone = 'success' | 'danger' | 'warning' | 'primary';

const TONE_COLOR: Record<Tone, string> = {
  success: colors.success,
  danger: colors.danger,
  warning: colors.warning,
  primary: colors.primary,
};

type Props = {
  text: string;
  tone?: Tone;
  rotate?: number;
};

/**
 * A confirmation reads like a stamp landing on the page — scales/rotates
 * into place — instead of a plain colored line of text appearing instantly.
 * Used at every scan-verified/scan-rejected moment across the app.
 */
export function StampBadge({ text, tone = 'primary', rotate = -3 }: Props) {
  const color = TONE_COLOR[tone];
  // Shown after every scan in continuous scanning; with Reduce Motion it just appears.
  const reducedMotion = useReducedMotion();
  return (
    <MotiView
      accessibilityLiveRegion="polite"
      from={reducedMotion ? undefined : { opacity: 0, scale: 0.7, rotate: '0deg' }}
      animate={{ opacity: 1, scale: 1, rotate: `${rotate}deg` }}
      transition={reducedMotion ? { type: 'timing', duration: 0 } : { type: 'spring', damping: 12, mass: 0.6 }}
      style={[styles.stamp, { borderColor: color }]}
    >
      <Text style={[styles.text, { color }]}>{text}</Text>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  stamp: {
    alignSelf: 'flex-start',
    borderWidth: 2.5,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  text: {
    fontFamily: fonts.monoSemibold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
