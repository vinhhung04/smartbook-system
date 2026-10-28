import { View } from 'react-native';

import { useTheme } from '../design-system';

type Props = {
  value: number;
  max: number;
  boxes?: number;
};

/**
 * Progress as a row of segments, the checklist a worker marks off, readable at a
 * glance. Pair it with the count in words next to it (the callers do); the
 * segments are decoration for sighted users, the number is the information.
 */
export function ChecklistMeter({ value, max, boxes = 10 }: Props) {
  const { colors } = useTheme();
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * boxes);
  const done = max > 0 && value >= max;
  return (
    <View style={{ flexDirection: 'row', gap: 3 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: boxes }).map((_, i) => (
        <View key={i} style={{ flex: 1, height: 8, borderRadius: 2, backgroundColor: i < filled ? (done ? colors.success : colors.primary) : colors.surfaceRaised }} />
      ))}
    </View>
  );
}
