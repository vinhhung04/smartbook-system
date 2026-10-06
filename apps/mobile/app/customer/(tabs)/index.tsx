import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HeroBanner } from '../../../src/components/customer/HeroBanner';
import { PosterCard } from '../../../src/components/customer/PosterCard';
import { colors, radius, spacing, typography } from '../../../src/theme/customerTokens';
import { useCatalogPages } from '../../../src/hooks/useCatalogPages';
import type { CustomerCatalogBook } from '../../../src/types/customerCatalog';

const ALL_BOOKS = {};

type Shelf = {
  category: string;
  books: CustomerCatalogBook[];
};

function groupByCategory(books: CustomerCatalogBook[]): Shelf[] {
  const order: string[] = [];
  const byCategory = new Map<string, CustomerCatalogBook[]>();

  for (const book of books) {
    const key = book.category ?? 'Chưa phân loại';
    if (!byCategory.has(key)) {
      byCategory.set(key, []);
      order.push(key);
    }
    byCategory.get(key)!.push(book);
  }

  return order.map((category) => ({ category, books: byCategory.get(category)! }));
}

export default function CustomerHomeScreen() {
  // Paged: the first page fills the shelves, "Tải thêm sách" adds the next one.
  const catalog = useCatalogPages(ALL_BOOKS);
  const books = catalog.items;

  const featured = books.find((b) => b.available_quantity > 0) ?? books[0] ?? null;
  const shelves = groupByCategory(books);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Khám phá</Text>
        <Pressable style={styles.searchButton} onPress={() => router.push('/customer/search')}>
          <Text style={styles.searchButtonText}>TÌM</Text>
        </Pressable>
      </View>

      {catalog.loadingInitial && books.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : catalog.error && books.length === 0 ? (
        <Pressable style={styles.center} onPress={catalog.retry} accessibilityRole="button">
          <Text style={styles.error}>{catalog.error} · Thử lại</Text>
        </Pressable>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          // Pull-to-refresh reloads page 1 and replaces the shelves.
          refreshControl={<RefreshControl refreshing={catalog.refreshing} onRefresh={catalog.refresh} tintColor={colors.primary} />}
        >
          {featured ? (
            <HeroBanner
              title={featured.title}
              author={featured.author}
              category={featured.category}
              coverImageUrl={featured.cover_image_url}
              onPress={() => router.push(`/customer/book/${featured.id}`)}
            />
          ) : null}

          {shelves.map((shelf) => (
            <View key={shelf.category} style={styles.shelf}>
              <Text style={styles.shelfTitle}>{shelf.category}</Text>
              <FlatList
                data={shelf.books}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.shelfList}
                renderItem={({ item }) => (
                  <PosterCard
                    title={item.title}
                    category={item.category}
                    coverImageUrl={item.cover_image_url}
                    onPress={() => router.push(`/customer/book/${item.id}`)}
                  />
                )}
              />
            </View>
          ))}

          {catalog.hasNextPage || catalog.error ? (
            <Pressable
              style={[styles.moreButton, catalog.loadingMore && styles.moreButtonDisabled]}
              onPress={catalog.error ? catalog.retry : catalog.loadMore}
              disabled={catalog.loadingMore || catalog.refreshing}
              accessibilityRole="button"
              accessibilityState={{ disabled: catalog.loadingMore || catalog.refreshing }}
            >
              {catalog.loadingMore ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={styles.moreButtonText}>
                  {catalog.error ? 'Không tải thêm được · Thử lại' : `Tải thêm sách (${books.length}/${catalog.total})`}
                </Text>
              )}
            </Pressable>
          ) : null}
        </ScrollView>
      )}
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
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchButtonText: {
    fontFamily: typography.label.fontFamily,
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  error: {
    color: colors.danger,
    fontWeight: '600',
  },
  content: {
    paddingBottom: 120,
  },
  shelf: {
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  shelfTitle: {
    ...typography.label,
    marginLeft: spacing.lg,
  },
  moreButton: {
    marginTop: spacing.xl,
    marginHorizontal: spacing.lg,
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreButtonDisabled: {
    opacity: 0.6,
  },
  moreButtonText: {
    ...typography.bodyBold,
  },
  shelfList: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
});
