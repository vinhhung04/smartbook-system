import { Text } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { fontFamily, radii, space, useTheme, type IconName } from '../design-system';

type Tone = 'success' | 'danger' | 'warning' | 'primary';

type Props = {
  text: string;
  tone?: Tone;
  /** Kept for callers; the verdict no longer tilts. */
  rotate?: number;
};

const ICON: Record<Tone, IconName> = {
  success: 'checkmark-circle',
  danger: 'close-circle',
  warning: 'alert-circle',
  primary: 'information-circle',
};

const LAND = { from: { opacity: 0, transform: [{ scale: 0.9 }] }, to: { opacity: 1, transform: [{ scale: 1 }] } };

/**
 * The verdict after a scan: a solid pill with an icon and words, so "đúng",
 * "sai" and "kiểm tra lại" read at arm's length and never by colour alone.
 * It lands with a 150 ms scale (the one earned bit of motion in a scan loop),
 * and simply appears under Reduce Motion. Announced politely to screen readers.
 */
export function StampBadge({ text, tone = 'primary' }: Props) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const palette: Record<Tone, { bg: string; fg: string }> = {
    success: { bg: colors.success, fg: '#FFFFFF' },
    danger: { bg: colors.danger, fg: '#FFFFFF' },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    primary: { bg: colors.primarySoft, fg: colors.primary },
  };
  const { bg, fg } = palette[tone];
  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: space.md, borderRadius: radii.pill, backgroundColor: bg },
        reduced ? null : { animationName: LAND, animationDuration: 150, animationTimingFunction: 'ease-out' },
      ]}
    >
      <Ionicons name={ICON[tone]} size={16} color={fg} />
      <Text style={{ fontFamily: fontFamily.bold, fontSize: 13.5, color: fg }}>{text}</Text>
    </Animated.View>
  );
}
