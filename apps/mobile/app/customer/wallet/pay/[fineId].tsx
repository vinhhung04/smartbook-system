import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';

import * as customerBorrowApi from '../../../../src/api/customerBorrow';
import { ApiError, useAuth } from '../../../../src/auth/auth-context';
import { getFineStatusDisplay, getFineTypeLabel } from '../../../../src/lib/fineStatus';
import { fineRemaining, formatVnd, toMoney } from '../../../../src/lib/money';
import {
  decidePayment,
  describePaymentStatus,
  forgetPayment,
  loadStoredPayments,
  rememberPayment,
  type PaymentView,
  type StoredPayment,
} from '../../../../src/lib/pendingPayment';
import { useSubmitLock } from '../../../../src/lib/submitLock';
import { colors, radius, shadow, spacing, typography } from '../../../../src/theme/customerTokens';
import type { Fine } from '../../../../src/types/borrow';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

const BANNER_STYLE: Record<PaymentView['tone'], { bg: string; fg: string }> = {
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  primary: { bg: colors.primarySoft, fg: colors.textPrimary },
};

export default function CustomerPayFineScreen() {
  const { fineId } = useLocalSearchParams<{ fineId: string }>();
  const { user } = useAuth();
  const [fine, setFine] = useState<Fine | null>(null);
  const [stored, setStored] = useState<StoredPayment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingPayment, setIsStartingPayment] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [view, setView] = useState<PaymentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const payLock = useSubmitLock();
  const checkingRef = useRef(false);

  const loadFine = useCallback(async () => {
    setError(null);
    try {
      const result = await customerBorrowApi.getMyFines();
      const match = result.data.fines.find((item) => item.id === fineId) ?? null;
      setFine(match);
      if (!match) setError('Không tìm thấy khoản phí phạt này');
      return match;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được thông tin phí phạt');
      return null;
    }
  }, [fineId]);

  // Asks the server about the link the reader opened last (or the one the server says
  // is still pending). The browser coming back to the app is never taken as "paid".
  const reconcile = useCallback(async () => {
    if (!user || checkingRef.current) return;
    checkingRef.current = true;
    setIsChecking(true);
    try {
      const current = await loadFine();
      const local = (await loadStoredPayments(user.id)).find((item) => item.fine_id === fineId) ?? null;
      setStored(local);
      const txnRef = local?.txn_ref ?? current?.pending_payment?.txn_ref ?? null;
      if (!txnRef) {
        setView(null);
        return;
      }
      try {
        const result = await customerBorrowApi.getVnpayFinePaymentStatus(txnRef);
        const next = describePaymentStatus(result.data.status);
        setView(next);
        if (next.final) {
          await forgetPayment(user.id, txnRef);
          setStored(null);
          if (next.settled) await loadFine();
        }
      } catch (err) {
        setView(err instanceof ApiError && err.status === 404 ? null : describePaymentStatus('UNKNOWN'));
        if (err instanceof ApiError && err.status === 404) {
          await forgetPayment(user.id, txnRef);
          setStored(null);
        }
      }
    } finally {
      checkingRef.current = false;
      setIsChecking(false);
    }
  }, [user, fineId, loadFine]);

  useEffect(() => {
    setIsLoading(true);
    reconcile().finally(() => setIsLoading(false));
  }, [reconcile]);

  // Re-check whenever the reader returns — from the system browser after VNPay, or by
  // reopening the app later. No deep link needed.
  useFocusEffect(
    useCallback(() => {
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void reconcile();
      });
      return () => subscription.remove();
    }, [reconcile]),
  );

  async function handlePayOnline() {
    if (!fine || !user) return;
    await payLock.run(async () => {
      setIsStartingPayment(true);
      setError(null);
      try {
        const result = await customerBorrowApi.createVnpayFinePayment(fine.id);
        const payment: StoredPayment = {
          txn_ref: result.data.txn_ref,
          fine_id: fine.id,
          amount: toMoney(result.data.amount),
          expires_at: result.data.expires_at,
          started_at: new Date().toISOString(),
        };
        await rememberPayment(user.id, payment);
        setStored(payment);
        setView(describePaymentStatus('PENDING'));
        await Linking.openURL(result.data.payment_url);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'PAYMENT_PENDING') {
          // The server already has a live link for this fine: track that one instead.
          await reconcile();
        } else if (err instanceof ApiError && err.outcomeUnknown) {
          setError('Chưa rõ liên kết thanh toán đã được tạo hay chưa. Đã tải lại trạng thái — kiểm tra trước khi thử lại.');
          await reconcile();
        } else {
          setError(err instanceof ApiError ? err.message : 'Không thể khởi tạo thanh toán, vui lòng thử lại.');
        }
      } finally {
        setIsStartingPayment(false);
      }
    });
  }

  if (isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Thanh toán phí phạt' }} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </>
    );
  }

  if (!fine) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Thanh toán phí phạt' }} />
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      </>
    );
  }

  const remaining = fineRemaining(fine);
  const decision = decidePayment(fine, remaining, stored);
  const status = getFineStatusDisplay(fine.status);
  const payments = fine.fine_payments ?? [];

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Thanh toán phí phạt' }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{getFineTypeLabel(fine.fine_type)}</Text>
          <Text style={[styles.summaryAmount, remaining <= 0 && styles.summaryAmountPaid]}>{formatVnd(remaining)}</Text>
          <Text style={styles.summaryHint}>{remaining > 0 ? 'Số tiền còn phải trả' : 'Đã thanh toán đủ'}</Text>
          <View style={styles.breakdown}>
            <Row label="Tiền phạt" value={formatVnd(fine.amount)} />
            {toMoney(fine.waived_amount) > 0 ? <Row label="Được miễn" value={`− ${formatVnd(fine.waived_amount)}`} /> : null}
            {payments.length > 0 ? <Row label="Đã trả" value={`− ${formatVnd(payments.reduce((sum, p) => sum + toMoney(p.amount), 0))}`} /> : null}
            <Row label="Trạng thái" value={status?.label ?? fine.status} />
          </View>
        </View>

        {view ? (
          <View style={[styles.statusBanner, { backgroundColor: BANNER_STYLE[view.tone].bg }]} accessibilityLiveRegion="polite">
            <Text style={[styles.statusBannerText, { color: BANNER_STYLE[view.tone].fg }]}>{view.message}</Text>
            {decision.kind === 'wait' ? (
              <Text style={styles.statusMeta}>Mã giao dịch {decision.txnRef} · hết hạn lúc {formatTime(decision.until)}</Text>
            ) : null}
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {payments.length > 0 ? (
          <View style={styles.history}>
            <Text style={styles.historyTitle}>Lịch sử thanh toán</Text>
            {payments.map((payment) => (
              <View key={payment.id} style={styles.historyRow}>
                <View style={styles.historyBody}>
                  <Text style={styles.historyMethod}>{payment.payment_method === 'VNPAY' ? 'VNPay' : payment.payment_method === 'CASH' ? 'Tiền mặt tại quầy' : payment.payment_method}</Text>
                  <Text style={styles.historyDate}>{new Date(payment.paid_at).toLocaleString('vi-VN')}</Text>
                </View>
                <Text style={styles.historyAmount}>{formatVnd(payment.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {decision.kind === 'wait' ? (
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.payButtonPressed]}
            onPress={() => void reconcile()}
            disabled={isChecking}
            accessibilityRole="button"
          >
            {isChecking ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.secondaryButtonText}>Kiểm tra trạng thái thanh toán</Text>}
          </Pressable>
        ) : decision.kind === 'pay' ? (
          <Pressable
            style={({ pressed }) => [styles.payButton, isStartingPayment && styles.payButtonDisabled, pressed && styles.payButtonPressed]}
            onPress={handlePayOnline}
            disabled={isStartingPayment}
            accessibilityRole="button"
            accessibilityLabel={`Thanh toán ${formatVnd(remaining)} qua VNPay`}
          >
            <LinearGradient
              colors={[colors.accentGradientStart, colors.accentGradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {isStartingPayment ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.payButtonText}>Thanh toán {formatVnd(remaining)} qua VNPay</Text>
            )}
          </Pressable>
        ) : null}
        {decision.kind === 'pay' ? (
          <Text style={styles.note}>Bạn sẽ được chuyển sang trang VNPay. Khoản phạt chỉ được ghi nhận khi VNPay xác nhận với thư viện.</Text>
        ) : null}
      </ScrollView>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  error: {
    color: colors.danger,
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadow.card,
  },
  summaryLabel: {
    ...typography.label,
  },
  summaryAmount: {
    ...typography.h1,
    marginTop: spacing.sm,
    color: colors.danger,
  },
  summaryAmountPaid: {
    color: colors.success,
  },
  summaryHint: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  breakdown: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowLabel: {
    ...typography.caption,
  },
  rowValue: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  statusBanner: {
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statusBannerText: {
    ...typography.body,
    fontSize: 15,
  },
  statusMeta: {
    ...typography.caption,
    fontSize: 12,
  },
  history: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  historyTitle: {
    ...typography.label,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  historyBody: {
    flex: 1,
  },
  historyMethod: {
    ...typography.bodyBold,
    fontSize: 14,
  },
  historyDate: {
    ...typography.caption,
    fontSize: 12,
  },
  historyAmount: {
    ...typography.code,
    color: colors.success,
  },
  payButton: {
    borderRadius: radius.pill,
    minHeight: 52,
    paddingVertical: spacing.md + 4,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
    overflow: 'hidden',
  },
  payButtonPressed: {
    opacity: 0.9,
  },
  payButtonDisabled: {
    opacity: 0.6,
  },
  payButtonText: {
    fontFamily: typography.h3.fontFamily,
    color: colors.onPrimary,
    fontSize: 16,
  },
  secondaryButton: {
    marginTop: 'auto',
    minHeight: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  note: {
    ...typography.caption,
    textAlign: 'center',
  },
});
