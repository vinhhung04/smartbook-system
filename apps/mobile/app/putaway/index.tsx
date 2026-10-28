import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Alert, RefreshControl, SectionList, Text, View } from 'react-native';

import * as putawayApi from '../../src/api/putaway';
import { ApiError, useAuth } from '../../src/auth/auth-context';
import { isWarehouseManager } from '../../src/auth/access';
import { SelectionSheet } from '../../src/components/SelectionSheet';
import { WorkOrderCard } from '../../src/components/WorkOrderCard';
import { useWarehouseStaff, type StaffOption } from '../../src/hooks/useWarehouseStaff';
import type { PutawayReceiptSummary } from '../../src/types/putaway';
import { EmptyState, InlineAlert, ScreenHeader, SegmentedControl, Skeleton, StatusBadge, radii, space, useTheme } from '../../src/design-system';

type Row = { kind: 'mine' | 'other' | 'available'; item: PutawayReceiptSummary };
type Filter = 'all' | 'mine';

export default function PutawayListScreen() {
  const { user } = useAuth();
  const { colors, type } = useTheme();
  const [myReceipts, setMyReceipts] = useState<PutawayReceiptSummary[]>([]);
  const [otherReceipts, setOtherReceipts] = useState<PutawayReceiptSummary[]>([]);
  const [availableReceipts, setAvailableReceipts] = useState<PutawayReceiptSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignTarget, setAssignTarget] = useState<PutawayReceiptSummary | null>(null);
  const staff = useWarehouseStaff();
  const [error, setError] = useState<string | null>(null);

  const canManage = isWarehouseManager(user);

  const load = useCallback(async () => {
    setError(null);
    try {
      // getReadyReceipts() returns EVERY POSTED receipt to a manager/admin (see
      // filterReceiptsForStaff on the backend), not just ones unassigned or claimed
      // by the current user — so a receipt claimed by a different staff member must
      // still be shown here (as read-only), otherwise it silently vanishes from the
      // list and a manager can't step in if that staff member goes offline mid-task.
      const receipts = await putawayApi.getReadyReceipts();
      setMyReceipts(receipts.filter((r) => r.putaway_assignee_user_id === user?.id));
      setOtherReceipts(
        receipts.filter((r) => r.putaway_assignee_user_id && r.putaway_assignee_user_id !== user?.id),
      );
      setAvailableReceipts(receipts.filter((r) => !r.putaway_assignee_user_id));
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

  async function handleOpenMine(receipt: PutawayReceiptSummary) {
    router.push(`/putaway/receipt/${receipt.id}`);
  }

  async function handleClaim(receipt: PutawayReceiptSummary) {
    if (claimingId) return;
    setClaimingId(receipt.id);
    try {
      await putawayApi.claimReceipt(receipt.id);
      router.push(`/putaway/receipt/${receipt.id}`);
      load();
    } catch (err) {
      Alert.alert('Nhận phiếu thất bại', err instanceof ApiError ? err.message : 'Vui lòng thử lại');
    } finally {
      setClaimingId(null);
    }
  }

  async function handleAssign(option: StaffOption) {
    const receipt = assignTarget;
    if (!receipt || assigningId) return;
    setAssignTarget(null);
    setAssigningId(receipt.id);
    try {
      await putawayApi.assignReceipt(receipt.id, option.userId);
      await load();
    } catch (err) {
      Alert.alert('Giao phiếu thất bại', err instanceof ApiError ? err.message : 'Vui lòng thử lại');
    } finally {
      setAssigningId(null);
    }
  }

  function handleAssignPress(receipt: PutawayReceiptSummary) {
    staff.ensureLoaded();
    setAssignTarget(receipt);
  }

  const sections =
    filter === 'mine'
      ? [{ title: `Của tôi (${myReceipts.length})`, data: myReceipts.map((item): Row => ({ kind: 'mine', item })) }]
      : [
          { title: `Đã nhận (${myReceipts.length})`, data: myReceipts.map((item): Row => ({ kind: 'mine', item })) },
          ...(otherReceipts.length > 0
            ? [
                {
                  title: `Đã giao người khác (${otherReceipts.length})`,
                  data: otherReceipts.map((item): Row => ({ kind: 'other', item })),
                },
              ]
            : []),
          {
            title: `Có thể nhận (${availableReceipts.length})`,
            data: availableReceipts.map((item): Row => ({ kind: 'available', item })),
          },
        ];

  return (
    <>
      <ScreenHeader title="Cất hàng lên kệ" />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.md }}>
          <SegmentedControl
            accessibilityLabel="Phạm vi phiếu"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all', label: 'Tất cả' }, { value: 'mine', label: 'Của tôi', count: myReceipts.length }]}
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
            keyExtractor={(row) => `${row.kind}-${row.item.id}`}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
            renderSectionHeader={({ section }) => (
              <Text style={[type.heading, { marginTop: space.lg, marginBottom: space.sm }]} accessibilityRole="header">{section.title}</Text>
            )}
            renderSectionFooter={({ section }) => (section.data.length === 0 ? <Text style={type.caption}>Không có phiếu nào.</Text> : null)}
            ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
            ListEmptyComponent={<EmptyState icon="archive-outline" title="Không có phiếu nào chờ cất hàng" message="Kéo xuống để làm mới khi có phiếu nhập mới." />}
            renderItem={({ item: row }) => {
              const receipt = row.item;
              const detail = `Kho ${receipt.warehouse_code ?? '—'}, còn ${receipt.remaining_quantity} sản phẩm cần cất`;
              const action = canManage ? {
                label: 'Giao cho nhân viên', busyLabel: 'Đang giao…', busy: assigningId === receipt.id,
                onPress: () => handleAssignPress(receipt),
                accessibilityLabel: `Giao phiếu ${receipt.receipt_number} cho nhân viên`,
              } : null;

              if (row.kind === 'mine' || row.kind === 'other') {
                const isMine = row.kind === 'mine';
                return (
                  <WorkOrderCard
                    code={receipt.receipt_number}
                    detail={detail}
                    onOpen={() => handleOpenMine(receipt)}
                    accessibilityLabel={`Phiếu ${receipt.receipt_number}, ${isMine ? 'bạn đã nhận' : 'đã giao người khác'}, còn ${receipt.remaining_quantity} sản phẩm`}
                    badges={<StatusBadge tone={isMine ? 'primary' : 'neutral'} label={isMine ? 'Bạn đã nhận' : 'Đã giao người khác'} icon={isMine ? 'person' : 'people-outline'} />}
                    action={action}
                  />
                );
              }

              return (
                <WorkOrderCard
                  code={receipt.receipt_number}
                  detail={detail}
                  onOpen={() => handleClaim(receipt)}
                  cta="Nhận phiếu"
                  busy={claimingId === receipt.id}
                  accessibilityLabel={`Nhận phiếu ${receipt.receipt_number}, còn ${receipt.remaining_quantity} sản phẩm`}
                  badges={<StatusBadge tone="info" label="Chưa có người nhận" icon="hand-left-outline" />}
                  action={action}
                />
              );
            }}
          />
        )}
      </View>

      <SelectionSheet
        visible={assignTarget !== null}
        title={assignTarget ? `Giao phiếu ${assignTarget.receipt_number}` : ''}
        options={staff.options}
        selectedId={assignTarget?.putaway_assignee_user_id}
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

