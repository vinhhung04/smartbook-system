import { useCallback, useMemo, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import * as customerBorrowApi from '../../../src/api/customerBorrow';
import { ApiError } from '../../../src/auth/auth-context';
import { GlowBadge } from '../../../src/components/customer/GlowBadge';
import { canPayFine, getFineStatusDisplay, getFineTypeLabel } from '../../../src/lib/fineStatus';
import { fineRemaining, formatVnd, toMoney } from '../../../src/lib/money';
import { useCustomerTabBarSpace } from '../../../src/hooks/useCustomerTabBarSpace';
import { colors, radius, shadow, spacing, typography } from '../../../src/theme/customerTokens';
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
  const tabBarSpace = useCustomerTabBarSpace();
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Ví & Phí phạt</Text>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>TỔNG PHÍ PHẠT CHƯA THANH TOÁN</Text>
          <Text style={[styles.balanceAmount, balance > 0 && styles.balanceAmountDue]}>{formatVnd(balance)}</Text>
          <Text style={styles.balanceHint}>
            {balance > 0 ? 'Thanh toán qua VNPay hoặc tại quầy thư viện.' : 'Bạn không còn khoản phạt nào cần thanh toán.'}
          </Text>
        </View>
      </View>

      {isLoading && fines.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error && fines.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.retry} onPress={() => void handleRefresh()} accessibilityRole="button">
            <Text style={styles.retryText}>Thử lại</Text>
          </Pressable>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(row) => (row.kind === 'fine' ? `f-${row.fine.id}` : `p-${row.payment.id}`)}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarSpace }]}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
          renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="wallet-outline" size={28} color={colors.textMuted} />
              <Text style={styles.empty}>Bạn không có khoản phí phạt nào</Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item: row }) => {
            if (row.kind === 'payment') {
              const payment = row.payment;
              return (
                <View style={styles.paymentRow}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  <View style={styles.cardBody}>
                    <Text style={styles.paymentMethod}>{methodLabel(String(payment.payment_method))}</Text>
                    <Text style={styles.cardSubtitle}>{new Date(payment.paid_at).toLocaleString('vi-VN')}</Text>
                  </View>
                  <Text style={styles.paymentAmount}>{formatVnd(payment.amount)}</Text>
                </View>
              );
            }
            const fine = row.fine;
            const display = getFineStatusDisplay(fine.status);
            const remaining = fineRemaining(fine);
            const payable = canPayFine(fine.status) && remaining > 0;
            const pending = fine.pending_payment && new Date(fine.pending_payment.expires_at).getTime() > loadedAt;
            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && payable && styles.cardPressed]}
                onPress={() => payable && router.push(`/customer/wallet/pay/${fine.id}`)}
                disabled={!payable}
                accessibilityRole={payable ? 'button' : undefined}
                accessibilityLabel={`${getFineTypeLabel(fine.fine_type)}, còn ${formatVnd(remaining)}, ${display?.label ?? fine.status}`}
              >
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{getFineTypeLabel(fine.fine_type)}</Text>
                  <Text style={styles.cardSubtitle}>Phát sinh {new Date(fine.issued_at).toLocaleDateString('vi-VN')}</Text>
                  <Text style={[styles.cardAmount, payable && styles.cardAmountDue]}>
                    {payable ? `Còn ${formatVnd(remaining)}` : formatVnd(toMoney(fine.amount) - toMoney(fine.waived_amount))}
                  </Text>
                  {payable && remaining < toMoney(fine.amount) ? (
                    <Text style={styles.cardSubtitle}>trên tổng {formatVnd(fine.amount)}</Text>
                  ) : null}
                  {fine.note ? <Text style={styles.cardSubtitle} numberOfLines={2}>{fine.note}</Text> : null}
                </View>
                <View style={styles.cardActions}>
                  {display ? <GlowBadge text={display.label} tone={display.tone} /> : null}
                  {pending ? <GlowBadge text="Chờ VNPay xác nhận" tone="warning" /> : null}
                  {payable ? (
                    <View style={styles.payButton}>
                      <LinearGradient
                        colors={[colors.accentGradientStart, colors.accentGradientEnd]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                      <Text style={styles.payButtonText}>{pending ? 'Xem trạng thái' : 'Thanh toán'}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
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
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow.card,
  },
  balanceLabel: {
    ...typography.label,
  },
  balanceAmount: {
    ...typography.h1,
    marginTop: spacing.xs,
  },
  balanceAmountDue: {
    color: colors.danger,
  },
  balanceHint: {
    ...typography.caption,
    marginTop: spacing.xs,
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
  retry: {
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    justifyContent: 'center',
  },
  retryText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
  },
  sectionTitle: {
    ...typography.label,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
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
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...typography.h3,
  },
  cardSubtitle: {
    ...typography.caption,
  },
  cardAmount: {
    ...typography.bodyBold,
    marginTop: 2,
  },
  cardAmountDue: {
    color: colors.danger,
  },
  cardActions: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  payButton: {
    borderRadius: radius.pill,
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  payButtonText: {
    color: colors.onPrimary,
    fontFamily: typography.bodyBold.fontFamily,
    fontSize: 12,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgElevated,
  },
  paymentMethod: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  paymentAmount: {
    ...typography.code,
    color: colors.success,
  },
});
