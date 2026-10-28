import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as engagementApi from '../../src/api/customerEngagement';
import { getCatalogBooksByIds } from '../../src/api/customerHome';
import { ApiError } from '../../src/auth/auth-context';
import { BookCover } from '../../src/components/customer/BookCover';
import { EmptyState, InlineAlert, PressableScale, ScreenHeader, Skeleton, StatusBadge, fontFamily, radii, space, useTheme } from '../../src/design-system';
import type { CustomerCatalogBook } from '../../src/types/customerCatalog';

type SavedRow = { book: CustomerCatalogBook; alert: boolean };

export default function CustomerSavedBooksScreen() {
  const { colors, type, shadow } = useTheme();
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
      <ScreenHeader title="Sách đã lưu" />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {isLoading && rows.length === 0 ? (
          <View style={{ padding: space.lg, gap: space.md }} accessibilityLabel="Đang tải">
            {[0, 1, 2].map((i) => <Skeleton key={i} height={110} radius={radii.lg} />)}
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.book.id}
            contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.md, flexGrow: 1 }}
            contentInsetAdjustmentBehavior="automatic"
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
            ListHeaderComponent={
              error || missing > 0 ? (
                <View style={{ gap: space.sm }}>
                  {error ? <InlineAlert message={error} actionLabel="Thử lại" onAction={() => void load()} /> : null}
                  {missing > 0 ? <InlineAlert tone="info" message={`${missing} sách đã lưu hiện không còn trong danh mục công khai.`} /> : null}
                </View>
              ) : undefined
            }
            ListEmptyComponent={
              !error ? (
                <EmptyState icon="heart-outline" title="Chưa có sách nào" message="Nhấn Yêu thích ở trang sách để lưu lại và quay lại sau." actionLabel="Khám phá sách" onAction={() => router.push('/customer')} />
              ) : undefined
            }
            renderItem={({ item }) => {
              const available = item.book.available_quantity > 0;
              return (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingRight: space.xs, borderRadius: radii.lg, backgroundColor: colors.surface, ...shadow.card }}>
                  <PressableScale
                    onPress={() => router.push(`/customer/book/${item.book.id}`)}
                    scale={false}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.book.title}, ${available ? `còn ${item.book.available_quantity} cuốn` : 'hết sách'}`}
                    style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radii.lg }}
                    pressedStyle={{ backgroundColor: colors.surfaceRaised }}
                  >
                    <BookCover title={item.book.title} author={item.book.author} category={item.book.category} coverImageUrl={item.book.cover_image_url} width={56} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ fontFamily: fontFamily.serif, fontSize: 16.5, lineHeight: 21, color: colors.textPrimary }} numberOfLines={2}>{item.book.title}</Text>
                      {item.book.author ? <Text style={type.caption} numberOfLines={1}>{item.book.author}</Text> : null}
                      {available ? (
                        <StatusBadge tone="success" label={`Còn ${item.book.available_quantity} cuốn, đặt trước được`} />
                      ) : (
                        <StatusBadge tone={item.alert ? 'info' : 'neutral'} label={item.alert ? 'Hết sách, sẽ báo khi có' : 'Hết sách'} icon={item.alert ? 'notifications' : null} />
                      )}
                    </View>
                  </PressableScale>
                  <Pressable
                    onPress={() => void handleRemove(item.book.id)}
                    style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
                    disabled={removingId !== null}
                    accessibilityRole="button"
                    accessibilityLabel={`Bỏ lưu ${item.book.title}`}
                  >
                    {removingId === item.book.id ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="heart" size={22} color={colors.danger} />}
                  </Pressable>
                </View>
              );
            }}
          />
        )}
      </View>
    </>
  );
}
