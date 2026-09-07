import { StyleSheet, Text } from 'react-native';
import { MotiView } from 'moti';

import { colors, fonts, radius } from '../theme/tokens';

type Props = {
  label: string;
  focused: boolean;
};

/** Reuses the app's existing 2-letter mono-tag visual language for tab icons. */
export function TabBarIcon({ label, focused }: Props) {
  return (
    <MotiView
      animate={{ scale: focused ? 1 : 0.92, opacity: focused ? 1 : 0.7 }}
      transition={{ type: 'timing', duration: 160 }}
      style={[styles.tile, focused && styles.tileFocused]}
    >
      <Text style={[styles.text, focused && styles.textFocused]}>{label}</Text>
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
  text: {
    fontFamily: fonts.monoSemibold,
    fontSize: 12,
    color: colors.textMuted,
  },
  textFocused: {
    color: colors.primary,
  },
});
