import { StyleSheet, Text } from 'react-native';
import { MotiView } from 'moti';

import { colors, radius } from '../theme/tokens';

type Props = {
  value: number;
  max: number;
  boxes?: number;
};

/**
 * Progress reads as a row of ticked checklist boxes — the packing-slip
 * checklist a picker actually marks off — instead of a smooth fill bar.
 */
export function ChecklistMeter({ value, max, boxes = 10 }: Props) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const checkedCount = Math.round(ratio * boxes);

  return (
    <MotiView style={styles.row}>
      {Array.from({ length: boxes }).map((_, i) => {
        const checked = i < checkedCount;
        return (
          <MotiView
            key={i}
            animate={{
              borderColor: checked ? colors.success : colors.borderStrong,
              backgroundColor: checked ? colors.successSoft : colors.surface,
            }}
            transition={{ type: 'timing', duration: 200 }}
            style={styles.box}
          >
            {checked ? <Text style={styles.tick}>✓</Text> : null}
          </MotiView>
        );
      })}
    </MotiView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 4,
  },
  box: {
    flex: 1,
    aspectRatio: 1,
    maxWidth: 22,
    borderWidth: 1.5,
    borderRadius: radius.sm / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    color: colors.success,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
});
