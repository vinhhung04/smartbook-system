import { router } from 'expo-router';
import { FlatList, RefreshControl, View } from 'react-native';

import { useAuth } from '../../src/auth/auth-context';
import { useTransferReceiving } from '../../src/hooks/useTransferReceiving';
import { WorkOrderCard } from '../../src/components/WorkOrderCard';
import { EmptyState, InlineAlert, ScreenHeader, Skeleton, StatusBadge, radii, space, useTheme } from '../../src/design-system';

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
}

export default function TransferReceivingListScreen() {
  const { user } = useAuth();
  const { rows, isLoading, error, reload } = useTransferReceiving();
  const { colors } = useTheme();

  return (
    <>
      <ScreenHeader title="Nhận hàng điều chuyển" />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {isLoading && rows.length === 0 ? (
          <View style={{ padding: space.lg, gap: space.md }} accessibilityLabel="Đang tải phiếu điều chuyển">
            {[0, 1, 2].map((i) => <Skeleton key={i} height={104} radius={radii.md} />)}
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.item.id}
            contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 }}
            contentInsetAdjustmentBehavior="automatic"
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => void reload()} tintColor={colors.primary} colors={[colors.primary]} />}
            ItemSeparatorComponent={() => <View style={{ height: space.sm }} />}
            ListHeaderComponent={error ? <View style={{ marginBottom: space.md }}><InlineAlert message={error} actionLabel="Thử lại" onAction={() => void reload()} /></View> : null}
            ListEmptyComponent={
              !error ? (
                <EmptyState icon="swap-horizontal-outline" title="Không có kiện nào chờ nhận" message="Kiện điều chuyển gửi tới kho của bạn sẽ hiện ở đây. Kéo xuống để làm mới." />
              ) : null
            }
            renderItem={({ item: row }) => {
              const mine = row.item.received_by_user_id === user?.id;
              const other = Boolean(row.item.received_by_user_id) && !mine;
              const from = row.item.from_warehouse_code ?? row.item.from_warehouse_name ?? '?';
              const to = row.item.to_warehouse_code ?? row.item.to_warehouse_name ?? '?';
              return (
                <WorkOrderCard
                  code={row.item.transfer_number}
                  detail={`${from} → ${to}, gửi lúc ${formatDate(row.item.shipped_at)}${row.item.total_quantity > 0 ? `, ${row.item.total_quantity} sản phẩm` : ''}`}
                  onOpen={() => router.push(`/transfer-receiving/${row.item.id}`)}
                  accessibilityLabel={`Phiếu ${row.item.transfer_number}, ${mine ? 'của tôi' : other ? 'đã giao người khác' : 'chưa có người nhận'}`}
                  badges={
                    <StatusBadge
                      tone={mine ? 'success' : other ? 'neutral' : 'info'}
                      label={mine ? 'Của tôi' : other ? 'Đã giao người khác' : 'Chưa có người nhận'}
                      icon={mine ? 'person' : other ? 'people-outline' : 'hand-left-outline'}
                    />
                  }
                />
              );
            }}
          />
        )}
      </View>
    </>
  );
}
