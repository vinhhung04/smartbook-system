import { useCallback, useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';

import * as customerCatalogApi from '../../src/api/customerCatalog';
import { ApiError } from '../../src/auth/auth-context';
import { PosterCard } from '../../src/components/customer/PosterCard';
import { colors, radius, spacing, typography } from '../../src/theme/customerTokens';
import type { CustomerCatalogBook } from '../../src/types/customerCatalog';

const SEARCH_DEBOUNCE_MS = 400;

export default function CustomerSearchScreen() {
  const [books, setBooks] = useState<CustomerCatalogBook[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (searchTerm: string) => {
    setError(null);
    try {
      const result = await customerCatalogApi.getCatalogBooks({ search: searchTerm || undefined });
      setBooks(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được kết quả tìm kiếm');
    }
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setBooks([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const timer = setTimeout(() => {
      load(search).finally(() => setIsLoading(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, load]);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Tìm kiếm' }} />
      <View style={styles.container}>
        <TextInput
          style={styles.search}
          placeholder="Tìm theo tên sách, tác giả..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.spinner} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : (
          <FlatList
            data={books}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              search.trim() ? <Text style={styles.empty}>Không tìm thấy sách phù hợp</Text> : null
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <PosterCard
                  title={item.title}
                  category={item.category}
                  coverImageUrl={item.cover_image_url}
                  width={80}
                  height={120}
                  onPress={() => router.push(`/customer/book/${item.id}`)}
                />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {item.author ?? 'Chưa rõ tác giả'}
                    {item.category ? ` · ${item.category}` : ''}
                  </Text>
                  <Text style={styles.rowAvailability}>
                    {item.available_quantity > 0 ? `Còn ${item.available_quantity} cuốn` : 'Hết sách'}
                  </Text>
                </View>
              </View>
            )}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  search: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  spinner: {
    marginTop: spacing.xl,
  },
  error: {
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  rowTitle: {
    ...typography.bodyBold,
  },
  rowMeta: {
    ...typography.caption,
  },
  rowAvailability: {
    ...typography.caption,
    color: colors.primary,
  },
});
