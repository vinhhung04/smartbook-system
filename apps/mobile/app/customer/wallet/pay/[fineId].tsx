import { useCallback, useEffect, useState } from 'react';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Linking from 'expo-linking';

import * as customerBorrowApi from '../../../../src/api/customerBorrow';
import { ApiError } from '../../../../src/auth/auth-context';
import { colors, radius, shadow, spacing, typography } from '../../../../src/theme/customerTokens';
import type { Fine, VnpayPaymentIntentStatus } from '../../../../src/types/borrow';

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('vi-VN')} đ`;
}

function remainingOf(fine: Fine): number {
  const paid = (fine.fine_payments ?? []).reduce((sum, payment) => sum + payment.amount, 0);
  return Math.max(0, fine.amount - fine.waived_amount - paid);
}

const STATUS_MESSAGES: Record<VnpayPaymentIntentStatus, string> = {
  PENDING: 'Đang chờ xác nhận từ VNPay. Hoàn tất thanh toán trên trình duyệt rồi quay lại đây.',
  SUCCESS: 'Thanh toán thành công! Khoản phạt đã được ghi nhận.',
  FAILED: 'Thanh toán không thành công. Vui lòng thử lại.',
  EXPIRED: 'Phiên thanh toán đã hết hạn. Vui lòng thử lại.',
};

export default function CustomerPayFineScreen() {
  const { fineId } = useLocalSearchParams<{ fineId: string }>();
  const [fine, setFine] = useState<Fine | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingPayment, setIsStartingPayment] = useState(false);
  const [txnRef, setTxnRef] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<VnpayPaymentIntentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFine = useCallback(async () => {
    setError(null);
    try {
      const result = await customerBorrowApi.getMyFines();
      const match = result.data.fines.find((item) => item.id === fineId) ?? null;
      setFine(match);
      if (!match) setError('Không tìm thấy khoản phí phạt này');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được thông tin phí phạt');
    }
  }, [fineId]);

  useEffect(() => {
    setIsLoading(true);
    loadFine().finally(() => setIsLoading(false));
  }, [loadFine]);

  // Re-check payment status whenever the user returns to this screen — e.g.
  // after backgrounding the system browser post-VNPay. No deep link needed.
  useFocusEffect(
    useCallback(() => {
      if (!txnRef) return;
      customerBorrowApi.getVnpayFinePaymentStatus(txnRef).then((result) => {
        setPaymentStatus(result.data.status);
        if (result.data.status === 'SUCCESS') void loadFine();
      }).catch(() => {});
    }, [txnRef, loadFine]),
  );

  async function handlePayOnline() {
    if (!fine) return;
    setIsStartingPayment(true);
    setError(null);
    try {
      const result = await customerBorrowApi.createVnpayFinePayment(fine.id);
      setTxnRef(result.data.txn_ref);
      setPaymentStatus('PENDING');
      await Linking.openURL(result.data.payment_url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể khởi tạo thanh toán, vui lòng thử lại.');
    } finally {
      setIsStartingPayment(false);
    }
  }

  const isSettled = paymentStatus === 'SUCCESS' || (fine ? remainingOf(fine) <= 0 : false);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Thanh toán phí phạt' }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !fine ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <View style={styles.container}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{fine.fine_type}</Text>
            <Text style={styles.summaryAmount}>{formatCurrency(remainingOf(fine))}</Text>
            <Text style={styles.summaryHint}>Số tiền còn phải trả</Text>
          </View>

          {paymentStatus ? (
            <View style={[styles.statusBanner, paymentStatus === 'SUCCESS' && styles.statusBannerSuccess]}>
              <Text style={styles.statusBannerText}>{STATUS_MESSAGES[paymentStatus]}</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {!isSettled ? (
            <Pressable
              style={({ pressed }) => [styles.payButton, isStartingPayment && styles.payButtonDisabled, pressed && styles.payButtonPressed]}
              onPress={handlePayOnline}
              disabled={isStartingPayment}
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
                <Text style={styles.payButtonText}>Thanh toán qua VNPay</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
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
  summaryHint: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  statusBanner: {
    borderRadius: radius.sm,
    padding: spacing.md,
    backgroundColor: colors.primarySoft,
  },
  statusBannerSuccess: {
    backgroundColor: colors.surface,
  },
  statusBannerText: {
    ...typography.body,
  },
  payButton: {
    borderRadius: radius.pill,
    paddingVertical: spacing.md + 4,
    alignItems: 'center',
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
});
