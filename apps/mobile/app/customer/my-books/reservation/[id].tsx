import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';

import * as customerBorrowApi from '../../../../src/api/customerBorrow';
import { ApiError } from '../../../../src/auth/auth-context';
import { CustomerPickupTicket } from '../../../../src/components/customer/CustomerPickupTicket';
import { canCancelReservation } from '../../../../src/lib/reservationStatus';
import { Button, Card, ErrorState, InfoRow, LoadingState, Screen, ScreenHeader, fontFamily, useTheme } from '../../../../src/design-system';
import type { Reservation } from '../../../../src/types/borrow';

export default function CustomerReservationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, type } = useTheme();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await customerBorrowApi.getMyReservationById(id);
      setReservation(result.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được phiếu đặt');
    }
  }, [id]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  function handleCancel() {
    if (isCancelling) return;
    Alert.alert('Hủy phiếu đặt', 'Bạn có chắc muốn hủy phiếu đặt này? Sách sẽ được nhường cho bạn đọc khác.', [
      { text: 'Không', style: 'cancel' },
      {
        text: 'Hủy phiếu',
        style: 'destructive',
        onPress: async () => {
          setIsCancelling(true);
          try {
            await customerBorrowApi.cancelMyReservation(id);
            await load();
          } catch (err) {
            Alert.alert('Không hủy được', err instanceof ApiError ? err.message : 'Vui lòng thử lại sau.');
          } finally {
            setIsCancelling(false);
          }
        },
      },
    ]);
  }

  const title = 'Phiếu đặt trước';
  if (isLoading) {
    return (<><ScreenHeader title={title} /><Screen scroll={false}><LoadingState /></Screen></>);
  }
  if (error || !reservation) {
    return (<><ScreenHeader title={title} /><Screen scroll={false}><ErrorState message={error ?? 'Không tìm thấy phiếu đặt'} onRetry={() => { setIsLoading(true); void load().finally(() => setIsLoading(false)); }} /></Screen></>);
  }

  return (
    <>
      <ScreenHeader title={title} />
      <Screen onRefresh={() => void load()}>
        {reservation.book_title ? (
          <View style={{ gap: 2 }}>
            <Text style={{ fontFamily: fontFamily.serif, fontSize: 26, lineHeight: 31, color: colors.textPrimary }} numberOfLines={3} accessibilityRole="header">{reservation.book_title}</Text>
            {reservation.book_author ? <Text style={type.callout}>{reservation.book_author}</Text> : null}
          </View>
        ) : null}

        <CustomerPickupTicket
          reservationNumber={reservation.reservation_number}
          pickupCode={reservation.pickup_code}
          status={reservation.status}
          expiresAt={reservation.pickup_code_expires_at}
        />

        <Card>
          <InfoRow label="Đặt lúc" value={new Date(reservation.reserved_at).toLocaleString('vi-VN')} />
          <InfoRow label="Giữ chỗ đến" value={new Date(reservation.expires_at).toLocaleString('vi-VN')} />
          <InfoRow label="Số lượng" value={String(reservation.quantity)} />
        </Card>

        {canCancelReservation(reservation.status) ? (
          <Button label="Hủy phiếu đặt" icon="close-circle-outline" variant="secondary" loading={isCancelling} loadingLabel="Đang hủy…" onPress={handleCancel} />
        ) : null}
      </Screen>
    </>
  );
}
