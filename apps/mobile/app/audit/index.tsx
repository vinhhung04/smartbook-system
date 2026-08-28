import { useCallback, useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import * as stockAuditApi from '../../src/api/stockAudit';
import { ApiError } from '../../src/auth/auth-context';
import type { StockAuditSummary } from '../../src/types/stockAudit';
import { colors, radius, shadow, spacing, typography } from '../../src/theme/tokens';

export default function StockAuditListScreen() {
  const [audits, setAudits] = useState<StockAuditSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Stock Audit' }} />
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
            data={audits}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Chưa có phiếu kiểm kê nào được giao</Text>}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => router.push(`/audit/${item.id}`)}
              >
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{item.audit_number}</Text>
                  <Text style={styles.cardSubtitle}>
                    {item.warehouse_code ?? '-'} · {item.status} · {item.line_count} dòng
                  </Text>
                  {item.variance_count > 0 ? (
                    <View style={styles.varianceBadge}>
                      <Text style={styles.varianceBadgeText}>{item.variance_count} lệch</Text>
                    </View>
                  ) : null}
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
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardBody: {
    flex: 1,
    gap: spacing.xs,
  },
  cardTitle: {
    ...typography.h3,
  },
  cardSubtitle: {
    ...typography.caption,
  },
  varianceBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    marginTop: 2,
  },
  varianceBadgeText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  chevron: {
    fontSize: 22,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
});
