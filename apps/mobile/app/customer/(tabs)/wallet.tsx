import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import * as customerBorrowApi from '../../../src/api/customerBorrow';
import { ApiError } from '../../../src/auth/auth-context';
import { GlowBadge } from '../../../src/components/customer/GlowBadge';
import { canPayFine, getFineStatusDisplay } from '../../../src/lib/fineStatus';
import { colors, radius, shadow, spacing, typography } from '../../../src/theme/customerTokens';
import type { Fine } from '../../../src/types/borrow';

function formatCurrency(amount: number): string {
  return `${amount.toLocaleString('vi-VN')} đ`;
}

export default function CustomerWalletScreen() {
  const [balance, setBalance] = useState(0);
  const [fines, setFines] = useState<Fine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await customerBorrowApi.getMyFines();
      setBalance(result.data.total_fine_balance);
      setFines(result.data.fines);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được thông tin phí phạt');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Ví & Phí phạt</Text>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>SỐ DƯ PHÍ PHẠT CHƯA TRẢ</Text>
          <Text style={[styles.balanceAmount, balance > 0 && styles.balanceAmountDue]}>{formatCurrency(balance)}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={fines}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
          ListEmptyComponent={<Text style={styles.empty}>Bạn không có khoản phí phạt nào</Text>}
          renderItem={({ item }) => {
            const display = getFineStatusDisplay(item.status);
            return (
              <View style={styles.card}>
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{item.fine_type}</Text>
                  <Text style={styles.cardSubtitle}>{new Date(item.issued_at).toLocaleDateString('vi-VN')}</Text>
                  <Text style={styles.cardAmount}>{formatCurrency(item.amount - item.waived_amount)}</Text>
                </View>
                <View style={styles.cardActions}>
                  <GlowBadge text={display.label} tone={display.tone} />
                  {canPayFine(item.status) ? (
                    <Pressable style={styles.payButton} onPress={() => router.push(`/customer/wallet/pay/${item.id}`)}>
                      <LinearGradient
                        colors={[colors.accentGradientStart, colors.accentGradientEnd]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                      <Text style={styles.payButtonText}>Thanh toán</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  error: {
    color: colors.danger,
    fontWeight: '600',
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
    gap: spacing.sm,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    padding: spacing.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  cardBody: {
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
  cardActions: {
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  payButton: {
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    overflow: 'hidden',
  },
  payButtonText: {
    color: colors.onPrimary,
    fontFamily: typography.bodyBold.fontFamily,
    fontSize: 12,
  },
});
