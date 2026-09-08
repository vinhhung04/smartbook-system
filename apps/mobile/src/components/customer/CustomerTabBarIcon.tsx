import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';

import { colors, radius, shadow } from '../../theme/customerTokens';

type Props = {
  /** Base Ionicons glyph name without the "-outline" suffix, e.g. "compass". */
  name: keyof typeof Ionicons.glyphMap;
  focused: boolean;
};

/**
 * Customer-scoped counterpart to the shared TabBarIcon (kept separate rather
 * than editing TabBarIcon, since that file is also used by the staff app's
 * tab layout). Same outline/filled convention, but the focused state glows
 * instead of just tinting, to sit on the floating dark-glass tab bar.
 */
export function CustomerTabBarIcon({ name, focused }: Props) {
  const glyph = focused ? name : (`${name}-outline` as keyof typeof Ionicons.glyphMap);

  return (
    <MotiView
      animate={{ scale: focused ? 1 : 0.92, opacity: focused ? 1 : 0.7 }}
      transition={{ type: 'timing', duration: 160 }}
      style={[styles.tile, focused && [styles.tileFocused, shadow.glow]]}
    >
      <Ionicons name={glyph} size={20} color={focused ? colors.primary : colors.textMuted} />
    </MotiView>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSoft,
  },
  tileFocused: {
    backgroundColor: colors.primarySoft,
  },
});
