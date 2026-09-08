import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';

import { colors, radius } from '../theme/tokens';

type Props = {
  /** Base Ionicons glyph name without the "-outline" suffix, e.g. "home". */
  name: keyof typeof Ionicons.glyphMap;
  focused: boolean;
};

/** Real glyph, filled when the tab is active and outlined otherwise — the
 * standard iOS tab-bar convention. */
export function TabBarIcon({ name, focused }: Props) {
  const glyph = focused ? name : (`${name}-outline` as keyof typeof Ionicons.glyphMap);

  return (
    <MotiView
      animate={{ scale: focused ? 1 : 0.92, opacity: focused ? 1 : 0.7 }}
      transition={{ type: 'timing', duration: 160 }}
      style={[styles.tile, focused && styles.tileFocused]}
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
