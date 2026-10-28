import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { FlatList, RefreshControl, View } from 'react-native';

import * as stockAuditApi from '../../src/api/stockAudit';
import { ApiError } from '../../src/auth/auth-context';
import { getAuditStatusLabel } from '../../src/lib/stockAuditScan';
import type { StockAuditSummary } from '../../src/types/stockAudit';
import { WorkOrderCard } from '../../src/components/WorkOrderCard';
import { EmptyState, ErrorState, ScreenHeader, Skeleton, StatusBadge, radii, space, useTheme } from '../../src/design-system';

export default function StockAuditListScreen() {
  const [audits, setAudits] = useState<StockAuditSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { colors } = useTheme();

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await stockAuditApi.getMyAudits();
      setAudits(result.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được danh sách');
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  return (
    <>
      <ScreenHeader title="Kiểm kê" />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {isLoading ? (
          <View style={{ padding: space.lg, gap: space.md }} accessibilityLabel="Đang tải phiếu kiểm kê">
            {[0, 1, 2].map((i) => <Skeleton key={i} height={96} radius={radii.md} />)}
          </View>
        ) : error ? (
          <ErrorState message={error} onRetry={() => { setIsLoading(true); void load().finally(() => setIsLoading(false)); }} />
        ) : (
          <FlatList
            data={audits}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 }}
            contentInsetAdjustmentBehavior="automatic"
            refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
            ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
            ListEmptyComponent={<EmptyState icon="clipboard-outline" title="Chưa có phiếu kiểm kê nào" message="Phiếu kiểm kê quản lý giao cho bạn sẽ hiện ở đây." />}
            renderItem={({ item }) => (
              <WorkOrderCard
                code={item.audit_number}
                detail={`Kho ${item.warehouse_code ?? '—'}, ${item.line_count} dòng`}
                onOpen={() => router.push(`/audit/${item.id}`)}
                accessibilityLabel={`Phiếu ${item.audit_number}, ${getAuditStatusLabel(item.status)}, ${item.line_count} dòng${item.variance_count > 0 ? `, ${item.variance_count} dòng lệch` : ''}`}
                badges={(
                  <>
                    <StatusBadge tone="neutral" label={getAuditStatusLabel(item.status)} />
                    {item.variance_count > 0 ? <StatusBadge tone="warning" label={`${item.variance_count} lệch`} icon="alert-circle" /> : null}
                  </>
                )}
              />
            )}
          />
        )}
      </View>
    </>
  );
}
