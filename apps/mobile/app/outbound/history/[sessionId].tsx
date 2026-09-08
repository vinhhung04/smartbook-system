import { useCallback, useState } from 'react';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';

import { getSessionById, successCount, SESSION_SCAN_CAP, type OutboundSession } from '../../../src/lib/outboundSession';
import { colors, radius, spacing, typography } from '../../../src/theme/tokens';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function OutboundSessionHistoryScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [session, setSession] = useState<OutboundSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setIsLoading(true);
      getSessionById(sessionId).then((data) => {
        if (!cancelled) {
          setSession(data);
          setIsLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }, [sessionId]),
  );

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Không tìm thấy phiên này</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: session.mode === 'outbound' ? 'Xuất kho' : 'Điều chuyển kho' }} />
      <View style={styles.container}>
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>
            Bắt đầu {formatDateTime(session.started_at)}
            {session.ended_at ? ` · Kết thúc ${formatDateTime(session.ended_at)}` : ' · Đang thực hiện'}
          </Text>
          <Text style={styles.summarySubtitle}>
            {successCount(session)}/{SESSION_SCAN_CAP} kiện thành công · {session.attempts.length} lượt quét
          </Text>
        </View>

        <FlatList
          data={[...session.attempts].reverse()}
          keyExtractor={(_, index) => String(index)}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>Phiên này chưa quét kiện nào</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={item.success ? styles.rowTitleOk : styles.rowTitleFail}>{item.code}</Text>
                <Text style={styles.rowMessage}>{item.message}</Text>
              </View>
              <Text style={styles.rowTime}>{new Date(item.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          )}
        />
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
  },
  error: {
    color: colors.danger,
    fontWeight: '600',
  },
  summary: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  summaryTitle: {
    ...typography.h3,
  },
  summarySubtitle: {
    ...typography.caption,
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    padding: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowBody: {
    flex: 1,
  },
  rowTitleOk: {
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rowTitleFail: {
    fontWeight: '700',
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  rowMessage: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  rowTime: {
    color: colors.textMuted,
    fontSize: 12,
    marginLeft: spacing.sm,
    borderRadius: radius.pill,
  },
});
