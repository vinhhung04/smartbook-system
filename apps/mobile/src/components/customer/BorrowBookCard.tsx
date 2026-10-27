import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PosterCard } from './PosterCard';
import { GlowBadge } from './GlowBadge';
import type { StampTone } from '../../lib/reservationStatus';
import { colors, fonts, radius, shadow, spacing, typography } from '../../theme/customerTokens';

type Props = {
  title: string | null | undefined;
  author?: string | null;
  coverUrl?: string | null;
  status: { label: string; tone: StampTone } | undefined;
  /** Small grey lines under the author: dates, ticket number. */
  meta: string[];
  warning?: { text: string; tone: 'danger' | 'warning' } | null;
  onPress: () => void;
  actions?: ReactNode;
  accessibilityLabel: string;
};

/**
 * One borrowed or reserved book — cover, title and the date that matters first, the
 * ticket number last. Readers recognise "Nhà giả kim, hạn 30/10", not "LN-2026-0042".
 */
export const BorrowBookCard = memo(function BorrowBookCard({ title, author, coverUrl, status, meta, warning, onPress, actions, accessibilityLabel }: Props) {
  const displayTitle = title || 'Sách chưa có tên';
  // The row and its action buttons are siblings, not nested pressables.
  return (
    <View style={styles.card}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <PosterCard title={displayTitle} category={null} coverImageUrl={coverUrl ?? null} width={64} height={96} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>{displayTitle}</Text>
          {author ? <Text style={styles.author} numberOfLines={1}>{author}</Text> : null}
          <View style={styles.badges}>
            {status ? <GlowBadge text={status.label} tone={status.tone} /> : null}
            {warning ? (
              <View style={[styles.warning, { backgroundColor: warning.tone === 'danger' ? colors.dangerSoft : colors.warningSoft }]}>
                <Ionicons name="alarm-outline" size={12} color={warning.tone === 'danger' ? colors.danger : colors.warning} />
                <Text style={[styles.warningText, { color: warning.tone === 'danger' ? colors.danger : colors.warning }]}>{warning.text}</Text>
              </View>
            ) : null}
          </View>
          {meta.map((line) => (
            <Text key={line} style={styles.meta} numberOfLines={1}>{line}</Text>
          ))}
        </View>
      </Pressable>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    ...shadow.card,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.textPrimary,
  },
  author: {
    ...typography.caption,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginVertical: 2,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  warningText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
  },
  meta: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingLeft: 64 + spacing.md,
  },
});
