import { useCallback, useRef, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as engagementApi from '../../src/api/customerEngagement';
import { getCatalogBooksByIds } from '../../src/api/customerHome';
import { ApiError } from '../../src/auth/auth-context';
import { PosterCard } from '../../src/components/customer/PosterCard';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/customerTokens';
import type { CustomerCatalogBook } from '../../src/types/customerCatalog';

type SavedRow = { book: CustomerCatalogBook; alert: boolean };

export default function CustomerSavedBooksScreen() {
  const [rows, setRows] = useState<SavedRow[]>([]);
  const [missing, setMissing] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setError(null);
    try {
      const [wishlist, alerts] = await Promise.all([engagementApi.getMyWishlist(), engagementApi.getMyAvailabilityAlerts().catch(() => ({ data: [] }))]);
      const ids = wishlist.data.map((entry) => entry.book_id);
      // The public catalog takes up to 100 ids per request.
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
      const books = (await Promise.all(chunks.map(getCatalogBooksByIds))).flat();
      if (requestId !== requestRef.current) return;
      const byId = new Map(books.map((book) => [book.id, book]));
      const alertIds = new Set(alerts.data.filter((a) => a.status === 'ACTIVE').map((a) => a.book_id));
      setRows(ids.flatMap((id) => (byId.has(id) ? [{ book: byId.get(id)!, alert: alertIds.has(id) }] : [])));
      // Saved books no longer in the public catalog are counted, not shown as broken cards.
      setMissing(ids.filter((id) => !byId.has(id)).length);
    } catch (err) {
      if (requestId === requestRef.current) setError(err instanceof ApiError ? err.message : 'Không tải được sách đã lưu');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  async function handleRemove(bookId: string) {
    if (removingId) return;
    setRemovingId(bookId);
    try {
      await engagementApi.removeFromWishlist(bookId);
      setRows((current) => current.filter((row) => row.book.id !== bookId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không bỏ lưu được');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Sách đã lưu' }} />
      <View style={styles.container}>
        {isLoading && rows.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.book.id}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={async () => {
                  setIsRefreshing(true);
                  await load();
                  setIsRefreshing(false);
                }}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListHeaderComponent={
              <>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {missing > 0 ? <Text style={styles.note}>{missing} sách đã lưu hiện không còn trong danh mục công khai.</Text> : null}
              </>
            }
            ListEmptyComponent={
              !error ? (
                <View style={styles.center}>
                  <Ionicons name="heart-outline" size={28} color={colors.textMuted} />
                  <Text style={styles.note}>Chưa có sách nào. Nhấn “Yêu thích” ở trang sách để lưu lại.</Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <Pressable style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]} onPress={() => router.push(`/customer/book/${item.book.id}`)} accessibilityRole="button" accessibilityLabel={item.book.title}>
                  <PosterCard title={item.book.title} category={item.book.category} coverImageUrl={item.book.cover_image_url} width={56} height={84} />
                  <View style={styles.body}>
                    <Text style={styles.title} numberOfLines={2}>{item.book.title}</Text>
                    {item.book.author ? <Text style={styles.caption} numberOfLines={1}>{item.book.author}</Text> : null}
                    <Text style={[styles.caption, item.book.available_quantity > 0 ? styles.available : styles.unavailable]}>
                      {item.book.available_quantity > 0 ? `Còn ${item.book.available_quantity} cuốn — đặt trước được` : item.alert ? 'Hết sách · sẽ báo khi có' : 'Hết sách'}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => void handleRemove(item.book.id)}
                  hitSlop={10}
                  style={styles.remove}
                  disabled={removingId !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`Bỏ lưu ${item.book.title}`}
                >
                  {removingId === item.book.id ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="heart" size={20} color={colors.danger} />}
                </Pressable>
              </View>
            )}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  separator: { height: spacing.sm },
  error: { color: colors.danger, fontWeight: '600', marginBottom: spacing.sm },
  note: { ...typography.caption, textAlign: 'center', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pressed: { opacity: 0.85 },
  body: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.display, fontSize: 15, color: colors.textPrimary },
  caption: { ...typography.caption, fontSize: 12 },
  available: { color: colors.success },
  unavailable: { color: colors.warning },
  remove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
