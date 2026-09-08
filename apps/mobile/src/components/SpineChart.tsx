import { StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';

import { colors, fonts, radius, spacing } from '../theme/tokens';

export type SpineSegment = {
  key: string;
  label: string;
  count: number;
  tone: 'primary' | 'warning';
};

type Props = {
  segments: SpineSegment[];
  maxHeight?: number;
};

/**
 * The dashboard's signature visual: today's task queue as a row of book
 * spines on a shelf — height by count, color by urgency — instead of a
 * generic bar/donut chart. Re-mount this (change its `key` prop) to replay
 * the stagger, e.g. after a pull-to-refresh.
 */
export function SpineChart({ segments, maxHeight = 96 }: Props) {
  const maxCount = Math.max(1, ...segments.map((s) => s.count));

  return (
    <View style={styles.row}>
      {segments.map((segment, index) => {
        const height = Math.max(10, (segment.count / maxCount) * maxHeight);
        return (
          <View key={segment.key} style={styles.column}>
            <Text style={styles.count}>{segment.count}</Text>
            <View style={[styles.track, { height: maxHeight }]}>
              <MotiView
                from={{ height: 0 }}
                animate={{ height }}
                transition={{ type: 'timing', duration: 420, delay: index * 60 }}
                style={[styles.spine, { backgroundColor: colors[segment.tone] }]}
              />
            </View>
            <Text style={styles.label} numberOfLines={1}>
              {segment.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  column: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
  },
  count: {
    fontFamily: fonts.monoSemibold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  track: {
    width: 14,
    justifyContent: 'flex-end',
  },
  spine: {
    width: 14,
    borderRadius: radius.sm,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.textMuted,
  },
});
