import { useCallback, useEffect, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import * as customerBorrowApi from '../../../../src/api/customerBorrow';
import { ApiError } from '../../../../src/auth/auth-context';
import { CustomerPickupTicket } from '../../../../src/components/customer/CustomerPickupTicket';
import { canCancelReservation } from '../../../../src/lib/reservationStatus';
import { colors, radius, spacing, typography } from '../../../../src/theme/customerTokens';
import type { Reservation } from '../../../../src/types/borrow';

export default function CustomerReservationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await customerBorrowApi.getMyReservationById(id);
      setReservation(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được phiếu đặt');
    }
  }, [id]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  function handleCancel() {
    Alert.alert('Hủy phiếu đặt', 'Bạn có chắc muốn hủy phiếu đặt này?', [
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

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: reservation?.reservation_number ?? 'Phiếu đặt sách' }} />
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error || !reservation ? (
        <View style={styles.center}>
          <Text style={styles.error}>{error ?? 'Không tìm thấy phiếu đặt'}</Text>
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
          <CustomerPickupTicket
            reservationNumber={reservation.reservation_number}
            pickupCode={reservation.pickup_code}
            status={reservation.status}
            expiresAt={reservation.pickup_code_expires_at}
          />

          <View style={styles.metaGrid}>
            <MetaRow label="Đặt lúc" value={new Date(reservation.reserved_at).toLocaleString('vi-VN')} />
            <MetaRow label="Hết hạn giữ chỗ" value={new Date(reservation.expires_at).toLocaleString('vi-VN')} />
            <MetaRow label="Số lượng" value={String(reservation.quantity)} />
          </View>

          {canCancelReservation(reservation.status) ? (
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
              onPress={handleCancel}
              disabled={isCancelling}
            >
              {isCancelling ? (
                <ActivityIndicator color={colors.danger} />
              ) : (
                <Text style={styles.cancelButtonText}>Hủy phiếu đặt</Text>
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
  metaGrid: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
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
  cancelButton: {
    borderWidth: 1.5,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  cancelButtonPressed: {
    opacity: 0.8,
  },
  cancelButtonText: {
    color: colors.danger,
    fontFamily: typography.bodyBold.fontFamily,
    fontSize: 15,
  },
});
