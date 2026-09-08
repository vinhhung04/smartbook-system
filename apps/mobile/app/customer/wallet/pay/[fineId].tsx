import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import * as customerBorrowApi from '../../../../src/api/customerBorrow';
import { ApiError } from '../../../../src/auth/auth-context';
import { colors, radius, shadow, spacing, typography } from '../../../../src/theme/customerTokens';
import type { Fine, FinePaymentMethod } from '../../../../src/types/borrow';

const PAYMENT_METHODS: { value: FinePaymentMethod; label: string }[] = [
  { value: 'EWALLET', label: 'Ví điện tử' },
  { value: 'CASH', label: 'Tiền mặt tại quầy' },
  { value: 'TRANSFER', label: 'Chuyển khoản' },
  { value: 'CARD', label: 'Thẻ' },
];

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('vi-VN')} đ`;
}

function remainingOf(fine: Fine): number {
  const paid = (fine.fine_payments ?? []).reduce((sum, payment) => sum + payment.amount, 0);
  return Math.max(0, fine.amount - fine.waived_amount - paid);
}

export default function CustomerPayFineScreen() {
  const { fineId } = useLocalSearchParams<{ fineId: string }>();
  const [fine, setFine] = useState<Fine | null>(null);
  const [method, setMethod] = useState<FinePaymentMethod>('EWALLET');
  const [isLoading, setIsLoading] = useState(true);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
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
    load().finally(() => setIsLoading(false));
  }, [load]);

  async function handlePay() {
    if (!fine) return;
    setIsPaying(true);
    setError(null);
    try {
      // amount omitted on purpose — backend settles the full remaining balance,
      // the same "record payment" simulation the web customer portal uses.
      await customerBorrowApi.payMyFine({ fine_id: fine.id, payment_method: method });
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Thanh toán thất bại, vui lòng thử lại.');
    } finally {
      setIsPaying(false);
    }
  }

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

          <Text style={styles.sectionLabel}>Phương thức thanh toán</Text>
          <View style={styles.methodList}>
            {PAYMENT_METHODS.map((option) => (
              <Pressable
                key={option.value}
                style={[styles.methodOption, method === option.value && styles.methodOptionActive]}
                onPress={() => setMethod(option.value)}
              >
                <Text style={[styles.methodLabel, method === option.value && styles.methodLabelActive]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.payButton, isPaying && styles.payButtonDisabled, pressed && styles.payButtonPressed]}
            onPress={handlePay}
            disabled={isPaying}
          >
            <LinearGradient
              colors={[colors.accentGradientStart, colors.accentGradientEnd]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {isPaying ? (
              <ActivityIndicator color={colors.onPrimary} />
            ) : (
              <Text style={styles.payButtonText}>Xác nhận thanh toán</Text>
            )}
          </Pressable>
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
  sectionLabel: {
    ...typography.label,
  },
  methodList: {
    gap: spacing.sm,
  },
  methodOption: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
  },
  methodOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  methodLabel: {
    ...typography.body,
  },
  methodLabelActive: {
    color: colors.primary,
    fontFamily: typography.bodyBold.fontFamily,
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
