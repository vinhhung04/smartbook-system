import { memo, useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { FlatList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../../../src/auth/auth-context';
import { BookCover, BookTile } from '../../../src/components/customer/BookCover';
import { useCustomerHome } from '../../../src/hooks/useCustomerHome';
import { useUnreadNotifications } from '../../../src/hooks/useUnreadNotifications';
import { getClothColor } from '../../../src/lib/posterArt';
import {
  Button, ErrorState, IconButton, PressableScale, Screen, SectionHeader, Skeleton, fontFamily, radii, space, useTheme,
} from '../../../src/design-system';
import type { CustomerCatalogBook } from '../../../src/types/customerCatalog';

type ShelfItem = { book: CustomerCatalogBook; caption?: string | null };

const TILE_WIDTH = 120;

function openBook(id: string) {
  router.push(`/customer/book/${id}`);
}

const Shelf = memo(function Shelf({ title, caption, items }: { title: string; caption?: string; items: ShelfItem[] }) {
  if (items.length === 0) return null;
  return (
    <View style={{ gap: space.md }}>
      <View style={{ paddingHorizontal: space.lg }}>
        <SectionHeader title={title} caption={caption} />
      </View>
      <FlatList
        data={items}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.book.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}
        initialNumToRender={4}
        windowSize={3}
        renderItem={({ item }) => <BookTile book={item.book} width={TILE_WIDTH} caption={item.caption} onPress={() => openBook(item.book.id)} />}
      />
    </View>
  );
});

function firstName(fullName?: string | null) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return parts[parts.length - 1] || null;
}

/** The book the reader sees first: their top recommendation, or the library's most borrowed. */
function FeaturedBook({ book, note, reason }: { book: CustomerCatalogBook; note: string; reason?: string | null }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={() => openBook(book.id)}
      accessibilityRole="button"
      accessibilityLabel={`${book.title}, ${book.author ?? 'chưa rõ tác giả'}. ${note}`}
      style={{ marginHorizontal: space.lg, padding: space.lg, gap: space.lg, flexDirection: 'row', borderRadius: radii.xl, borderCurve: 'continuous', backgroundColor: colors.inkField }}
    >
      <BookCover title={book.title} author={book.author} category={book.category} coverImageUrl={book.cover_image_url} width={108} />
      <View style={{ flex: 1, gap: space.sm, justifyContent: 'center' }}>
        <Text style={{ fontFamily: fontFamily.serif, fontSize: 21, lineHeight: 26, color: colors.onInk }} numberOfLines={3}>{book.title}</Text>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, color: colors.onInkMuted }} numberOfLines={1}>{book.author || 'Chưa rõ tác giả'}</Text>
        <Text style={{ fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 18, color: '#F6DFB4' }} numberOfLines={3}>{reason || note}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space.xs }}>
          <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.onInk }}>Xem sách</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.onInk} />
        </View>
      </View>
    </PressableScale>
  );
}

function HomeSkeleton() {
  return (
    <View style={{ paddingHorizontal: space.lg, gap: space.xl }} accessibilityLabel="Đang tải trang khám phá">
      <Skeleton height={176} radius={radii.xl} />
      <Skeleton width={180} height={22} />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        {[0, 1, 2].map((i) => <Skeleton key={i} width={TILE_WIDTH} height={180} radius={radii.xs} />)}
      </View>
    </View>
  );
}

export default function CustomerHomeScreen() {
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { home, isLoading, isRefreshing, error, recommendations, refresh, retry } = useCustomerHome(user?.id ?? null);
  const { count: unreadCount, refresh: refreshUnread } = useUnreadNotifications();

  useFocusEffect(
    useCallback(() => {
      void refreshUnread();
    }, [refreshUnread]),
  );

  const personal = recommendations.status === 'ready' && recommendations.personalized ? recommendations.items : [];
  const heroPersonal = personal[0] ?? null;
  const heroPopular = !heroPersonal ? (home?.most_borrowed[0] ?? home?.available_now[0] ?? null) : null;
  const name = firstName(user?.full_name);

  return (
    <Screen bleed onRefresh={home ? refresh : undefined} refreshing={isRefreshing} contentStyle={{ paddingTop: insets.top + space.md }}>
      <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.caption}>{name ? `Chào ${name},` : 'Chào bạn,'}</Text>
            <Text style={type.display} accessibilityRole="header">Hôm nay đọc gì?</Text>
          </View>
          <IconButton
            icon="notifications-outline"
            variant="tonal"
            accessibilityLabel="Thông báo"
            badge={unreadCount}
            onPress={() => router.push('/customer/notifications')}
          />
        </View>

        {/* Search is the main way in, so it looks like the search box it opens. */}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <PressableScale
            onPress={() => router.push('/customer/search')}
            accessibilityRole="search"
            accessibilityLabel="Tìm tên sách, tác giả"
            style={{ flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, borderRadius: radii.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
          >
            <Ionicons name="search" size={20} color={colors.textMuted} />
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 16, color: colors.textMuted }}>Tìm tên sách, tác giả…</Text>
          </PressableScale>
          <IconButton icon="camera-outline" variant="tonal" accessibilityLabel="Tìm sách bằng ảnh bìa" onPress={() => router.push('/customer/scan-cover')} />
        </View>

        <PressableScale
          onPress={() => router.push('/customer/assistant')}
          accessibilityRole="button"
          accessibilityLabel="Trợ lý tìm sách: mô tả cuốn bạn muốn đọc"
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radii.lg, backgroundColor: colors.primarySoft }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="sparkles" size={19} color={colors.onPrimary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: 15, color: colors.textPrimary }}>Chưa biết tên sách?</Text>
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 13.5, color: colors.textSecondary }}>Mô tả cuốn bạn muốn đọc, trợ lý tìm trong thư viện.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.primary} />
        </PressableScale>
      </View>

      {isLoading && !home ? (
        <HomeSkeleton />
      ) : error && !home ? (
        <ErrorState message={error} onRetry={retry} />
      ) : home ? (
        <>
          {heroPersonal ? (
            <FeaturedBook book={heroPersonal.book} note="Gợi ý dành cho bạn" reason={heroPersonal.reason} />
          ) : heroPopular ? (
            <FeaturedBook book={heroPopular} note={home.most_borrowed.length > 0 ? 'Được mượn nhiều nhất thư viện' : 'Có thể mượn ngay hôm nay'} />
          ) : null}

          {recommendations.status === 'loading' ? (
            <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
              <SectionHeader title="Gợi ý dành cho bạn" caption="Đang chọn sách theo lịch sử đọc của bạn…" />
              <View style={{ flexDirection: 'row', gap: space.md }}>
                {[0, 1, 2].map((i) => <Skeleton key={i} width={TILE_WIDTH} height={180} radius={radii.xs} />)}
              </View>
            </View>
          ) : personal.length > 1 ? (
            <Shelf
              title="Gợi ý dành cho bạn"
              caption="Dựa trên sách bạn đã mượn, yêu thích và đánh giá"
              items={personal.slice(1).map((item) => ({ book: item.book, caption: item.reason }))}
            />
          ) : recommendations.status === 'ready' && !recommendations.personalized ? (
            <Text style={[type.caption, { paddingHorizontal: space.lg }]}>Mượn hoặc lưu vài cuốn sách để nhận gợi ý riêng cho bạn.</Text>
          ) : null}

          <Shelf title="Có thể mượn ngay" caption="Còn sách ở chi nhánh, đặt trước được" items={home.available_now.map((book) => ({ book }))} />
          <Shelf title="Đang được quan tâm" caption="Nhiều lượt mượn gần đây" items={home.trending.map((book) => ({ book }))} />
          <Shelf title="Mượn nhiều nhất" items={home.most_borrowed.map((book) => ({ book }))} />
          <Shelf title="Đánh giá cao" items={home.top_rated.map((book) => ({ book }))} />
          <Shelf title="Sách mới về" items={home.new_arrivals.map((book) => ({ book }))} />

          {home.categories.length > 0 ? (
            <View style={{ paddingHorizontal: space.lg, gap: space.md }}>
              <SectionHeader title="Thể loại" caption="Số đầu sách đang có trên kệ của từng thể loại" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {home.categories.map((category) => (
                  <PressableScale
                    key={category.slug}
                    onPress={() => router.push({ pathname: '/customer/search', params: { category: category.slug, categoryName: category.name } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${category.name}, ${category.available_count} trên ${category.book_count} đầu sách có sẵn`}
                    style={{ flexBasis: '47%', flexGrow: 1, minHeight: 76, padding: space.md, gap: 4, justifyContent: 'space-between', borderRadius: radii.md, backgroundColor: getClothColor(category.name) }}
                  >
                    <Text numberOfLines={2} style={{ fontFamily: fontFamily.serif, fontSize: 16.5, lineHeight: 21, color: '#F3EBD8' }}>{category.name}</Text>
                    <Text style={{ fontFamily: fontFamily.medium, fontSize: 12.5, color: 'rgba(243,235,216,0.85)' }}>
                      {category.available_count}/{category.book_count} có sẵn
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ paddingHorizontal: space.lg }}>
            <Button label={`Xem toàn bộ ${home.stats.total_titles} đầu sách`} variant="secondary" trailingIcon="arrow-forward" onPress={() => router.push('/customer/search')} />
          </View>
        </>
      ) : null}
    </Screen>
  );
}
