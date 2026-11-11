import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { fontFamily, radii, space, useTheme } from '../design-system';

type Props = {
  n: number;
  title: string;
  done: boolean;
  /** One line under the title saying why this step exists. */
  caption?: string;
  children?: ReactNode;
};

/**
 * One step of a staff workflow (scan location, scan item, confirm…): numbered,
 * ticked and outlined green once verified, so a worker glancing back at the
 * phone sees where they are without reading.
 */
export function ScanStep({ n, title, done, caption, children }: Props) {
  const { colors, type } = useTheme();
  return (
    <View style={{ padding: space.lg, gap: space.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: done ? colors.success : colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? colors.success : colors.primary }}>
          {done ? (
            <Ionicons name="checkmark" size={16} color={colors.onPrimary} />
          ) : (
            <Text style={{ fontFamily: fontFamily.bold, fontSize: 14, color: colors.onPrimary }}>{n}</Text>
          )}
        </View>
        <Text style={{ flex: 1, fontFamily: fontFamily.semibold, fontSize: 17, lineHeight: 23, color: colors.textPrimary }} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {caption ? <Text style={type.caption}>{caption}</Text> : null}
      {children}
    </View>
  );
}
