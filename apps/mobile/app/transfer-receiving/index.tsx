import { Stack, router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../../src/auth/auth-context';
import { useTransferReceiving } from '../../src/hooks/useTransferReceiving';
import { colors, fonts, radius, shadow, spacing, typography } from '../../src/theme/tokens';

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
}

export default function TransferReceivingListScreen() {
  const { user } = useAuth();
  const { rows, isLoading, error, reload } = useTransferReceiving();

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Nhận hàng điều chuyển' }} />
      <View style={styles.container}>
        {isLoading && rows.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={rows}
            keyExtractor={(row) => row.item.id}
            contentContainerStyle={styles.list}
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => void reload()} tintColor={colors.primary} colors={[colors.primary]} />}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
            ListEmptyComponent={
              !error ? (
                <View style={styles.center}>
                  <Ionicons name="swap-horizontal-outline" size={28} color={colors.textMuted} />
                  <Text style={styles.empty}>Không có kiện điều chuyển nào đang chờ nhận tại kho của bạn.</Text>
                </View>
              ) : null
            }
            renderItem={({ item: row }) => {
              const mine = row.item.received_by_user_id === user?.id;
              const other = Boolean(row.item.received_by_user_id) && !mine;
              return (
                <Pressable
                  style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                  onPress={() => router.push(`/transfer-receiving/${row.item.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`Phiếu ${row.item.transfer_number}`}
                >
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>{row.item.transfer_number}</Text>
                    <Text style={styles.cardSubtitle}>
                      {row.item.from_warehouse_code ?? row.item.from_warehouse_name ?? '?'} → {row.item.to_warehouse_code ?? row.item.to_warehouse_name ?? '?'}
                    </Text>
                    <Text style={styles.cardSubtitle}>
                      Gửi lúc {formatDate(row.item.shipped_at)}
                      {row.item.total_quantity > 0 ? ` · ${row.item.total_quantity} sản phẩm` : ''}
                    </Text>
                  </View>
                  <View style={[styles.badge, mine ? styles.badgeMine : other ? styles.badgeOther : styles.badgeOpen]}>
                    <Text style={[styles.badgeText, { color: mine ? colors.success : other ? colors.neutral : colors.primary }]}>
                      {mine ? 'Của tôi' : other ? 'Đã giao' : 'Chưa nhận'}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  list: { padding: spacing.lg, flexGrow: 1 },
  separator: { height: spacing.sm },
  error: { color: colors.danger, marginBottom: spacing.sm },
  empty: { ...typography.caption, textAlign: 'center' },
  card: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, ...shadow.card },
  pressed: { opacity: 0.85 },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { ...typography.h3 },
  cardSubtitle: { ...typography.caption },
  badge: { borderRadius: radius.pill, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm + 2 },
  badgeMine: { backgroundColor: colors.successSoft },
  badgeOther: { backgroundColor: colors.neutralSoft },
  badgeOpen: { backgroundColor: colors.primarySoft },
  badgeText: { fontFamily: fonts.monoSemibold, fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' },
});
