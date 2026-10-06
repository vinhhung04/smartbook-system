import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PosterCard } from '../../src/components/customer/PosterCard';
import { colors, radius, spacing, typography } from '../../src/theme/customerTokens';
import { useCatalogPages } from '../../src/hooks/useCatalogPages';

const SEARCH_DEBOUNCE_MS = 400;

export default function CustomerSearchScreen() {
  const [search, setSearch] = useState('');
  // The term actually queried: updated after the debounce, so each keystroke
  // does not start a request. Empty → nothing to load.
  const [term, setTerm] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const catalog = useCatalogPages(term ? { search: term } : null);
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
          autoFocus
        />

        {(catalog.loadingInitial || (isTyping && catalog.items.length === 0)) && search.trim() ? (
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
              term && catalog.total > 0 ? <Text style={styles.count}>{catalog.total} kết quả</Text> : null
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
