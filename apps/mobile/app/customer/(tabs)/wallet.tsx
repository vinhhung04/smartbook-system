import { useCallback, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { RefreshControl, SectionList, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import * as customerBorrowApi from '../../../src/api/customerBorrow';
import { ApiError } from '../../../src/auth/auth-context';
import { canPayFine, getFineStatusDisplay, getFineTypeLabel } from '../../../src/lib/fineStatus';
import { fineRemaining, formatVnd, toMoney } from '../../../src/lib/money';
import { Button, EmptyState, ErrorState, InlineAlert, PageTitle, PressableScale, Skeleton, StatusBadge, fontFamily, radii, space, useTheme } from '../../../src/design-system';
import type { Fine, FinePayment } from '../../../src/types/borrow';

type Row = { kind: 'fine'; fine: Fine } | { kind: 'payment'; payment: FinePayment };

function methodLabel(method: string): string {
  if (method === 'VNPAY') return 'VNPay';
  if (method === 'CASH') return 'Tiền mặt tại quầy';
  if (method === 'CARD') return 'Thẻ';
  if (method === 'TRANSFER') return 'Chuyển khoản';
  return method;
}

export default function CustomerWalletScreen() {
  const { colors, type, shadow } = useTheme();
  const insets = useSafeAreaInsets();
  const [balance, setBalance] = useState(0);
  const [fines, setFines] = useState<Fine[]>([]);
  const [payments, setPayments] = useState<FinePayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Is that VNPay link still live?" is judged against the time of the last load.
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setError(null);
    try {
      const result = await customerBorrowApi.getMyFines();
      if (requestId !== requestRef.current) return;
      setBalance(toMoney(result.data.total_fine_balance));
      setFines(result.data.fines);
      setPayments(result.data.fine_payments ?? []);
      setLoadedAt(Date.now());
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setError(err instanceof ApiError ? err.message : 'Không tải được thông tin phí phạt');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  const sections = useMemo(() => {
    const open = fines.filter((fine) => canPayFine(fine.status) && fineRemaining(fine) > 0);
    const closed = fines.filter((fine) => !open.includes(fine));
    return [
      { key: 'open', title: `Cần thanh toán (${open.length})`, data: open.map((fine): Row => ({ kind: 'fine', fine })) },
      { key: 'closed', title: `Đã xử lý (${closed.length})`, data: closed.map((fine): Row => ({ kind: 'fine', fine })) },
      { key: 'payments', title: `Lịch sử giao dịch (${payments.length})`, data: payments.map((payment): Row => ({ kind: 'payment', payment })) },
    ].filter((section) => section.data.length > 0);
  }, [fines, payments]);

  const header = (
    <View style={{ paddingTop: insets.top + space.md, gap: space.lg, paddingBottom: space.sm }}>
      <PageTitle title="Ví & phí" />
      {/* The one number this screen exists for. */}
      <View style={{ padding: space.xl, gap: space.sm, borderRadius: radii.xl, borderCurve: 'continuous', backgroundColor: colors.inkField }}>
        <Text style={{ fontFamily: fontFamily.medium, fontSize: 14, color: colors.onInkMuted }}>Phí phạt chưa thanh toán</Text>
        <Text
          style={{ fontFamily: fontFamily.serif, fontSize: 38, lineHeight: 44, color: balance > 0 ? '#F6DFB4' : colors.onInk, fontVariant: ['tabular-nums'] }}
          accessibilityLabel={`Phí phạt chưa thanh toán: ${formatVnd(balance)}`}
        >
          {formatVnd(balance)}
        </Text>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 20, color: colors.onInkMuted }}>
          {balance > 0 ? 'Thanh toán qua VNPay ngay trong ứng dụng, hoặc tại quầy thư viện.' : 'Bạn không còn khoản phạt nào cần thanh toán.'}
        </Text>
      </View>
      {error && fines.length > 0 ? <InlineAlert message={error} actionLabel="Thử lại" onAction={() => void handleRefresh()} /> : null}
    </View>
  );

  if (isLoading && fines.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg }}>
        {header}
        <View style={{ gap: space.md, marginTop: space.lg }}>{[0, 1].map((i) => <Skeleton key={i} height={110} radius={radii.lg} />)}</View>
      </View>
    );
  }

  if (error && fines.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg }}>
        {header}
        <ErrorState message={error} onRetry={() => void handleRefresh()} />
      </View>
    );
  }

  return (
    <SectionList
      style={{ flex: 1, backgroundColor: colors.bg }}
      sections={sections}
      keyExtractor={(row) => (row.kind === 'fine' ? `f-${row.fine.id}` : `p-${row.payment.id}`)}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      renderSectionHeader={({ section }) => (
        <Text style={[type.heading, { marginTop: space.xl, marginBottom: space.md }]} accessibilityRole="header">{section.title}</Text>
      )}
      ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
      ListEmptyComponent={<EmptyState icon="wallet-outline" title="Bạn không có khoản phí phạt nào" message="Trả sách đúng hạn để không phát sinh phí." />}
      renderItem={({ item: row }) => {
        if (row.kind === 'payment') {
          const payment = row.payment;
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              <Ionicons name="checkmark-circle" size={22} color={colors.success} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: 15, color: colors.textPrimary }}>{methodLabel(String(payment.payment_method))}</Text>
                <Text style={type.caption}>{new Date(payment.paid_at).toLocaleString('vi-VN')}</Text>
              </View>
              <Text style={{ fontFamily: fontFamily.bold, fontSize: 15, color: colors.success, fontVariant: ['tabular-nums'] }}>{formatVnd(payment.amount)}</Text>
            </View>
          );
        }
        const fine = row.fine;
        const display = getFineStatusDisplay(fine.status);
        const remaining = fineRemaining(fine);
        const payable = canPayFine(fine.status) && remaining > 0;
        const pending = fine.pending_payment && new Date(fine.pending_payment.expires_at).getTime() > loadedAt;
        const body = (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: 16, color: colors.textPrimary }}>{getFineTypeLabel(fine.fine_type)}</Text>
                <Text style={type.caption}>Phát sinh {new Date(fine.issued_at).toLocaleDateString('vi-VN')}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={{ fontFamily: fontFamily.bold, fontSize: 18, color: payable ? colors.danger : colors.textPrimary, fontVariant: ['tabular-nums'] }}>
                  {payable ? formatVnd(remaining) : formatVnd(toMoney(fine.amount) - toMoney(fine.waived_amount))}
                </Text>
                {payable && remaining < toMoney(fine.amount) ? <Text style={type.caption}>trên tổng {formatVnd(fine.amount)}</Text> : null}
              </View>
            </View>
            {fine.note ? <Text style={type.caption} numberOfLines={2}>{fine.note}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {display ? <StatusBadge tone={display.tone} label={display.label} /> : null}
              {pending ? <StatusBadge tone="warning" label="Chờ VNPay xác nhận" icon="hourglass-outline" /> : null}
            </View>
            {payable ? (
              // Visual only: the whole card is the button (no nested pressables for screen readers).
              <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Button label={pending ? 'Xem trạng thái thanh toán' : `Thanh toán ${formatVnd(remaining)}`} size="md" icon={pending ? 'time-outline' : 'card-outline'} />
              </View>
            ) : null}
          </>
        );
        const cardStyle = { padding: space.lg, gap: space.md, borderRadius: radii.lg, borderCurve: 'continuous' as const, backgroundColor: colors.surface, ...shadow.card };
        if (!payable) {
          return <View style={cardStyle} accessible accessibilityLabel={`${getFineTypeLabel(fine.fine_type)}, ${display?.label ?? fine.status}`}>{body}</View>;
        }
        return (
          <PressableScale
            onPress={() => router.push(`/customer/wallet/pay/${fine.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${getFineTypeLabel(fine.fine_type)}, còn ${formatVnd(remaining)}, ${display?.label ?? fine.status}${pending ? ', đang chờ VNPay xác nhận' : ''}`}
            accessibilityHint={pending ? 'Mở trạng thái thanh toán' : 'Mở màn hình thanh toán'}
            style={cardStyle}
          >
            {body}
          </PressableScale>
        );
      }}
    />
  );
}
