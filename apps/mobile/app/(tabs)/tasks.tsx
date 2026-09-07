import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';

import { useDashboardTasks } from '../../src/hooks/useDashboardTasks';
import type { MyWarehouseTask } from '../../src/types/myWarehouseTasks';
import { colors, fonts, radius, shadow, spacing, typography } from '../../src/theme/tokens';

const TYPE_LABEL: Record<string, string> = {
  RECEIVING: 'Tiếp nhận hàng',
  PUTAWAY: 'Cất hàng',
  PICKING: 'Lấy hàng',
  OUTBOUND: 'Xuất kho',
  TRANSFER_RECEIVING: 'Nhận điều chuyển',
  PURCHASE_REQUEST: 'Yêu cầu mua hàng',
  EXCEPTION_REPORT: 'Báo cáo sự cố',
  STAFF_TASK: 'Việc được giao',
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

export default function TasksScreen() {
  const { data, isLoading, error, refetch } = useDashboardTasks();

  function handlePress(task: MyWarehouseTask) {
    if (task.action_path) {
      router.push(task.action_path);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Việc của tôi</Text>
        <Text style={styles.subtitle}>{data.tasks.length} việc đang theo dõi</Text>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}

      {isLoading && data.tasks.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data.tasks}
          keyExtractor={(item, index) => `${item.type}-${item.id}-${index}`}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />}
          ListEmptyComponent={<Text style={styles.empty}>Không có việc nào đang theo dõi</Text>}
          renderItem={({ item, index }) => (
            <MotiView
              from={{ opacity: 0, translateY: 6 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 220, delay: Math.min(index, 8) * 40 }}
            >
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
                onPress={() => handlePress(item)}
              >
                <View style={styles.cardBody}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardSubtitle}>
                    {TYPE_LABEL[item.type] ?? item.type} · {item.warehouse ?? '-'} · {formatDate(item.created_at)}
                  </Text>
                </View>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>{item.status}</Text>
                </View>
              </Pressable>
            </MotiView>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    ...typography.h2,
  },
  subtitle: {
    ...typography.caption,
    marginTop: 2,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
  },
  list: {
    padding: spacing.lg,
    paddingTop: 0,
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
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  cardPressed: {
    opacity: 0.85,
  },
  cardBody: {
    flex: 1,
    marginRight: spacing.sm,
  },
  cardTitle: {
    ...typography.h3,
  },
  cardSubtitle: {
    ...typography.caption,
    marginTop: 2,
  },
  statusBadge: {
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm + 2,
    backgroundColor: colors.primarySoft,
  },
  statusBadgeText: {
    fontFamily: fonts.monoSemibold,
    fontSize: 10,
    color: colors.primary,
    letterSpacing: 0.5,
  },
});
