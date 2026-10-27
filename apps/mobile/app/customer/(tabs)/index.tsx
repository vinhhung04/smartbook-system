import { memo, useCallback } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../../../src/auth/auth-context';
import { HeroBanner } from '../../../src/components/customer/HeroBanner';
import { PosterCard } from '../../../src/components/customer/PosterCard';
import { useCustomerHome } from '../../../src/hooks/useCustomerHome';
import { useUnreadNotifications } from '../../../src/hooks/useUnreadNotifications';
import { useCustomerTabBarSpace } from '../../../src/hooks/useCustomerTabBarSpace';
import { colors, fonts, radius, spacing, typography } from '../../../src/theme/customerTokens';
import type { CustomerCatalogBook } from '../../../src/types/customerCatalog';

type ShelfItem = { book: CustomerCatalogBook; caption?: string | null };

const POSTER_WIDTH = 120;
const POSTER_GAP = spacing.md;

function openBook(id: string) {
  router.push(`/customer/book/${id}`);
}

const Shelf = memo(function Shelf({ title, subtitle, items }: { title: string; subtitle?: string; items: ShelfItem[] }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.shelf}>
      <Text style={styles.shelfTitle} accessibilityRole="header">{title}</Text>
      {subtitle ? <Text style={styles.shelfSubtitle}>{subtitle}</Text> : null}
      <FlatList
        data={items}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.book.id}
        contentContainerStyle={styles.shelfList}
        initialNumToRender={4}
        windowSize={3}
        getItemLayout={(_, index) => ({ length: POSTER_WIDTH + POSTER_GAP, offset: (POSTER_WIDTH + POSTER_GAP) * index, index })}
        renderItem={({ item }) => (
          <View style={styles.posterItem}>
            <PosterCard
              title={item.book.title}
              category={item.book.category}
              coverImageUrl={item.book.cover_image_url}
              width={POSTER_WIDTH}
              height={180}
              onPress={() => openBook(item.book.id)}
            />
            {item.caption ? <Text style={styles.posterCaption} numberOfLines={2}>{item.caption}</Text> : null}
          </View>
        )}
      />
    </View>
  );
});

function asItems(books: CustomerCatalogBook[]): ShelfItem[] {
  return books.map((book) => ({ book }));
}

export default function CustomerHomeScreen() {
  const tabBarSpace = useCustomerTabBarSpace();
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">Khám phá</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.iconButton} onPress={() => router.push('/customer/scan-cover')} accessibilityRole="button" accessibilityLabel="Tìm sách bằng ảnh bìa">
            <Ionicons name="camera-outline" size={20} color={colors.textPrimary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => router.push('/customer/search')} accessibilityRole="button" accessibilityLabel="Tìm kiếm sách">
            <Ionicons name="search" size={20} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push('/customer/notifications')}
            accessibilityRole="button"
            accessibilityLabel={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : 'Thông báo'}
          >
            <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
            {unreadCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      {isLoading && !home ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error && !home ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.moreButton} onPress={retry} accessibilityRole="button">
            <Text style={styles.moreButtonText}>Thử lại</Text>
          </Pressable>
        </View>
      ) : home ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace }]}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={colors.primary} colors={[colors.primary]} />}
        >
          {heroPersonal ? (
            <HeroBanner
              title={heroPersonal.book.title}
              author={heroPersonal.book.author}
              category={heroPersonal.book.category}
              coverImageUrl={heroPersonal.book.cover_image_url}
              eyebrow="GỢI Ý CHO BẠN"
              reason={heroPersonal.reason}
              onPress={() => openBook(heroPersonal.book.id)}
            />
          ) : heroPopular ? (
            <HeroBanner
              title={heroPopular.title}
              author={heroPopular.author}
              category={heroPopular.category}
              coverImageUrl={heroPopular.cover_image_url}
              eyebrow={home.most_borrowed.length > 0 ? 'ĐƯỢC MƯỢN NHIỀU NHẤT' : 'CÓ THỂ MƯỢN NGAY'}
              onPress={() => openBook(heroPopular.id)}
            />
          ) : null}

          {recommendations.status === 'loading' ? (
            <View style={styles.shelf}>
              <Text style={styles.shelfTitle}>Gợi ý dành cho bạn</Text>
              <View style={styles.inlineState}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.shelfSubtitle}>Đang chọn sách theo lịch sử đọc của bạn…</Text>
              </View>
            </View>
          ) : personal.length > 1 ? (
            <Shelf
              title="Gợi ý dành cho bạn"
              subtitle="Dựa trên sách bạn đã mượn, yêu thích và đánh giá"
              items={personal.slice(1).map((item) => ({ book: item.book, caption: item.reason }))}
            />
          ) : recommendations.status === 'ready' && !recommendations.personalized ? (
            <Text style={styles.note}>Mượn hoặc lưu vài cuốn sách để nhận gợi ý riêng cho bạn.</Text>
          ) : null}

          <Shelf title="Có thể mượn ngay" subtitle="Còn sách ở chi nhánh, đặt trước được" items={asItems(home.available_now)} />
          <Shelf title="Đang được quan tâm" subtitle="Nhiều lượt mượn gần đây" items={asItems(home.trending)} />
          <Shelf title="Mượn nhiều nhất" items={asItems(home.most_borrowed)} />
          <Shelf title="Đánh giá cao" items={asItems(home.top_rated)} />
          <Shelf title="Sách mới" items={asItems(home.new_arrivals)} />

          {home.categories.length > 0 ? (
            <View style={styles.shelf}>
              <Text style={styles.shelfTitle} accessibilityRole="header">Danh mục</Text>
              <View style={styles.categoryGrid}>
                {home.categories.map((category) => (
                  <Pressable
                    key={category.slug}
                    style={({ pressed }) => [styles.category, pressed && styles.pressed]}
                    onPress={() => router.push({ pathname: '/customer/search', params: { category: category.slug, categoryName: category.name } })}
                    accessibilityRole="button"
                    accessibilityLabel={`${category.name}, ${category.book_count} đầu sách`}
                  >
                    <Text style={styles.categoryName} numberOfLines={1}>{category.name}</Text>
                    <Text style={styles.categoryCount}>{category.available_count}/{category.book_count} có sẵn</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <Pressable style={styles.moreButton} onPress={() => router.push('/customer/search')} accessibilityRole="button">
            <Text style={styles.moreButtonText}>Xem toàn bộ {home.stats.total_titles} đầu sách</Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    ...typography.h2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontFamily: fonts.bodySemibold,
    fontSize: 10,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  error: {
    color: colors.danger,
    fontWeight: '600',
    textAlign: 'center',
  },
  content: {
    paddingBottom: 120,
  },
  shelf: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  shelfTitle: {
    ...typography.h3,
    marginLeft: spacing.lg,
  },
  shelfSubtitle: {
    ...typography.caption,
    marginHorizontal: spacing.lg,
    marginTop: -spacing.xs,
  },
  shelfList: {
    paddingHorizontal: spacing.lg,
  },
  posterItem: {
    width: POSTER_WIDTH,
    marginRight: POSTER_GAP,
    gap: 4,
  },
  posterCaption: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
  },
  inlineState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginLeft: spacing.lg,
  },
  note: {
    ...typography.caption,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  category: {
    width: '48%',
    flexGrow: 1,
    minHeight: 64,
    justifyContent: 'center',
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.8,
  },
  categoryName: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  categoryCount: {
    ...typography.caption,
    fontSize: 12,
  },
  moreButton: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreButtonText: {
    ...typography.bodyBold,
  },
});
