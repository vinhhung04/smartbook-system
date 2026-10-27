import { useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PosterCard } from '../../src/components/customer/PosterCard';
import { colors, radius, spacing, typography } from '../../src/theme/customerTokens';
import { useCatalogPages } from '../../src/hooks/useCatalogPages';

const SEARCH_DEBOUNCE_MS = 400;

export default function CustomerSearchScreen() {
  // Opened from a home "Danh mục" tile: browse that category without typing.
  const params = useLocalSearchParams<{ category?: string; categoryName?: string }>();
  const [category, setCategory] = useState<{ slug: string; name: string } | null>(
    params.category ? { slug: String(params.category), name: String(params.categoryName ?? params.category) } : null,
  );
  const [availableOnly, setAvailableOnly] = useState(false);
  const [search, setSearch] = useState('');
  // The term actually queried: updated after the debounce, so each keystroke
  // does not start a request. Empty → nothing to load.
  const [term, setTerm] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const catalog = useCatalogPages(
    term || category
      ? { ...(term ? { search: term } : {}), ...(category ? { category: category.slug } : {}), ...(availableOnly ? { availability: 'available' as const } : {}) }
      : null,
  );
  const isTyping = search.trim() !== term;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Tìm kiếm',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/customer/scan-cover')}
              hitSlop={8}
              accessibilityLabel="Tìm sách bằng ảnh bìa"
            >
              <Ionicons name="camera-outline" size={22} color={colors.textPrimary} />
            </Pressable>
          ),
        }}
      />
      <View style={styles.container}>
        <TextInput
          style={styles.search}
          placeholder="Tìm theo tên sách, tác giả..."
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={!category}
          returnKeyType="search"
          accessibilityLabel="Tìm sách"
        />
        <View style={styles.filters}>
          {category ? (
            <Pressable style={[styles.filterChip, styles.filterChipActive]} onPress={() => setCategory(null)} accessibilityRole="button" accessibilityLabel={`Bỏ lọc danh mục ${category.name}`}>
              <Text style={styles.filterChipTextActive}>{category.name}</Text>
              <Ionicons name="close" size={14} color={colors.primary} />
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.filterChip, availableOnly && styles.filterChipActive]}
            onPress={() => setAvailableOnly((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ selected: availableOnly }}
          >
            <Text style={availableOnly ? styles.filterChipTextActive : styles.filterChipText}>Chỉ sách còn</Text>
          </Pressable>
          <Pressable style={styles.filterChip} onPress={() => router.push('/customer/assistant')} accessibilityRole="button">
            <Ionicons name="sparkles-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.filterChipText}>Mô tả bằng lời</Text>
          </Pressable>
        </View>

        {(catalog.loadingInitial || (isTyping && catalog.items.length === 0)) && (search.trim() || category) ? (
          <ActivityIndicator color={colors.primary} style={styles.spinner} />
        ) : catalog.error && catalog.items.length === 0 ? (
          <Pressable onPress={catalog.retry} accessibilityRole="button">
            <Text style={styles.error}>{catalog.error} · Thử lại</Text>
          </Pressable>
        ) : (
          <FlatList
            data={catalog.items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            // Guarded in the loader: ignored while a page is loading or after the last page.
            onEndReached={catalog.loadMore}
            onEndReachedThreshold={0.5}
            ListHeaderComponent={
              (term || category) && catalog.total > 0 ? <Text style={styles.count}>{catalog.total} kết quả</Text> : null
            }
            ListFooterComponent={
              catalog.loadingMore ? (
                <ActivityIndicator color={colors.primary} style={styles.footer} />
              ) : catalog.error ? (
                <Pressable onPress={catalog.retry} accessibilityRole="button" style={styles.footer}>
                  <Text style={styles.error}>Không tải thêm được · Thử lại</Text>
                </Pressable>
              ) : null
            }
            ListEmptyComponent={
              term && !isTyping ? <Text style={styles.empty}>Không tìm thấy sách phù hợp</Text> : null
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
    marginBottom: spacing.sm,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primarySoft,
  },
  filterChipText: {
    ...typography.caption,
  },
  filterChipTextActive: {
    ...typography.caption,
    color: colors.primary,
  },
  spinner: {
    marginTop: spacing.xl,
  },
  error: {
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  count: {
    ...typography.caption,
  },
  footer: {
    paddingVertical: spacing.lg,
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
