import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import * as customerBorrowApi from '../../../src/api/customerBorrow';
import { ApiError } from '../../../src/auth/auth-context';
import { BorrowBookCard } from '../../../src/components/customer/BorrowBookCard';
import { usePagedList } from '../../../src/hooks/usePagedList';
import { getDueState, getLoanStatusDisplay, getRenewalView } from '../../../src/lib/loanStatus';
import { getReservationStatusDisplay } from '../../../src/lib/reservationStatus';
import { useSubmitLock } from '../../../src/lib/submitLock';
import { useCustomerTabBarSpace } from '../../../src/hooks/useCustomerTabBarSpace';
import { colors, fonts, radius, spacing, typography } from '../../../src/theme/customerTokens';
import type { BorrowListScope, Loan, Reservation } from '../../../src/types/borrow';

type Segment = 'loans' | 'reservations';
const PAGE_SIZE = 20;

function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('vi-VN') : '—';
}

const fetchLoans = async (params: { scope: BorrowListScope }, page: number) => {
  const result = await customerBorrowApi.getMyLoans(page, PAGE_SIZE, { scope: params.scope });
  return { items: result.data, page: result.meta.page, totalPages: result.meta.totalPages, total: result.meta.total };
};

const fetchReservations = async (params: { scope: BorrowListScope }, page: number) => {
  const result = await customerBorrowApi.getMyReservations(page, PAGE_SIZE, { scope: params.scope });
  return { items: result.data, page: result.meta.page, totalPages: result.meta.totalPages, total: result.meta.total };
};

export default function CustomerMyBooksScreen() {
  const tabBarSpace = useCustomerTabBarSpace();
  const [segment, setSegment] = useState<Segment>('loans');
  const [scope, setScope] = useState<BorrowListScope>('active');
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const renewLock = useSubmitLock();

  const loans = usePagedList<Loan, { scope: BorrowListScope }>(fetchLoans, segment === 'loans' ? { scope } : null, 'Không tải được danh sách sách đang mượn');
  const reservations = usePagedList<Reservation, { scope: BorrowListScope }>(
    fetchReservations,
    segment === 'reservations' ? { scope } : null,
    'Không tải được danh sách phiếu đặt',
  );
  const list = segment === 'loans' ? loans : reservations;

  // Coming back from a detail screen (cancelled a hold, renewed a loan) shows fresh data.
  const firstFocus = useRef(true);
  const refreshRef = useRef(list.refresh);
  useEffect(() => {
    refreshRef.current = list.refresh;
  }, [list.refresh]);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refreshRef.current();
    }, []),
  );

  async function handleRenew(loan: Loan) {
    await renewLock.run(async () => {
      setRenewingId(loan.id);
      try {
        const result = await customerBorrowApi.requestMyLoanRenewal(loan.id);
        Alert.alert('Đã gửi yêu cầu gia hạn', `Thư viện sẽ xem xét gia hạn thêm ${result.data.requested_extension_days} ngày.`);
      } catch (err) {
        Alert.alert('Không gửi được yêu cầu', err instanceof ApiError ? err.message : 'Vui lòng thử lại sau.');
      } finally {
        setRenewingId(null);
        void loans.refresh();
      }
    });
  }

  function renderLoan(loan: Loan) {
    const status = getLoanStatusDisplay(loan.status);
    const due = getDueState(loan.due_date, loan.status);
    const renewal = getRenewalView(loan.status, loan.renewal);
    const firstItem = loan.loan_items?.[0];
    const title = loan.primary_book_title ?? firstItem?.book_title;
    const extra = loan.extra_item_count ?? Math.max(0, (loan.loan_items?.length ?? 0) - 1);
    const meta = [
      `Mượn ${formatDate(loan.borrow_date)} · Hạn trả ${formatDate(loan.due_date)}`,
      extra > 0 ? `+${extra} cuốn khác trong lượt mượn` : null,
      renewal.note,
      `Phiếu ${loan.loan_number}`,
    ].filter((line): line is string => Boolean(line));
    return (
      <BorrowBookCard
        title={title}
        author={firstItem?.book_author}
        coverUrl={loan.primary_book_cover_url ?? firstItem?.book_cover_url}
        status={status}
        meta={meta}
        warning={due.kind === 'overdue' ? { text: due.label, tone: 'danger' } : due.kind === 'soon' ? { text: due.label, tone: 'warning' } : null}
        onPress={() => router.push(`/customer/my-books/loan/${loan.id}`)}
        accessibilityLabel={`${title ?? 'Sách'}, ${status?.label ?? loan.status}, hạn trả ${formatDate(loan.due_date)}${due.label ? `, ${due.label}` : ''}`}
        actions={
          renewal.canRequest ? (
            <Pressable
              style={styles.action}
              onPress={() => void handleRenew(loan)}
              disabled={renewingId !== null}
              accessibilityRole="button"
              accessibilityLabel={`Yêu cầu gia hạn ${title ?? ''}`}
            >
              {renewingId === loan.id ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.actionText}>Gia hạn</Text>}
            </Pressable>
          ) : null
        }
      />
    );
  }

  function renderReservation(reservation: Reservation) {
    const status = getReservationStatusDisplay(reservation.status);
    const ready = reservation.status === 'READY_FOR_PICKUP';
    const meta = [
      ready && reservation.pickup_code_expires_at
        ? `Nhận trước ${new Date(reservation.pickup_code_expires_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
        : `Đặt ${formatDate(reservation.reserved_at)} · Giữ đến ${formatDate(reservation.expires_at)}`,
      `Phiếu ${reservation.reservation_number}`,
    ];
    return (
      <BorrowBookCard
        title={reservation.book_title}
        author={reservation.book_author}
        coverUrl={reservation.book_cover_url}
        status={status}
        meta={meta}
        warning={ready ? { text: 'Đến quầy nhận sách', tone: 'warning' } : null}
        onPress={() => router.push(`/customer/my-books/reservation/${reservation.id}`)}
        accessibilityLabel={`${reservation.book_title ?? 'Sách'}, ${status?.label ?? reservation.status}`}
        actions={
          ready && reservation.pickup_code ? (
            <Pressable
              style={styles.action}
              onPress={() => router.push(`/customer/my-books/reservation/${reservation.id}`)}
              accessibilityRole="button"
            >
              <Ionicons name="qr-code-outline" size={14} color={colors.primary} />
              <Text style={styles.actionText}>Xem mã QR nhận sách</Text>
            </Pressable>
          ) : null
        }
      />
    );
  }

  const emptyText =
    segment === 'loans'
      ? scope === 'active' ? 'Bạn không mượn cuốn sách nào lúc này.' : 'Chưa có lịch sử mượn sách.'
      : scope === 'active' ? 'Bạn không có phiếu đặt trước nào đang chờ.' : 'Chưa có lịch sử đặt trước.';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Sách của tôi</Text>
        <View style={styles.segmentControl} accessibilityRole="tablist">
          <SegmentButton label="Đang mượn" active={segment === 'loans'} onPress={() => setSegment('loans')} />
          <SegmentButton label="Đặt trước" active={segment === 'reservations'} onPress={() => setSegment('reservations')} />
        </View>
        <View style={styles.scopeRow}>
          <ScopeChip label="Hiện tại" active={scope === 'active'} onPress={() => setScope('active')} />
          <ScopeChip label="Lịch sử" active={scope === 'history'} onPress={() => setScope('history')} />
          {list.total > 0 ? <Text style={styles.total}>{list.total} mục</Text> : null}
        </View>
      </View>

      {list.loadingInitial && list.items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : list.error && list.items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.error}>{list.error}</Text>
          <Pressable style={styles.retry} onPress={list.retry} accessibilityRole="button">
            <Text style={styles.actionText}>Thử lại</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList<Loan | Reservation>
          data={list.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarSpace }]}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          removeClippedSubviews
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name={segment === 'loans' ? 'book-outline' : 'bookmark-outline'} size={28} color={colors.textMuted} />
              <Text style={styles.empty}>{emptyText}</Text>
              {scope === 'active' ? (
                <Pressable style={styles.retry} onPress={() => router.push('/customer')} accessibilityRole="button">
                  <Text style={styles.actionText}>Khám phá sách</Text>
                </Pressable>
              ) : null}
            </View>
          }
          ListFooterComponent={
            list.loadingMore ? (
              <ActivityIndicator color={colors.primary} style={styles.footer} />
            ) : list.error ? (
              <Pressable style={styles.footerRetry} onPress={list.retry} accessibilityRole="button">
                <Text style={styles.error}>{list.error} — chạm để thử lại</Text>
              </Pressable>
            ) : list.items.length > 0 && !list.hasNextPage ? (
              <Text style={styles.footerText}>Đã hiển thị tất cả {list.total} mục</Text>
            ) : null
          }
          renderItem={({ item }) => (segment === 'loans' ? renderLoan(item as Loan) : renderReservation(item as Reservation))}
        />
      )}
    </SafeAreaView>
  );
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.segmentButton, active && styles.segmentButtonActive]}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.segmentButtonText, active && styles.segmentButtonTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ScopeChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  title: {
    ...typography.h2,
  },
  segmentControl: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.sm - 2,
  },
  segmentButtonActive: {
    backgroundColor: colors.surface,
  },
  segmentButtonText: {
    ...typography.caption,
    fontFamily: fonts.bodySemibold,
  },
  segmentButtonTextActive: {
    color: colors.primary,
  },
  scopeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chip: {
    minHeight: 32,
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
  total: {
    ...typography.caption,
    marginLeft: 'auto',
    color: colors.textMuted,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  error: {
    color: colors.danger,
    fontWeight: '600',
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
  },
  separator: {
    height: spacing.sm,
  },
  emptyBox: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  actionText: {
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
    color: colors.primary,
  },
  retry: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    justifyContent: 'center',
  },
  footer: {
    marginVertical: spacing.lg,
  },
  footerRetry: {
    padding: spacing.lg,
  },
  footerText: {
    ...typography.caption,
    textAlign: 'center',
    color: colors.textMuted,
    padding: spacing.lg,
  },
});
