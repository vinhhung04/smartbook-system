import { useCallback, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import * as exceptionReportApi from '../../src/api/exceptionReport';
import { ApiError } from '../../src/auth/auth-context';
import type { ExceptionReport } from '../../src/types/exceptionReport';
import { colors, fonts, radius, shadow, spacing, typography } from '../../src/theme/tokens';

const EXCEPTION_TYPE_LABEL: Record<string, string> = {
  SHORT: 'Thiếu hàng',
  OVERAGE: 'Dư hàng',
  DAMAGED: 'Hư hỏng',
  WRONG_ITEM: 'Sai sản phẩm',
  WRONG_QTY: 'Sai số lượng',
  OTHER: 'Khác',
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Chờ xử lý',
  ACKNOWLEDGED: 'Đã tiếp nhận',
  RESOLVED: 'Đã xử lý',
  DISMISSED: 'Đã bỏ qua',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ExceptionReportListScreen() {
  const [reports, setReports] = useState<ExceptionReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await exceptionReportApi.getMyReports();
      setReports(result.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được danh sách');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Báo cáo sự cố' }} />
      <View style={styles.container}>
        <View style={styles.startRow}>
          <Pressable
            style={({ pressed }) => [styles.startButton, pressed && styles.buttonPressed]}
            onPress={() => router.push('/exceptions/new')}
          >
            <Text style={styles.startButtonText}>+ BÁO CÁO SỰ CỐ</Text>
            <Text style={styles.startButtonSubtext}>Thiếu/dư/hư hỏng — kèm ảnh bằng chứng</Text>
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
          <FlatList
            data={reports}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Bạn chưa gửi báo cáo sự cố nào</Text>}
            renderItem={({ item }) => (
              <View style={styles.card}>
                {item.evidence_photo_url ? (
                  <View style={styles.photoDot} />
                ) : null}
                <View style={styles.cardBody}>
                  <View style={styles.titleRow}>
                    <Text style={styles.cardTitle}>{item.report_number}</Text>
                    <View style={[styles.statusBadge, statusBadgeStyle(item.status)]}>
                      <Text style={[styles.statusBadgeText, statusTextStyle(item.status)]}>
                        {STATUS_LABEL[item.status] ?? item.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.cardSubtitle}>
                    {EXCEPTION_TYPE_LABEL[item.exception_type] ?? item.exception_type} · {item.warehouses?.code ?? '-'} · {formatDateTime(item.created_at)}
                  </Text>
                  <Text style={styles.cardNote} numberOfLines={2}>{item.note}</Text>
                </View>
              </View>
            )}
          />
        )}
      </View>
    </>
  );
}

function statusBadgeStyle(status: string) {
  if (status === 'RESOLVED') return { backgroundColor: colors.successSoft };
  if (status === 'DISMISSED') return { backgroundColor: colors.neutralSoft };
  return { backgroundColor: colors.warningSoft };
}

function statusTextStyle(status: string) {
  if (status === 'RESOLVED') return { color: colors.success };
  if (status === 'DISMISSED') return { color: colors.neutral };
  return { color: colors.warning };
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
  startRow: {
    padding: spacing.lg,
  },
  startButton: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 2,
    backgroundColor: colors.danger,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  startButtonText: {
    fontFamily: fonts.displayBold,
    color: colors.onPrimary,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  startButtonSubtext: {
    fontFamily: fonts.bodyMedium,
    color: colors.onPrimary,
    opacity: 0.85,
    fontSize: 12,
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
    ...typography.code,
    color: colors.danger,
    fontSize: 13,
  },
  list: {
    padding: spacing.lg,
    paddingTop: 0,
    gap: spacing.sm + 2,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    padding: spacing.lg,
  },
  card: {
    flexDirection: 'row',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  photoDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    marginRight: spacing.sm,
    marginTop: 6,
  },
  cardBody: {
    flex: 1,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: {
    ...typography.code,
    fontSize: 15,
    color: colors.primary,
  },
  statusBadge: {
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  statusBadgeText: {
    fontFamily: fonts.monoSemibold,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  cardSubtitle: {
    ...typography.caption,
  },
  cardNote: {
    ...typography.body,
    fontSize: 14,
  },
});
