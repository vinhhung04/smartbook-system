import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Alert, RefreshControl, SectionList, Text, View } from 'react-native';

import * as pickingApi from '../../src/api/picking';
import { ApiError, useAuth } from '../../src/auth/auth-context';
import { isWarehouseManager } from '../../src/auth/access';
import { SelectionSheet } from '../../src/components/SelectionSheet';
import { WorkOrderCard } from '../../src/components/WorkOrderCard';
import { useWarehouseStaff, type StaffOption } from '../../src/hooks/useWarehouseStaff';
import type { AvailableTask, PickingTaskListItem } from '../../src/types/picking';
import { EmptyState, InlineAlert, ScreenHeader, SegmentedControl, Skeleton, StatusBadge, radii, space, useTheme } from '../../src/design-system';

type Row =
  | { kind: 'mine'; item: PickingTaskListItem }
  | { kind: 'other'; item: PickingTaskListItem }
  | { kind: 'available'; item: AvailableTask };

type Filter = 'all' | 'mine';

export default function PickingListScreen() {
  const { user } = useAuth();
  const { colors, type } = useTheme();
  const [myTasks, setMyTasks] = useState<PickingTaskListItem[]>([]);
  const [otherTasks, setOtherTasks] = useState<PickingTaskListItem[]>([]);
  const [availableTasks, setAvailableTasks] = useState<AvailableTask[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [assigningKey, setAssigningKey] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<{ taskType: PickingTaskListItem['task_type']; taskId: string; orderNumber: string; currentAssigneeId: string | null } | null>(null);
  const staff = useWarehouseStaff();
  const [error, setError] = useState<string | null>(null);

  const canManage = isWarehouseManager(user);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [mine, available] = await Promise.all([
        pickingApi.getMyTasks(),
        pickingApi.getAvailableTasks(),
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

  async function handleAssign(option: StaffOption) {
    const target = assignTarget;
    if (!target || assigningKey) return;
    setAssignTarget(null);
    const key = `${target.taskType}-${target.taskId}`;
    setAssigningKey(key);
    try {
      await pickingApi.assignTask(target.taskType, target.taskId, option.userId);
      await load();
    } catch (err) {
      Alert.alert('Giao task thất bại', err instanceof ApiError ? err.message : 'Vui lòng thử lại');
    } finally {
      setAssigningKey(null);
    }
  }

  function handleAssignPress(taskType: PickingTaskListItem['task_type'], taskId: string, orderNumber: string, currentAssigneeId: string | null = null) {
    staff.ensureLoaded();
    setAssignTarget({ taskType, taskId, orderNumber, currentAssigneeId });
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
      <ScreenHeader title="Lấy hàng" />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.md }}>
          <SegmentedControl
            accessibilityLabel="Phạm vi phiếu"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all', label: 'Tất cả' }, { value: 'mine', label: 'Của tôi', count: myTasks.length }]}
          />
          {error ? <InlineAlert message={error} actionLabel="Thử lại" onAction={() => void handleRefresh()} /> : null}
        </View>

        {isLoading ? (
          <View style={{ paddingHorizontal: space.lg, gap: space.md }} accessibilityLabel="Đang tải phiếu">
            {[0, 1, 2].map((i) => <Skeleton key={i} height={104} radius={radii.md} />)}
          </View>
        ) : (
          <SectionList
            sections={sections}
            contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
            stickySectionHeadersEnabled={false}
            keyExtractor={(row) =>
              `${row.kind}-${row.item.task_type}-${row.kind === 'available' ? row.item.id : row.item.task_id}`
            }
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
            renderSectionHeader={({ section }) => (
              <Text style={[type.heading, { marginTop: space.lg, marginBottom: space.sm }]} accessibilityRole="header">{section.title}</Text>
            )}
            renderSectionFooter={({ section }) => (section.data.length === 0 ? <Text style={type.caption}>Không có phiếu nào.</Text> : null)}
            ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
            ListEmptyComponent={<EmptyState icon="basket-outline" title="Không có phiếu lấy hàng nào" message="Kéo xuống để làm mới khi có đơn mới." />}
            renderItem={({ item: row }) => {
              if (row.kind === 'mine' || row.kind === 'other') {
                const task = row.item;
                const isMine = row.kind === 'mine';
                const key = `${task.task_type}-${task.task_id}`;
                return (
                  <WorkOrderCard
                    code={task.order_number}
                    detail={`Kho ${task.source_warehouse_code ?? '—'}, còn ${task.remaining_quantity} sản phẩm cần lấy`}
                    onOpen={() => router.push(`/picking/${task.task_type}/${task.task_id}`)}
                    accessibilityLabel={`Đơn ${task.order_number}, ${isMine ? 'bạn đã nhận' : 'đã giao người khác'}, còn ${task.remaining_quantity} sản phẩm`}
                    badges={(
                      <>
                        <StatusBadge tone={isMine ? 'primary' : 'neutral'} label={isMine ? 'Bạn đã nhận' : 'Đã giao người khác'} icon={isMine ? 'person' : 'people-outline'} />
                        {task.task_class === 'REPICK' ? <StatusBadge tone="warning" label={`Lấy bù${task.repick_sequence ? ` lần ${task.repick_sequence}` : ''}`} icon="repeat" /> : null}
                      </>
                    )}
                    action={canManage ? {
                      label: 'Giao cho nhân viên', busyLabel: 'Đang giao…', busy: assigningKey === key,
                      onPress: () => handleAssignPress(task.task_type, task.task_id, task.order_number, task.assigned_picker_user_id),
                      accessibilityLabel: `Giao đơn ${task.order_number} cho nhân viên khác`,
                    } : null}
                  />
                );
              }

              const task = row.item;
              const key = `${task.task_type}-${task.id}`;
              return (
                <WorkOrderCard
                  code={task.title}
                  detail={task.warehouse ? `Kho ${task.warehouse}` : null}
                  onOpen={() => router.push(`/picking/${task.task_type}/${task.id}`)}
                  accessibilityLabel={`Đơn ${task.title}, chưa có người nhận`}
                  badges={(
                    <>
                      <StatusBadge tone="info" label="Chưa có người nhận" icon="hand-left-outline" />
                      {task.is_repick ? <StatusBadge tone="warning" label="Lấy bù" icon="repeat" /> : null}
                    </>
                  )}
                  action={canManage ? {
                    label: 'Giao cho nhân viên', busyLabel: 'Đang giao…', busy: assigningKey === key,
                    onPress: () => handleAssignPress(task.task_type, task.id, task.title),
                    accessibilityLabel: `Giao đơn ${task.title} cho nhân viên`,
                  } : null}
                />
              );
            }}
          />
        )}
      </View>

      <SelectionSheet
        visible={assignTarget !== null}
        title={assignTarget ? `Giao đơn ${assignTarget.orderNumber}` : ''}
        options={staff.options}
        selectedId={assignTarget?.currentAssigneeId}
        loading={staff.loading}
        error={staff.error}
        onRetry={staff.reload}
        onSelect={handleAssign}
        onClose={() => setAssignTarget(null)}
        searchPlaceholder="Tìm nhân viên theo tên, tài khoản, email"
        emptyText="Không có nhân viên kho nào trong phạm vi kho của bạn"
      />
    </>
  );
}

