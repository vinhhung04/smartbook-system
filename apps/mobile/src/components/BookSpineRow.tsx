import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadow, spacing, typography } from '../theme/tokens';

const SPINE_COLORS = [colors.primary, colors.success, colors.warning, colors.danger, colors.neutral];

// Deterministic so the same category always gets the same spine color across
// re-renders/re-fetches, without needing a lookup table maintained by hand.
function spineColorForCategory(category: string | null): string {
  if (!category) return colors.neutral;
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return SPINE_COLORS[hash % SPINE_COLORS.length];
}

type Props = {
  title: string;
  author: string | null;
  category: string | null;
  availableQuantity: number;
  onPress: () => void;
};

/**
 * A catalog row reads like a book standing on a shelf — a colored spine on
 * the left, height-independent since rows are fixed-height, color keyed by
 * category — same DNA as SpineChart, carried down to list-item scale so
 * "incomplete" books without a cover image still have visual rhythm.
 */
export function BookSpineRow({ title, author, category, availableQuantity, onPress }: Props) {
  const spineColor = spineColorForCategory(category);
  const isAvailable = availableQuantity > 0;

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={[styles.spine, { backgroundColor: spineColor }]} />
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {author ?? 'Chưa rõ tác giả'}
          {category ? ` · ${category}` : ''}
        </Text>
      </View>
      <View style={[styles.availabilityDot, { backgroundColor: isAvailable ? colors.success : colors.danger }]} />
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingRight: spacing.md,
    overflow: 'hidden',
    ...shadow.card,
  },
  spine: {
    width: 6,
    alignSelf: 'stretch',
    marginRight: spacing.md,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.bodyBold,
  },
  meta: {
    ...typography.caption,
  },
  availabilityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
  chevron: {
    fontSize: 20,
    color: colors.textMuted,
  },
});
