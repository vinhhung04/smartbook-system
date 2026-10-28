import { memo, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { BookCover } from './BookCover';
import type { StampTone } from '../../lib/reservationStatus';
import { PressableScale, StatusBadge, fontFamily, radii, space, useTheme } from '../../design-system';

type Props = {
  title: string | null | undefined;
  author?: string | null;
  coverUrl?: string | null;
  status: { label: string; tone: StampTone } | undefined;
  /** Small lines under the author: dates, ticket number. */
  meta: string[];
  warning?: { text: string; tone: 'danger' | 'warning' } | null;
  onPress: () => void;
  actions?: ReactNode;
  accessibilityLabel: string;
};

/**
 * One borrowed or reserved book: cover, title and the date that matters first,
 * the ticket number last. Readers recognise "Nhà giả kim, hạn 30/10", not
 * "LN-2026-0042". Overdue and due-soon carry words and an alarm icon, not just
 * a colour. The row and its action buttons are siblings, never nested buttons.
 */
export const BorrowBookCard = memo(function BorrowBookCard({ title, author, coverUrl, status, meta, warning, onPress, actions, accessibilityLabel }: Props) {
  const { colors, shadow } = useTheme();
  const displayTitle = title || 'Sách chưa có tên';
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radii.lg, borderCurve: 'continuous', overflow: 'hidden', ...shadow.card }}>
      <PressableScale
        onPress={onPress}
        scale={false}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={{ flexDirection: 'row', gap: space.md, padding: space.md }}
        pressedStyle={{ backgroundColor: colors.surfaceRaised }}
      >
        <BookCover title={displayTitle} author={author} coverImageUrl={coverUrl ?? null} width={64} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={{ gap: 2 }}>
            <Text style={{ fontFamily: fontFamily.serif, fontSize: 17, lineHeight: 22, color: colors.textPrimary }} numberOfLines={2}>{displayTitle}</Text>
            {author ? <Text style={{ fontFamily: fontFamily.regular, fontSize: 13.5, color: colors.textSecondary }} numberOfLines={1}>{author}</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {status ? <StatusBadge tone={status.tone} label={status.label} /> : null}
            {warning ? <StatusBadge tone={warning.tone} label={warning.text} icon="alarm" /> : null}
          </View>
          {meta.map((line) => (
            <Text key={line} style={{ fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, color: colors.textSecondary }}>{line}</Text>
          ))}
        </View>
      </PressableScale>
      {actions ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.md }}>{actions}</View>
      ) : null}
    </View>
  );
});
