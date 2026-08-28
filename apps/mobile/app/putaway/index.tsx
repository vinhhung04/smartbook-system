import { useCallback, useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import * as putawayApi from '../../src/api/putaway';
import { ApiError } from '../../src/auth/auth-context';
import type { ReceivingLocation } from '../../src/types/putaway';
import { colors, radius, shadow, spacing, typography } from '../../src/theme/tokens';

export default function PutawayListScreen() {
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [receivings, setReceivings] = useState<ReceivingLocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const wid = await putawayApi.getWorkingWarehouseId();
      if (!wid) {
        setError('Không xác định được kho làm việc. Cần có ít nhất 1 phiếu Picking khả dụng để xác định kho.');
        return;
      }
      setWarehouseId(wid);
      const result = await putawayApi.getReceivings(wid);
      setReceivings(result.receivings);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được danh sách');
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Putaway' }} />
      <View style={styles.container}>
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
            data={receivings}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Không có khu vực nào đang chờ cất hàng</Text>}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() =>
                  router.push({
                    pathname: '/putaway/[receivingId]',
                    params: { receivingId: item.id, warehouseId: warehouseId ?? '' },
                  })
                }
              >
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{item.location_code}</Text>
                  <Text style={styles.cardSubtitle}>{item.location_type}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </>
  );
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
    padding: spacing.lg,
  },
  error: {
    color: colors.danger,
    textAlign: 'center',
    fontWeight: '600',
  },
  list: {
    padding: spacing.lg,
    gap: spacing.sm + 2,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    padding: spacing.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardBody: {
    flex: 1,
  },
  cardTitle: {
    ...typography.h3,
  },
  cardSubtitle: {
    ...typography.caption,
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
});
