import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as engagementApi from '../../src/api/customerEngagement';
import type { CustomerNotification } from '../../src/api/customerEngagement';
import { ApiError } from '../../src/auth/auth-context';
import { usePagedList } from '../../src/hooks/usePagedList';
import { setUnreadCount, useUnreadNotifications } from '../../src/hooks/useUnreadNotifications';
import { notificationTarget } from '../../src/lib/notificationTarget';
import { EmptyState, ErrorState, FilterChips, InlineAlert, PressableScale, ScreenHeader, Skeleton, fontFamily, radii, space, useTheme } from '../../src/design-system';

type Filter = 'all' | 'unread';
const PAGE_SIZE = 20;

const fetchNotifications = async (params: { filter: Filter }, page: number) => {
  const result = await engagementApi.getMyNotifications(page, PAGE_SIZE, params.filter === 'unread' ? 'unread' : undefined);
  setUnreadCount(result.meta.unread_count);
  return { items: result.data, page: result.meta.page, totalPages: result.meta.totalPages, total: result.meta.total };
};

function timeLabel(iso: string): string {
  const date = new Date(iso);
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (diffMinutes < 1) return 'Vừa xong';
  if (diffMinutes < 60) return `${diffMinutes} phút trước`;
  if (diffMinutes < 24 * 60) return `${Math.round(diffMinutes / 60)} giờ trước`;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function CustomerNotificationsScreen() {
  const { colors, type } = useTheme();
  const [filter, setFilter] = useState<Filter>('all');
  // Rows read on this screen, so they turn "read" immediately without refetching the page.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [markingAll, setMarkingAll] = useState(false);
  const unread = useUnreadNotifications();
  const list = usePagedList<CustomerNotification, { filter: Filter }>(fetchNotifications, { filter }, 'Không tải được thông báo');

  const isRead = useCallback((item: CustomerNotification) => Boolean(item.read_at) || readIds.has(item.id), [readIds]);

  async function handleOpen(item: CustomerNotification) {
    if (!isRead(item)) {
      setReadIds((prev) => new Set(prev).add(item.id));
      engagementApi
        .markNotificationRead(item.id)
        .then((result) => setUnreadCount(result.data.unread_count))
        .catch(() => {
          // Not marked server-side: show it as unread again so the badge stays honest.
          setReadIds((prev) => {
            const next = new Set(prev);
            next.delete(item.id);
            return next;
          });
        });
    }
    const target = notificationTarget(item);
    if (target) router.push(target as never);
  }

  async function handleMarkAll() {
    if (markingAll || unread.count === 0) return;
    setMarkingAll(true);
    try {
      await engagementApi.markAllNotificationsRead();
      setUnreadCount(0);
      setReadIds(new Set(list.items.map((item) => item.id)));
      if (filter === 'unread') void list.refresh();
    } catch (err) {
      // Keep the list as it is; the button can simply be tapped again.
      console.warn('markAll failed', err instanceof ApiError ? err.message : err);
    } finally {
      setMarkingAll(false);
    }
  }

  return (
    <>
      <ScreenHeader
        title="Thông báo"
        right={unread.count > 0 ? (
          <Pressable
            onPress={handleMarkAll}
            disabled={markingAll}
            accessibilityRole="button"
            accessibilityLabel="Đánh dấu tất cả đã đọc"
            style={{ minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: space.xs }}
          >
            {markingAll ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={{ fontFamily: fontFamily.semibold, fontSize: 15, color: colors.primary }}>Đọc tất cả</Text>}
          </Pressable>
        ) : undefined}
      />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm }}>
          <FilterChips
            accessibilityLabel="Lọc thông báo"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all', label: 'Tất cả' }, { value: 'unread', label: 'Chưa đọc', count: unread.count > 0 ? unread.count : undefined }]}
          />
        </View>

        {list.loadingInitial && list.items.length === 0 ? (
          <View style={{ padding: space.lg, gap: space.md }} accessibilityLabel="Đang tải">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={82} radius={radii.md} />)}
          </View>
        ) : list.error && list.items.length === 0 ? (
          <ErrorState message={list.error} onRetry={list.retry} />
        ) : (
          <FlatList
            data={list.items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: space.lg, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.sm, flexGrow: 1 }}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ListEmptyComponent={
              <EmptyState icon="notifications-off-outline" title={filter === 'unread' ? 'Bạn đã đọc hết thông báo' : 'Chưa có thông báo nào'} message="Thư viện sẽ báo ở đây khi sách sẵn sàng, sắp đến hạn trả hoặc có sách bạn chờ." />
            }
            ListFooterComponent={
              list.loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: space.lg }} /> : list.error ? (
                <InlineAlert message="Không tải thêm được thông báo." actionLabel="Thử lại" onAction={list.retry} />
              ) : undefined
            }
            renderItem={({ item }) => {
              const read = isRead(item);
              const target = notificationTarget(item);
              return (
                <PressableScale
                  onPress={() => void handleOpen(item)}
                  scale={false}
                  accessibilityRole="button"
                  accessibilityLabel={`${read ? '' : 'Chưa đọc. '}${item.subject ?? ''} ${item.body}`}
                  style={{
                    flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radii.md,
                    backgroundColor: read ? colors.surface : colors.primarySoft, borderWidth: 1, borderColor: read ? colors.border : 'transparent',
                  }}
                  pressedStyle={{ backgroundColor: colors.surfaceRaised }}
                >
                  <View style={{ width: 10, paddingTop: 6 }}>
                    {!read ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary }} /> : null}
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    {item.subject ? (
                      <Text style={{ fontFamily: read ? fontFamily.medium : fontFamily.bold, fontSize: 15.5, lineHeight: 21, color: colors.textPrimary }} numberOfLines={2}>{item.subject}</Text>
                    ) : null}
                    <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={3}>{item.body}</Text>
                    <Text style={{ fontFamily: fontFamily.medium, fontSize: 12.5, color: colors.textMuted }}>{timeLabel(item.scheduled_at)}</Text>
                  </View>
                  {target ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ alignSelf: 'center' }} /> : null}
                </PressableScale>
              );
            }}
          />
        )}
      </View>
    </>
  );
}
