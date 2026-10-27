import { useCallback, useState } from 'react';
import { Stack, router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as engagementApi from '../../src/api/customerEngagement';
import type { CustomerNotification } from '../../src/api/customerEngagement';
import { ApiError } from '../../src/auth/auth-context';
import { usePagedList } from '../../src/hooks/usePagedList';
import { setUnreadCount, useUnreadNotifications } from '../../src/hooks/useUnreadNotifications';
import { notificationTarget } from '../../src/lib/notificationTarget';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/customerTokens';

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
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Thông báo',
          headerRight: () =>
            unread.count > 0 ? (
              <Pressable onPress={handleMarkAll} hitSlop={10} disabled={markingAll} accessibilityRole="button" accessibilityLabel="Đánh dấu tất cả đã đọc">
                {markingAll ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.headerAction}>Đọc tất cả</Text>}
              </Pressable>
            ) : null,
        }}
      />
      <View style={styles.container}>
        <View style={styles.filters}>
          {(['all', 'unread'] as const).map((key) => (
            <Pressable
              key={key}
              style={[styles.chip, filter === key && styles.chipActive]}
              onPress={() => setFilter(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === key }}
            >
              <Text style={[styles.chipText, filter === key && styles.chipTextActive]}>
                {key === 'all' ? 'Tất cả' : `Chưa đọc${unread.count > 0 ? ` (${unread.count})` : ''}`}
              </Text>
            </Pressable>
          ))}
        </View>

        {list.loadingInitial && list.items.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : list.error && list.items.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.error}>{list.error}</Text>
            <Pressable style={styles.retry} onPress={list.retry} accessibilityRole="button">
              <Text style={styles.headerAction}>Thử lại</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={list.items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
            onEndReached={list.loadMore}
            onEndReachedThreshold={0.4}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.center}>
                <Ionicons name="notifications-off-outline" size={28} color={colors.textMuted} />
                <Text style={styles.empty}>{filter === 'unread' ? 'Bạn đã đọc hết thông báo.' : 'Chưa có thông báo nào.'}</Text>
              </View>
            }
            ListFooterComponent={
              list.loadingMore ? <ActivityIndicator color={colors.primary} style={styles.footer} /> : list.error ? (
                <Pressable onPress={list.retry} style={styles.footer} accessibilityRole="button">
                  <Text style={styles.error}>Không tải thêm được · Thử lại</Text>
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => {
              const read = isRead(item);
              const target = notificationTarget(item);
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, !read && styles.rowUnread, pressed && styles.pressed]}
                  onPress={() => void handleOpen(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${read ? '' : 'Chưa đọc. '}${item.subject ?? ''} ${item.body}`}
                >
                  <View style={[styles.dot, read && styles.dotRead]} />
                  <View style={styles.body}>
                    {item.subject ? <Text style={[styles.subject, !read && styles.subjectUnread]} numberOfLines={2}>{item.subject}</Text> : null}
                    <Text style={styles.text} numberOfLines={3}>{item.body}</Text>
                    <Text style={styles.time}>{timeLabel(item.scheduled_at)}</Text>
                  </View>
                  {target ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
                </Pressable>
              );
            }}
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
  },
  headerAction: {
    fontFamily: fonts.bodySemibold,
    color: colors.primary,
    fontSize: 14,
  },
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    borderColor: colors.primaryBorder,
    backgroundColor: colors.primarySoft,
  },
  chipText: {
    ...typography.caption,
  },
  chipTextActive: {
    color: colors.primary,
    fontFamily: fonts.bodySemibold,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  error: {
    color: colors.danger,
    textAlign: 'center',
    fontWeight: '600',
  },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
    flexGrow: 1,
  },
  separator: {
    height: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowUnread: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  pressed: {
    opacity: 0.85,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  dotRead: {
    backgroundColor: 'transparent',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  subject: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.textSecondary,
  },
  subjectUnread: {
    color: colors.textPrimary,
  },
  text: {
    ...typography.caption,
  },
  time: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
  },
  empty: {
    ...typography.caption,
    textAlign: 'center',
  },
  footer: {
    padding: spacing.lg,
  },
});
