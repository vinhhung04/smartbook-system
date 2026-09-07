import { useCallback, useEffect, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import * as customerBorrowApi from '../../../../src/api/customerBorrow';
import { ApiError } from '../../../../src/auth/auth-context';
import { GlowBadge } from '../../../../src/components/customer/GlowBadge';
import { canRequestRenewal, getLoanStatusDisplay } from '../../../../src/lib/loanStatus';
import { colors, radius, shadow, spacing, typography } from '../../../../src/theme/customerTokens';
import type { Loan } from '../../../../src/types/borrow';

export default function CustomerLoanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRenewing, setIsRenewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await customerBorrowApi.getMyLoanById(id);
      setLoan(result.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được thông tin mượn sách');
    }
  }, [id]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  async function handleRenewRequest() {
    setIsRenewing(true);
    try {
      const result = await customerBorrowApi.requestMyLoanRenewal(id);
      Alert.alert(
        'Đã gửi yêu cầu gia hạn',
        `Thư viện sẽ xem xét gia hạn thêm ${result.data.requested_extension_days} ngày.`,
      );
    } catch (err) {
      Alert.alert('Không gửi được yêu cầu', err instanceof ApiError ? err.message : 'Vui lòng thử lại sau.');
    } finally {
      setIsRenewing(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: loan?.loan_number ?? 'Chi tiết mượn sách' }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error || !loan ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Không tìm thấy'}</Text>
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <View style={styles.statusRow}>
            <GlowBadge text={getLoanStatusDisplay(loan.status).label} tone={getLoanStatusDisplay(loan.status).tone} />
          </View>

          <View style={styles.metaGrid}>
            <MetaRow label="Ngày mượn" value={new Date(loan.borrow_date).toLocaleDateString('vi-VN')} />
            <MetaRow label="Hạn trả" value={new Date(loan.due_date).toLocaleDateString('vi-VN')} />
            <MetaRow label="Số đầu sách" value={String(loan.total_items)} />
          </View>

          {loan.loan_items && loan.loan_items.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Đầu sách trong lượt mượn</Text>
              {loan.loan_items.map((item) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={styles.itemBarcode}>{item.item_barcode ?? item.id.slice(0, 8)}</Text>
                  <Text style={styles.itemStatus}>{item.status}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {canRequestRenewal(loan.status) ? (
            <Pressable
              style={({ pressed }) => [styles.button, isRenewing && styles.buttonDisabled, pressed && styles.buttonPressed]}
              onPress={handleRenewRequest}
              disabled={isRenewing}
            >
              <LinearGradient
                colors={[colors.accentGradientStart, colors.accentGradientEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              {isRenewing ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.buttonText}>Yêu cầu gia hạn</Text>
              )}
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
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
  statusRow: {
    alignItems: 'flex-start',
  },
  metaGrid: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.card,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaLabel: {
    ...typography.caption,
  },
  metaValue: {
    ...typography.bodyBold,
  },
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    ...typography.label,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  itemBarcode: {
    ...typography.code,
    fontSize: 13,
  },
  itemStatus: {
    ...typography.caption,
  },
  button: {
    borderRadius: radius.pill,
    paddingVertical: spacing.md + 4,
    alignItems: 'center',
    overflow: 'hidden',
  },
  buttonPressed: {
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontFamily: typography.h3.fontFamily,
    color: colors.onPrimary,
    fontSize: 16,
  },
});
