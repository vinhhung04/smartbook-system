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

import * as putawayApi from '../../src/api/putaway';
import * as authApi from '../../src/api/auth';
import { ApiError, useAuth } from '../../src/auth/auth-context';
import type { PutawayReceiptSummary } from '../../src/types/putaway';
import type { WarehouseStaffOption } from '../../src/types/auth';
import { colors, radius, shadow, spacing, typography } from '../../src/theme/tokens';

const MANAGER_ROLES = ['ADMIN', 'WAREHOUSE_MANAGER'];

type Row = { kind: 'mine' | 'other' | 'available'; item: PutawayReceiptSummary };
type Filter = 'all' | 'mine';

export default function PutawayListScreen() {
  const { user } = useAuth();
  const [myReceipts, setMyReceipts] = useState<PutawayReceiptSummary[]>([]);
  const [otherReceipts, setOtherReceipts] = useState<PutawayReceiptSummary[]>([]);
  const [availableReceipts, setAvailableReceipts] = useState<PutawayReceiptSummary[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<WarehouseStaffOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canManage = (user?.roles ?? []).some((role) => MANAGER_ROLES.includes(role));

  const load = useCallback(async () => {
    setError(null);
    try {
      // getReadyReceipts() returns EVERY POSTED receipt to a manager/admin (see
      // filterReceiptsForStaff on the backend), not just ones unassigned or claimed
      // by the current user — so a receipt claimed by a different staff member must
      // still be shown here (as read-only), otherwise it silently vanishes from the
      // list and a manager can't step in if that staff member goes offline mid-task.
      const [receipts, staff] = await Promise.all([
        putawayApi.getReadyReceipts(),
        canManage ? authApi.getWarehouseStaff() : Promise.resolve({ data: [] }),
      ]);
      setMyReceipts(receipts.filter((r) => r.putaway_assignee_user_id === user?.id));
      setOtherReceipts(
        receipts.filter((r) => r.putaway_assignee_user_id && r.putaway_assignee_user_id !== user?.id),
      );
      setAvailableReceipts(receipts.filter((r) => !r.putaway_assignee_user_id));
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

  async function handleOpenMine(receipt: PutawayReceiptSummary) {
    router.push(`/putaway/warehouse/${receipt.warehouse_id}`);
  }

  async function handleClaim(receipt: PutawayReceiptSummary) {
    setClaimingId(receipt.id);
    try {
      await putawayApi.claimReceipt(receipt.id);
      router.push(`/putaway/warehouse/${receipt.warehouse_id}`);
      load();
    } catch (err) {
      Alert.alert('Nhận phiếu thất bại', err instanceof ApiError ? err.message : 'Vui lòng thử lại');
    } finally {
      setClaimingId(null);
    }
  }

  async function handleAssign(receipt: PutawayReceiptSummary, staffId: string) {
    setAssigningId(receipt.id);
    try {
      await putawayApi.assignReceipt(receipt.id, staffId);
      load();
    } catch (err) {
      Alert.alert('Giao phiếu thất bại', err instanceof ApiError ? err.message : 'Vui lòng thử lại');
    } finally {
      setAssigningId(null);
    }
  }

  function handleAssignPress(receipt: PutawayReceiptSummary) {
    if (staffOptions.length === 0) {
      Alert.alert('Không có nhân viên', 'Không tải được danh sách nhân viên kho.');
      return;
    }
    Alert.alert(
      `Giao phiếu ${receipt.receipt_number}`,
      'Chọn nhân viên để giao việc cất hàng',
      [
        ...staffOptions.map((staff) => ({
          text: staff.full_name,
          onPress: () => handleAssign(receipt, staff.id),
        })),
        { text: 'Hủy', style: 'cancel' as const },
      ],
    );
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
      <Stack.Screen options={{ headerShown: true, title: 'Putaway' }} />
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
            keyExtractor={(row) => `${row.kind}-${row.item.id}`}
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
            renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
            ListEmptyComponent={<Text style={styles.empty}>Không có phiếu nào chờ cất hàng</Text>}
            renderItem={({ item: row }) => {
              const receipt = row.item;
              const giaoButton = canManage ? (
                <Pressable
                  style={({ pressed }) => [styles.giaoButton, pressed && styles.cardPressed]}
                  onPress={() => handleAssignPress(receipt)}
                  disabled={assigningId === receipt.id}
                >
                  <Text style={styles.giaoButtonText}>
                    {assigningId === receipt.id ? 'Đang giao...' : 'Giao'}
                  </Text>
                </Pressable>
              ) : null;

              if (row.kind === 'mine') {
                return (
                  <Pressable
                    style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                    onPress={() => handleOpenMine(receipt)}
                  >
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle}>{receipt.receipt_number}</Text>
                      <Text style={styles.cardSubtitle}>
                        {receipt.warehouse_code ?? '-'} · còn {receipt.remaining_quantity} sản phẩm
                      </Text>
                    </View>
                    <View style={styles.actionsColumn}>
                      <View style={[styles.badge, styles.badgeMine]}>
                        <Text style={styles.badgeMineText}>Đã nhận</Text>
                      </View>
                      {giaoButton}
                    </View>
                  </Pressable>
                );
              }

              if (row.kind === 'other') {
                return (
                  <Pressable
                    style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                    onPress={() => handleOpenMine(receipt)}
                  >
                    <View style={styles.cardBody}>
                      <Text style={styles.cardTitle}>{receipt.receipt_number}</Text>
                      <Text style={styles.cardSubtitle}>
                        {receipt.warehouse_code ?? '-'} · còn {receipt.remaining_quantity} sản phẩm
                      </Text>
                    </View>
                    <View style={styles.actionsColumn}>
                      <View style={[styles.badge, styles.badgeOther]}>
                        <Text style={styles.badgeOtherText}>Đã giao</Text>
                      </View>
                      {giaoButton}
                    </View>
                  </Pressable>
                );
              }

              const isClaiming = claimingId === receipt.id;
              return (
                <Pressable
                  style={({ pressed }) => [styles.card, (isClaiming || pressed) && styles.cardPressed]}
                  onPress={() => handleClaim(receipt)}
                  disabled={isClaiming}
                >
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{receipt.receipt_number}</Text>
                    <Text style={styles.cardSubtitle}>
                      {receipt.warehouse_code ?? '-'} · còn {receipt.remaining_quantity} sản phẩm
                    </Text>
                  </View>
                  {isClaiming ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <View style={styles.actionsColumn}>
                      <View style={[styles.badge, styles.badgeAvailable]}>
                        <Text style={styles.badgeAvailableText}>Nhận phiếu</Text>
                      </View>
                      {giaoButton}
                    </View>
                  )}
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
