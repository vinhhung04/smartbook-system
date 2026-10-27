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
import { ApiError, useAuth } from '../../src/auth/auth-context';
import { isWarehouseManager } from '../../src/auth/access';
import { SelectionSheet } from '../../src/components/SelectionSheet';
import { useWarehouseStaff, type StaffOption } from '../../src/hooks/useWarehouseStaff';
import type { PutawayReceiptSummary } from '../../src/types/putaway';
import { colors, fonts, radius, shadow, spacing, typography } from '../../src/theme/tokens';

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
                  accessibilityRole="button"
                  accessibilityLabel={`Giao phiếu ${receipt.receipt_number} cho nhân viên`}
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
    fontFamily: fonts.monoSemibold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
    fontFamily: fonts.monoSemibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  badgeAvailable: {
    backgroundColor: colors.primarySoft,
  },
  badgeAvailableText: {
    color: colors.primary,
    fontFamily: fonts.monoSemibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  badgeOther: {
    backgroundColor: colors.neutralSoft,
  },
  badgeOtherText: {
    color: colors.neutral,
    fontFamily: fonts.monoSemibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  actionsColumn: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  giaoButton: {
    minHeight: 32,
    justifyContent: 'center',
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  giaoButtonText: {
    color: colors.primary,
    fontFamily: fonts.monoSemibold,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
