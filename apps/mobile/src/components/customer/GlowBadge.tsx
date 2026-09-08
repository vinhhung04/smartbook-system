import { StyleSheet, Text } from 'react-native';
import { MotiView } from 'moti';

import { colors, fonts, radius, spacing } from '../../theme/customerTokens';

type Tone = 'success' | 'danger' | 'warning' | 'primary';

const TONE_COLOR: Record<Tone, string> = {
  success: colors.success,
  danger: colors.danger,
  warning: colors.warning,
  primary: colors.primary,
};

const TONE_SOFT: Record<Tone, string> = {
  success: colors.successSoft,
  danger: colors.dangerSoft,
  warning: colors.warningSoft,
  primary: colors.primarySoft,
};

type Props = {
  text: string;
  tone?: Tone;
};

/**
 * The customer-side counterpart to the staff app's StampBadge — same status
 * source (get*StatusDisplay), same spring-in entrance, but a glowing pill
 * instead of a rotated rubber stamp: reads as "a status chip that glows in
 * the dark" rather than "paper stamped at a counter", matching the
 * customer app's cinematic/dark language.
 */
export function GlowBadge({ text, tone = 'primary' }: Props) {
  const color = TONE_COLOR[tone];
  const soft = TONE_SOFT[tone];

  return (
    <MotiView
      from={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', damping: 14, mass: 0.6 }}
      style={[
        styles.badge,
        {
          backgroundColor: soft,
          borderColor: color,
          shadowColor: color,
        },
      ]}
    >
      <Text style={[styles.text, { color }]}>{text}</Text>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  text: {
    fontFamily: fonts.monoSemibold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
