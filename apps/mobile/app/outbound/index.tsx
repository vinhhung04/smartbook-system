import { useCallback, useState } from 'react';
import { Stack, router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { SESSION_SCAN_CAP, loadSessions, successCount, type OutboundSession } from '../../src/lib/outboundSession';
import { colors, radius, shadow, spacing, typography } from '../../src/theme/tokens';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function sessionStatusLabel(session: OutboundSession): string {
  if (!session.ended_at) return 'Đang thực hiện';
  return successCount(session) >= SESSION_SCAN_CAP ? 'Hoàn tất (đủ 50)' : 'Đã kết thúc';
}

export default function OutboundHomeScreen() {
  const [sessions, setSessions] = useState<OutboundSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setIsLoading(true);
      loadSessions().then((data) => {
        if (!cancelled) {
          setSessions(data);
          setIsLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Xuất kho' }} />
      <View style={styles.container}>
        <View style={styles.startRow}>
          <Pressable
            style={({ pressed }) => [styles.startButton, styles.startButtonOutbound, pressed && styles.buttonPressed]}
            onPress={() => router.push('/outbound/scan/outbound')}
          >
            <Text style={styles.startButtonText}>Xuất kho</Text>
            <Text style={styles.startButtonSubtext}>Quét đơn xuất kho</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.startButton, styles.startButtonTransfer, pressed && styles.buttonPressed]}
            onPress={() => router.push('/outbound/scan/transfer')}
          >
            <Text style={styles.startButtonText}>Điều chuyển kho</Text>
            <Text style={styles.startButtonSubtext}>Quét kiện điều chuyển</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>Lịch sử phiên</Text>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Text style={styles.empty}>Chưa có phiên nào được thực hiện</Text>}
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => router.push(`/outbound/history/${item.id}`)}
              >
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>
                    {item.mode === 'outbound' ? 'Xuất kho' : 'Điều chuyển kho'} · {formatDateTime(item.started_at)}
                  </Text>
                  <Text style={styles.cardSubtitle}>
                    {sessionStatusLabel(item)} · {successCount(item)}/{SESSION_SCAN_CAP} kiện
                  </Text>
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
  },
  startRow: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  startButton: {
    flex: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 2,
    ...shadow.card,
  },
  startButtonOutbound: {
    backgroundColor: colors.primary,
  },
  startButtonTransfer: {
    backgroundColor: colors.neutral,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  startButtonText: {
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
  startButtonSubtext: {
    color: colors.onPrimary,
    opacity: 0.85,
    fontSize: 12,
  },
  sectionLabel: {
    ...typography.label,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  list: {
    padding: spacing.lg,
    paddingTop: spacing.xs,
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
