import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MotiView } from 'moti';

import { colors, fonts, radius, shadow, spacing, typography } from '../theme/tokens';

export type FeatureCardProps = {
  title: string;
  subtitle: string;
  tag: string;
  tint: string;
  tintSoft: string;
  count?: number;
  onPress: () => void;
};

export function FeatureCard({ title, subtitle, tag, tint, tintSoft, count, onPress }: FeatureCardProps) {
  const [pressed, setPressed] = useState(false);

  return (
    <MotiView animate={{ scale: pressed ? 0.97 : 1 }} transition={{ type: 'timing', duration: 120 }}>
      <Pressable
        style={styles.card}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
      >
        <View style={[styles.iconTile, { backgroundColor: tintSoft }]}>
          <Text style={[styles.iconTileText, { color: tint }]}>{tag}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardSubtitle}>{subtitle}</Text>
        </View>
        {count !== undefined && count > 0 ? (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{count}</Text>
          </View>
        ) : null}
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </MotiView>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  iconTileText: {
    fontFamily: fonts.monoSemibold,
    fontSize: 14,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    ...typography.h3,
  },
  cardSubtitle: {
    ...typography.caption,
    marginTop: 2,
  },
  countBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
    marginRight: spacing.sm,
  },
  countBadgeText: {
    fontFamily: fonts.monoSemibold,
    fontSize: 12,
    color: colors.onPrimary,
  },
  chevron: {
    fontSize: 22,
    color: colors.textMuted,
    marginLeft: spacing.xs,
  },
});
