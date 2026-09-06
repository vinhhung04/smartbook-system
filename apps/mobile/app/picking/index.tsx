import { useCallback, useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import * as pickingApi from '../../src/api/picking';
import * as authApi from '../../src/api/auth';
import { ApiError, useAuth } from '../../src/auth/auth-context';
import type { AvailableTask, PickingTaskListItem } from '../../src/types/picking';
import type { WarehouseStaffOption } from '../../src/types/auth';
import { colors, radius, shadow, spacing, typography } from '../../src/theme/tokens';

const MANAGER_ROLES = ['ADMIN', 'WAREHOUSE_MANAGER'];

type Row =
  | { kind: 'mine'; item: PickingTaskListItem }
  | { kind: 'other'; item: PickingTaskListItem }
  | { kind: 'available'; item: AvailableTask };

type Filter = 'all' | 'mine';

export default function PickingListScreen() {
  const { user } = useAuth();
  const [myTasks, setMyTasks] = useState<PickingTaskListItem[]>([]);
  const [otherTasks, setOtherTasks] = useState<PickingTaskListItem[]>([]);
  const [availableTasks, setAvailableTasks] = useState<AvailableTask[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<WarehouseStaffOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canManage = (user?.roles ?? []).some((role) => MANAGER_ROLES.includes(role));

  const load = useCallback(async () => {
    setError(null);
    try {
      const [mine, available, staff] = await Promise.all([
        pickingApi.getMyTasks(),
        pickingApi.getAvailableTasks(),
        canManage ? authApi.getWarehouseStaff() : Promise.resolve({ data: [] }),
      ]);
      // /api/picking/tasks returns every order eligible for picking in the warehouse
      // to a manager/admin, not just the current picker's — a task claimed by a
      // different picker must still be shown (read-only) so a manager can step in
      // if that picker goes offline mid-task, instead of the task just vanishing.
      setMyTasks(mine.data.filter((t) => t.assigned_picker_user_id === user?.id));
      setOtherTasks(
        mine.data.filter((t) => t.assigned_picker_user_id && t.assigned_picker_user_id !== user?.id),
      );
      setAvailableTasks(available.data.filter((t) => t.type === 'PICKING'));
      setStaffOptions(staff.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được danh sách');
    }
  }, [user?.id, canManage]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  async function handleAssign(taskType: PickingTaskListItem['task_type'], taskId: string, staffId: string) {
    const key = `${taskType}-${taskId}`;
    setAssigningKey(key);
    try {
      await pickingApi.assignTask(taskType, taskId, staffId);
      load();
    } catch (err) {
      Alert.alert('Giao task thất bại', err instanceof ApiError ? err.message : 'Vui lòng thử lại');
    } finally {
      setAssigningKey(null);
    }
  }

  function handleAssignPress(taskType: PickingTaskListItem['task_type'], taskId: string, orderNumber: string) {
    if (staffOptions.length === 0) {
      Alert.alert('Không có nhân viên', 'Không tải được danh sách nhân viên kho.');
      return;
    }
    Alert.alert(
      `Giao đơn ${orderNumber}`,
      'Chọn nhân viên để giao việc lấy hàng',
      [
        ...staffOptions.map((staff) => ({
          text: staff.full_name,
          onPress: () => handleAssign(taskType, taskId, staff.id),
        })),
        { text: 'Hủy', style: 'cancel' as const },
      ],
    );
  }

  const sections =
    filter === 'mine'
      ? [{ title: `Của tôi (${myTasks.length})`, data: myTasks.map((item): Row => ({ kind: 'mine', item })) }]
      : [
          { title: `Đã nhận (${myTasks.length})`, data: myTasks.map((item): Row => ({ kind: 'mine', item })) },
          ...(otherTasks.length > 0
            ? [
                {
                  title: `Đã giao người khác (${otherTasks.length})`,
                  data: otherTasks.map((item): Row => ({ kind: 'other', item })),
                },
              ]
            : []),
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
              `${row.kind}-${row.item.task_type}-${row.kind === 'available' ? row.item.id : row.item.task_id}`
            }
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
            renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
            ListEmptyComponent={<Text style={styles.empty}>Không có phiếu nào</Text>}
            renderItem={({ item: row }) => {
              if (row.kind === 'mine' || row.kind === 'other') {
                const task = row.item;
                const isMine = row.kind === 'mine';
                const key = `${task.task_type}-${task.task_id}`;
                return (
                  <Pressable
                    style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                    onPress={() => router.push(`/picking/${task.task_type}/${task.task_id}`)}
                  >
                    <View style={styles.cardBody}>
                      <View style={styles.titleRow}>
                        <Text style={styles.cardTitle}>{task.order_number}</Text>
                        {task.task_class === 'REPICK' ? (
                          <View style={[styles.badge, styles.badgeRepick]}>
                            <Text style={styles.badgeRepickText}>
                              REPICK{task.repick_sequence ? ` #${task.repick_sequence}` : ''}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.cardSubtitle}>
                        {task.source_warehouse_code ?? '-'} · còn {task.remaining_quantity} sản phẩm
                      </Text>
                    </View>
                    <View style={styles.actionsColumn}>
                      <View style={[styles.badge, isMine ? styles.badgeMine : styles.badgeOther]}>
                        <Text style={isMine ? styles.badgeMineText : styles.badgeOtherText}>
                          {isMine ? 'Đã nhận' : 'Đã giao'}
                        </Text>
                      </View>
                      {canManage ? (
                        <Pressable
                          style={({ pressed }) => [styles.giaoButton, pressed && styles.cardPressed]}
                          onPress={() => handleAssignPress(task.task_type, task.task_id, task.order_number)}
                          disabled={assigningKey === key}
                        >
                          <Text style={styles.giaoButtonText}>
                            {assigningKey === key ? 'Đang giao...' : 'Giao'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </Pressable>
                );
              }

              const task = row.item;
              const key = `${task.task_type}-${task.id}`;
              return (
                <Pressable
                  style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                  onPress={() => router.push(`/picking/${task.task_type}/${task.id}`)}
                >
                  <View style={styles.cardBody}>
                    <View style={styles.titleRow}>
                      <Text style={styles.cardTitle}>{task.title}</Text>
                      {task.is_repick ? (
                        <View style={[styles.badge, styles.badgeRepick]}>
                          <Text style={styles.badgeRepickText}>REPICK</Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.cardSubtitle}>{task.warehouse ?? '-'}</Text>
                  </View>
                  <View style={styles.actionsColumn}>
                    <View style={[styles.badge, styles.badgeAvailable]}>
                      <Text style={styles.badgeAvailableText}>Chưa nhận</Text>
                    </View>
                    {canManage ? (
                      <Pressable
                        style={({ pressed }) => [styles.giaoButton, pressed && styles.cardPressed]}
                        onPress={() => handleAssignPress(task.task_type, task.id, task.title)}
                        disabled={assigningKey === key}
                      >
                        <Text style={styles.giaoButtonText}>
                          {assigningKey === key ? 'Đang giao...' : 'Giao'}
                        </Text>
                      </Pressable>
                    ) : null}
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  badgeRepick: {
    backgroundColor: colors.warningSoft,
    paddingVertical: 2,
    paddingHorizontal: spacing.xs + 2,
  },
  badgeRepickText: {
    color: colors.warning,
    fontWeight: '700',
    fontSize: 10,
  },
  badgeOther: {
    backgroundColor: colors.neutralSoft,
  },
  badgeOtherText: {
    color: colors.neutral,
    fontWeight: '700',
    fontSize: 12,
  },
  actionsColumn: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  giaoButton: {
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  giaoButtonText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
});
