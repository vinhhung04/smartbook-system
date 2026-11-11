import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import * as customerBorrowApi from '../../../src/api/customerBorrow';
import { ApiError } from '../../../src/auth/auth-context';
import { BorrowBookCard } from '../../../src/components/customer/BorrowBookCard';
import { usePagedList } from '../../../src/hooks/usePagedList';
import { getDueState, getLoanStatusDisplay, getRenewalView } from '../../../src/lib/loanStatus';
import { getReservationStatusDisplay } from '../../../src/lib/reservationStatus';
import { useSubmitLock } from '../../../src/lib/submitLock';
import {
  Button, EmptyState, ErrorState, FilterChips, InlineAlert, PageTitle, SegmentedControl, Skeleton, radii, space, useTheme,
} from '../../../src/design-system';
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
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
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
            <Button
              label="Gia hạn"
              icon="refresh"
              variant="secondary"
              size="md"
              fullWidth={false}
              loading={renewingId === loan.id}
              loadingLabel="Đang gửi…"
              disabled={renewingId !== null}
              onPress={() => void handleRenew(loan)}
              accessibilityLabel={`Yêu cầu gia hạn ${title ?? ''}`}
            />
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
            <Button
              label="Xem mã QR nhận sách"
              icon="qr-code-outline"
              size="md"
              fullWidth={false}
              onPress={() => router.push(`/customer/my-books/reservation/${reservation.id}`)}
            />
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
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.lg }}>
        <PageTitle title="Sách của tôi" subtitle={list.total > 0 ? `${list.total} ${segment === 'loans' ? 'lượt mượn' : 'phiếu đặt'} ${scope === 'active' ? 'hiện tại' : 'trong lịch sử'}` : undefined} />
        <SegmentedControl
          accessibilityLabel="Loại sách"
          value={segment}
          onChange={setSegment}
          options={[{ value: 'loans', label: 'Đang mượn' }, { value: 'reservations', label: 'Đặt trước' }]}
        />
        <FilterChips
          accessibilityLabel="Thời gian"
          value={scope}
          onChange={setScope}
          options={[{ value: 'active', label: 'Hiện tại' }, { value: 'history', label: 'Lịch sử' }]}
        />
      </View>

      {list.loadingInitial && list.items.length === 0 ? (
        <View style={{ paddingHorizontal: space.lg, gap: space.md }} accessibilityLabel="Đang tải">
          {[0, 1, 2].map((i) => <Skeleton key={i} height={128} radius={radii.lg} />)}
        </View>
      ) : list.error && list.items.length === 0 ? (
        <ErrorState message={list.error} onRetry={list.retry} />
      ) : (
        <FlatList<Loan | Reservation>
          data={list.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.xxl, gap: space.md }}
          refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={() => void list.refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
          onEndReached={list.loadMore}
          onEndReachedThreshold={0.4}
          removeClippedSubviews
          ListEmptyComponent={
            <EmptyState
              icon={segment === 'loans' ? 'book-outline' : 'bookmark-outline'}
              title={emptyText}
              message={scope === 'active' ? 'Tìm một cuốn sách và đặt trước, thư viện sẽ giữ sách cho bạn.' : undefined}
              actionLabel={scope === 'active' ? 'Khám phá sách' : undefined}
              onAction={scope === 'active' ? () => router.push('/customer') : undefined}
            />
          }
          ListFooterComponent={
            list.loadingMore ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: space.lg }} />
            ) : list.error ? (
              <InlineAlert message={list.error} actionLabel="Thử lại" onAction={list.retry} />
            ) : list.items.length > 0 && !list.hasNextPage ? (
              <Text style={[type.caption, { textAlign: 'center', marginTop: space.sm }]}>Đã hiển thị tất cả {list.total} mục</Text>
            ) : undefined
          }
          renderItem={({ item }) => (segment === 'loans' ? renderLoan(item as Loan) : renderReservation(item as Reservation))}
        />
      )}
    </View>
  );
}
