import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as customerBorrowApi from '../../../src/api/customerBorrow';
import { ApiError } from '../../../src/auth/auth-context';
import { GlowBadge } from '../../../src/components/customer/GlowBadge';
import { getLoanStatusDisplay } from '../../../src/lib/loanStatus';
import { getReservationStatusDisplay } from '../../../src/lib/reservationStatus';
import { colors, radius, shadow, spacing, typography } from '../../../src/theme/customerTokens';
import type { Loan, Reservation } from '../../../src/types/borrow';

type Segment = 'reservations' | 'loans';

export default function CustomerMyBooksScreen() {
  const [segment, setSegment] = useState<Segment>('reservations');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [reservationsResult, loansResult] = await Promise.all([
        customerBorrowApi.getMyReservations(),
        customerBorrowApi.getMyLoans(),
      ]);
      setReservations(reservationsResult.data);
      setLoans(loansResult.data);
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
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Sách của tôi</Text>
        <View style={styles.segmentControl}>
          <SegmentButton label="Phiếu đặt" active={segment === 'reservations'} onPress={() => setSegment('reservations')} />
          <SegmentButton label="Đang mượn" active={segment === 'loans'} onPress={() => setSegment('loans')} />
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
      ) : segment === 'reservations' ? (
        <FlatList
          data={reservations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
          ListEmptyComponent={<Text style={styles.empty}>Bạn chưa có phiếu đặt sách nào</Text>}
          renderItem={({ item }) => {
            const display = getReservationStatusDisplay(item.status);
            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => router.push(`/customer/my-books/reservation/${item.id}`)}
              >
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{item.reservation_number}</Text>
                  <Text style={styles.cardSubtitle}>Đặt lúc {new Date(item.reserved_at).toLocaleDateString('vi-VN')}</Text>
                </View>
                <GlowBadge text={display.label} tone={display.tone} />
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          data={loans}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={load} tintColor={colors.primary} />}
          ListEmptyComponent={<Text style={styles.empty}>Bạn chưa mượn cuốn sách nào</Text>}
          renderItem={({ item }) => {
            const display = getLoanStatusDisplay(item.status);
            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => router.push(`/customer/my-books/loan/${item.id}`)}
              >
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{item.loan_number}</Text>
                  <Text style={styles.cardSubtitle}>Hạn trả {new Date(item.due_date).toLocaleDateString('vi-VN')}</Text>
                </View>
                <GlowBadge text={display.label} tone={display.tone} />
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

function SegmentButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.segmentButton, active && styles.segmentButtonActive]} onPress={onPress}>
      <Text style={[styles.segmentButtonText, active && styles.segmentButtonTextActive]}>{label}</Text>
    </Pressable>
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
  segmentControl: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm - 2,
  },
  segmentButtonActive: {
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  segmentButtonText: {
    ...typography.caption,
    fontWeight: '600',
  },
  segmentButtonTextActive: {
    color: colors.primary,
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
  cardPressed: {
    opacity: 0.7,
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
});
