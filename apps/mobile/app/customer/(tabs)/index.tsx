import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as customerCatalogApi from '../../../src/api/customerCatalog';
import { ApiError } from '../../../src/auth/auth-context';
import { HeroBanner } from '../../../src/components/customer/HeroBanner';
import { PosterCard } from '../../../src/components/customer/PosterCard';
import { colors, radius, spacing, typography } from '../../../src/theme/customerTokens';
import type { CustomerCatalogBook } from '../../../src/types/customerCatalog';

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
  const [books, setBooks] = useState<CustomerCatalogBook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // 16 seeded books total — small enough to fetch once and group/browse
      // client-side, rather than paginating a home-browse surface.
      const result = await customerCatalogApi.getCatalogBooks({});
      setBooks(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được danh mục sách');
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

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

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
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
  shelfList: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
});
