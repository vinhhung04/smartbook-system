import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { getClothColor } from '../../lib/posterArt';
import { PressableScale, StatusBadge, fontFamily, radii, space, useTheme } from '../../design-system';

const CREAM = '#F3EBD8';

type CoverProps = {
  title: string;
  author?: string | null;
  category?: string | null;
  coverImageUrl?: string | null;
  width: number;
};

/**
 * A 2:3 book cover. Most catalog books have no photo, so the generated cloth
 * binding is the main look, not a rare fallback: the category's cloth colour,
 * one soft light from the top-left, the title set in the display serif and the
 * author under a short rule, the way a bound book's front board reads.
 */
export function BookCover({ title, author, category, coverImageUrl, width }: CoverProps) {
  const [failed, setFailed] = useState(false);
  const height = Math.round(width * 1.5);
  const photo = Boolean(coverImageUrl) && !failed;
  const small = width < 90;
  return (
    <View
      style={{ width, height, borderRadius: radii.xs, overflow: 'hidden', backgroundColor: photo ? '#E6E7EE' : getClothColor(category ?? null) }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {photo ? (
        <Image source={{ uri: coverImageUrl! }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <>
          <LinearGradient colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.22)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          <View style={{ flex: 1, padding: small ? 7 : 11, justifyContent: 'space-between' }}>
            <View style={{ width: '32%', height: 1, backgroundColor: 'rgba(243,235,216,0.5)' }} />
            <Text numberOfLines={small ? 4 : 5} style={{ fontFamily: fontFamily.serif, fontSize: small ? 11 : Math.max(13, Math.round(width * 0.12)), lineHeight: small ? 13 : Math.round(width * 0.145), color: CREAM }}>
              {title}
            </Text>
            {!small ? (
              <Text numberOfLines={1} style={{ fontFamily: fontFamily.medium, fontSize: 10, letterSpacing: 0.4, color: 'rgba(243,235,216,0.8)' }}>
                {author || 'SmartBook'}
              </Text>
            ) : <View />}
          </View>
        </>
      )}
      {/* Spine crease: the one detail that reads "book" rather than "thumbnail". */}
      <View style={{ position: 'absolute', top: 0, bottom: 0, left: Math.max(3, width * 0.05), width: 1, backgroundColor: 'rgba(255,255,255,0.22)' }} />
    </View>
  );
}

type TileBook = {
  id: string;
  title: string;
  author: string | null;
  category: string | null;
  cover_image_url: string | null;
  available_quantity?: number;
  reservable?: boolean;
};

/**
 * Cover-first tile for shelves and grids: cover, title (two lines), author and,
 * when known, whether a copy is on the shelf now. The whole tile is one button.
 */
export function BookTile({ book, width, onPress, caption, showAvailability = true }: {
  book: TileBook; width: number; onPress: () => void; caption?: string | null; showAvailability?: boolean;
}) {
  const { colors } = useTheme();
  const available = (book.available_quantity ?? 0) > 0;
  const availability = book.available_quantity == null || !showAvailability ? null : available ? `còn ${book.available_quantity} cuốn` : 'đã được mượn hết';
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[book.title, book.author, availability].filter(Boolean).join(', ')}
      style={{ width, gap: space.sm }}
    >
      <BookCover title={book.title} author={book.author} category={book.category} coverImageUrl={book.cover_image_url} width={width} />
      <View style={{ gap: 2 }}>
        <Text numberOfLines={2} style={{ fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 19, color: colors.textPrimary }}>{book.title}</Text>
        <Text numberOfLines={1} style={{ fontFamily: fontFamily.regular, fontSize: 13, color: colors.textSecondary }}>{book.author || 'Chưa rõ tác giả'}</Text>
        {caption ? <Text numberOfLines={2} style={{ fontFamily: fontFamily.regular, fontSize: 12.5, lineHeight: 17, color: colors.textMuted }}>{caption}</Text> : null}
      </View>
      {availability ? <StatusBadge tone={available ? 'success' : 'neutral'} label={available ? `Còn ${book.available_quantity}` : 'Hết sách'} icon={available ? 'checkmark-circle' : null} /> : null}
    </PressableScale>
  );
}
