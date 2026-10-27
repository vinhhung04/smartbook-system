import { router } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../../src/auth/auth-context';
import { canUseStaffFeature, type StaffFeature } from '../../src/auth/access';
import { FeatureCard } from '../../src/components/FeatureCard';
import { TaskCard } from '../../src/components/TaskCard';
import { useDashboardTasks, type FeatureCounts, type TaskEntry } from '../../src/hooks/useDashboardTasks';
import { describeRoles, greetingFor } from '../../src/lib/roles';
import { colors, fonts, radius, shadow, spacing, typography } from '../../src/theme/tokens';

type Feature = {
  key: StaffFeature;
  countKey?: keyof FeatureCounts;
  title: string;
  subtitle: string;
  tag: string;
  tint: string;
  tintSoft: string;
  href: string;
};

const FEATURES: Feature[] = [
  { key: 'picking', countKey: 'picking', title: 'Lấy hàng (Picking)', subtitle: 'Nhận và lấy hàng theo phiếu', tag: 'PK', tint: colors.primary, tintSoft: colors.primarySoft, href: '/picking' },
  { key: 'putaway', countKey: 'putaway', title: 'Cất hàng (Putaway)', subtitle: 'Cất sách từ khu chờ lên kệ', tag: 'PA', tint: colors.success, tintSoft: colors.successSoft, href: '/putaway' },
  { key: 'outbound', countKey: 'outbound', title: 'Xuất kho', subtitle: 'Quét mã đơn trên kiện để xác nhận xuất', tag: 'XK', tint: colors.danger, tintSoft: colors.dangerSoft, href: '/outbound' },
  { key: 'transferReceiving', countKey: 'transferReceiving', title: 'Nhận điều chuyển', subtitle: 'Xác nhận hàng điều chuyển đã tới kho', tag: 'NĐ', tint: colors.primary, tintSoft: colors.primarySoft, href: '/transfer-receiving' },
  { key: 'audit', countKey: 'audit', title: 'Kiểm kê', subtitle: 'Đếm và đối chiếu tồn kho thực tế', tag: 'KK', tint: colors.neutral, tintSoft: colors.neutralSoft, href: '/audit' },
  { key: 'exceptions', countKey: 'exceptions', title: 'Báo cáo sự cố', subtitle: 'Thiếu/dư/hư hỏng — kèm ảnh bằng chứng', tag: 'BC', tint: colors.warning, tintSoft: colors.warningSoft, href: '/exceptions' },
  { key: 'lookup', title: 'Tra cứu nhanh', subtitle: 'Quét mã để xem sách, tồn kho, vị trí', tag: 'TC', tint: colors.warning, tintSoft: colors.warningSoft, href: '/lookup' },
];

function SummaryTile({ label, value, icon, tone }: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap; tone: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <Ionicons name={icon} size={16} color={tone} />
      <Text style={[styles.tileValue, { color: tone }]}>{value}</Text>
      <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

export default function HomeDashboardScreen() {
  const { user } = useAuth();
  const { data, isLoading, isRefreshing, error, refetch } = useDashboardTasks();
  const features = FEATURES.filter((feature) => canUseStaffFeature(user, feature.key));
  const name = user?.full_name || user?.username || '';

  function openTask(entry: TaskEntry) {
    if (entry.route.kind === 'screen') router.push(entry.route.href as never);
    else Alert.alert(entry.task.title, entry.route.reason);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refetch} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <View style={styles.header}>
          <Text style={styles.greeting}>{greetingFor(new Date())},</Text>
          <Text style={styles.name} numberOfLines={1} accessibilityRole="header">{name}</Text>
          <Text style={styles.role}>{describeRoles(user?.roles ?? [])}</Text>
        </View>

        <View style={styles.summary}>
          <Text style={styles.sectionLabel}>Ca làm việc</Text>
          {error ? (
            <View style={styles.errorRow}>
              <Text style={styles.error}>{error}</Text>
              <Pressable onPress={() => void refetch()} style={styles.retry} accessibilityRole="button">
                <Text style={styles.retryText}>Thử lại</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.tiles}>
              <SummaryTile label="Cần làm" value={data.counts.todo} icon="ellipse-outline" tone={colors.primary} />
              <SummaryTile label="Đang xử lý" value={data.counts.in_progress} icon="time-outline" tone={colors.warning} />
              <SummaryTile label="Hoàn thành gần đây" value={data.counts.done} icon="checkmark-circle" tone={colors.neutral} />
            </View>
          )}
          {!error && data.counts.waiting > 0 ? (
            <Text style={styles.waiting}>+ {data.counts.waiting} việc đang chờ quản lý duyệt/xử lý</Text>
          ) : null}
          {data.warnings.map((warning) => (
            <Text key={warning} style={styles.warning}>{warning}</Text>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Việc tiếp theo</Text>
        {isLoading && data.entries.length === 0 ? (
          <ActivityIndicator color={colors.primary} style={styles.spinner} />
        ) : data.next ? (
          <TaskCard entry={data.next} onOpen={openTask} />
        ) : !error ? (
          <View style={styles.nextEmpty}>
            <Ionicons name="checkmark-done-outline" size={22} color={colors.success} />
            <Text style={styles.nextEmptyText}>Không có việc nào đang chờ bạn trên ứng dụng.</Text>
          </View>
        ) : null}

        {canUseStaffFeature(user, 'lookup') ? (
          <Pressable
            style={({ pressed }) => [styles.scanButton, pressed && styles.pressed]}
            onPress={() => router.push('/scan')}
            accessibilityRole="button"
            accessibilityLabel="Quét nhanh mã sách hoặc vị trí"
          >
            <Ionicons name="scan" size={22} color={colors.onPrimary} />
            <View style={styles.scanBody}>
              <Text style={styles.scanTitle}>Quét nhanh</Text>
              <Text style={styles.scanSubtitle}>Mã sách, ISBN hoặc mã vị trí kệ</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.onPrimary} />
          </Pressable>
        ) : null}

        <Text style={styles.sectionLabel}>Nghiệp vụ</Text>
        <View style={styles.list}>
          {features.map((feature) => (
            <FeatureCard
              key={feature.key}
              title={feature.title}
              subtitle={feature.subtitle}
              tag={feature.tag}
              tint={feature.tint}
              tintSoft={feature.tintSoft}
              count={feature.countKey ? data.features[feature.countKey] : undefined}
              onPress={() => router.push(feature.href as never)}
            />
          ))}
          {features.length === 0 ? (
            <Text style={styles.warning}>Tài khoản chưa được cấp quyền nghiệp vụ kho nào trên ứng dụng.</Text>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  header: {
    gap: 2,
  },
  greeting: {
    ...typography.caption,
  },
  name: {
    ...typography.h2,
  },
  role: {
    ...typography.label,
    color: colors.primary,
  },
  summary: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm,
    ...shadow.card,
  },
  sectionLabel: {
    ...typography.label,
    marginTop: spacing.xs,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    gap: 2,
  },
  tileValue: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
  },
  tileLabel: {
    ...typography.caption,
    fontSize: 12,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  error: {
    flex: 1,
    color: colors.danger,
    fontSize: 13,
  },
  retry: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  retryText: {
    color: colors.primary,
    fontFamily: fonts.bodySemibold,
  },
  warning: {
    ...typography.caption,
    color: colors.warning,
  },
  waiting: {
    ...typography.caption,
  },
  spinner: {
    marginVertical: spacing.lg,
  },
  nextEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.successSoft,
  },
  nextEmptyText: {
    ...typography.caption,
    flex: 1,
    color: colors.textPrimary,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
  },
  pressed: {
    opacity: 0.85,
  },
  scanBody: {
    flex: 1,
  },
  scanTitle: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.onPrimary,
  },
  scanSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.onPrimary,
    opacity: 0.85,
  },
  list: {
    gap: spacing.md,
  },
});
