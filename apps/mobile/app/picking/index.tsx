import { useCallback, useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import * as pickingApi from '../../src/api/picking';
import { ApiError, useAuth } from '../../src/auth/auth-context';
import type { AvailableTask, PickingTaskListItem } from '../../src/types/picking';
import { colors, radius, shadow, spacing, typography } from '../../src/theme/tokens';

type Row =
  | { kind: 'mine'; item: PickingTaskListItem }
  | { kind: 'available'; item: AvailableTask };

type Filter = 'all' | 'mine';

export default function PickingListScreen() {
  const { user } = useAuth();
  const [myTasks, setMyTasks] = useState<PickingTaskListItem[]>([]);
  const [availableTasks, setAvailableTasks] = useState<AvailableTask[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [mine, available] = await Promise.all([
        pickingApi.getMyTasks(),
        pickingApi.getAvailableTasks(),
      ]);
      // /api/picking/tasks returns every order eligible for picking in the warehouse,
      // not just the current picker's — filter to tasks actually assigned to me,
      // otherwise an unclaimed order shows up as both "mine" and "available".
      setMyTasks(mine.data.filter((t) => t.assigned_picker_user_id === user?.id));
      setAvailableTasks(available.data.filter((t) => t.type === 'PICKING'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được danh sách');
    }
  }, [user?.id]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  const sections =
    filter === 'mine'
      ? [{ title: `Của tôi (${myTasks.length})`, data: myTasks.map((item): Row => ({ kind: 'mine', item })) }]
      : [
          { title: `Đã nhận (${myTasks.length})`, data: myTasks.map((item): Row => ({ kind: 'mine', item })) },
          {
            title: `Có thể nhận (${availableTasks.length})`,
            data: availableTasks.map((item): Row => ({ kind: 'available', item })),
          },
        ];

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Picking' }} />
      <View style={styles.container}>
        <View style={styles.filterRow}>
          <Pressable
            style={[styles.filterButton, filter === 'all' && styles.filterButtonActive]}
            onPress={() => setFilter('all')}
          >
            <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>Tất cả</Text>
          </Pressable>
          <Pressable
            style={[styles.filterButton, filter === 'mine' && styles.filterButtonActive]}
            onPress={() => setFilter('mine')}
          >
            <Text style={[styles.filterText, filter === 'mine' && styles.filterTextActive]}>Của tôi</Text>
          </Pressable>
        </View>


        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(row) =>
              `${row.kind}-${row.item.task_type}-${row.kind === 'mine' ? row.item.task_id : row.item.id}`
            }
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
            renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
            ListEmptyComponent={<Text style={styles.empty}>Không có phiếu nào</Text>}
            renderItem={({ item: row }) => {
              if (row.kind === 'mine') {
                const task = row.item;
                return (
                  <Pressable
                    style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                    onPress={() => router.push(`/picking/${task.task_type}/${task.task_id}`)}
                  >
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle}>{task.order_number}</Text>
                      <Text style={styles.cardSubtitle}>
                        {task.source_warehouse_code ?? '-'} · còn {task.remaining_quantity} sản phẩm
                      </Text>
                    </View>
                    <View style={[styles.badge, styles.badgeMine]}>
                      <Text style={styles.badgeMineText}>Đã nhận</Text>
                    </View>
                  </Pressable>
                );
              }

              const task = row.item;
              return (
                <Pressable
                  style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                  onPress={() => router.push(`/picking/${task.task_type}/${task.id}`)}
                >
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{task.title}</Text>
                    <Text style={styles.cardSubtitle}>{task.warehouse ?? '-'}</Text>
                  </View>
                  <View style={[styles.badge, styles.badgeAvailable]}>
                    <Text style={styles.badgeAvailableText}>Chưa nhận</Text>
                  </View>
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  filterButton: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  filterTextActive: {
    color: colors.onPrimary,
  },
  errorBox: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  sectionTitle: {
    ...typography.label,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    padding: spacing.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginVertical: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardBody: {
    flex: 1,
    marginRight: spacing.sm,
  },
  cardTitle: {
    ...typography.h3,
  },
  cardSubtitle: {
    ...typography.caption,
    marginTop: 2,
  },
  badge: {
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
  },
  badgeMine: {
    backgroundColor: colors.successSoft,
  },
  badgeMineText: {
    color: colors.success,
    fontWeight: '700',
    fontSize: 12,
  },
  badgeAvailable: {
    backgroundColor: colors.primarySoft,
  },
  badgeAvailableText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
});
