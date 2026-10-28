import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { FlatList, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as exceptionReportApi from '../../src/api/exceptionReport';
import { ApiError } from '../../src/auth/auth-context';
import type { ExceptionReport } from '../../src/types/exceptionReport';
import { BottomActionBar, Button, EmptyState, InlineAlert, ScreenHeader, Skeleton, StatusBadge, fontFamily, radii, space, useTheme, type Tone } from '../../src/design-system';

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

function statusTone(status: string): Tone {
  if (status === 'RESOLVED') return 'success';
  if (status === 'DISMISSED') return 'neutral';
  if (status === 'ACKNOWLEDGED') return 'info';
  return 'warning';
}

export default function ExceptionReportListScreen() {
  const { colors, type } = useTheme();
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
      <ScreenHeader title="Báo cáo sự cố" />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {isLoading ? (
          <View style={{ padding: space.lg, gap: space.md }} accessibilityLabel="Đang tải báo cáo">
            {[0, 1, 2].map((i) => <Skeleton key={i} height={104} radius={radii.md} />)}
          </View>
        ) : (
          <FlatList
            data={reports}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: space.lg, paddingBottom: 140, gap: space.sm, flexGrow: 1 }}
            contentInsetAdjustmentBehavior="automatic"
            ListHeaderComponent={error ? <View style={{ marginBottom: space.sm }}><InlineAlert message={error} actionLabel="Thử lại" onAction={() => void load()} /></View> : undefined}
            ListEmptyComponent={!error ? <EmptyState icon="flag-outline" title="Chưa có báo cáo nào" message="Gặp hàng thiếu, dư hay hư hỏng? Báo ngay kèm ảnh để quản lý xử lý." /> : undefined}
            renderItem={({ item }) => (
              <View
                style={{ padding: space.lg, gap: space.sm, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                accessible
                accessibilityLabel={`${item.report_number}, ${EXCEPTION_TYPE_LABEL[item.exception_type] ?? item.exception_type}, ${STATUS_LABEL[item.status] ?? item.status}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  <Text selectable style={{ flex: 1, fontFamily: fontFamily.monoBold, fontSize: 15, color: colors.textPrimary }}>{item.report_number}</Text>
                  <StatusBadge tone={statusTone(item.status)} label={STATUS_LABEL[item.status] ?? item.status} />
                </View>
                <Text style={type.caption}>
                  {EXCEPTION_TYPE_LABEL[item.exception_type] ?? item.exception_type}, kho {item.warehouses?.code ?? '—'}, {formatDateTime(item.created_at)}
                </Text>
                {item.note ? <Text style={type.body} numberOfLines={2}>{item.note}</Text> : null}
                {item.evidence_photo_url ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="image-outline" size={14} color={colors.textSecondary} />
                    <Text style={{ fontFamily: fontFamily.medium, fontSize: 12.5, color: colors.textSecondary }}>Có ảnh bằng chứng</Text>
                  </View>
                ) : null}
              </View>
            )}
          />
        )}

        <BottomActionBar>
          <Button label="Báo cáo sự cố mới" icon="add-circle" onPress={() => router.push('/exceptions/new')} accessibilityHint="Thiếu, dư, hư hỏng, kèm ảnh bằng chứng" />
        </BottomActionBar>
      </View>
    </>
  );
}
