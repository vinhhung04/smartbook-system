import { router } from 'expo-router';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';

import { useAuth } from '../../src/auth/auth-context';
import { FeatureCard } from '../../src/components/FeatureCard';
import { SpineChart, type SpineSegment } from '../../src/components/SpineChart';
import { useCountUp } from '../../src/hooks/useCountUp';
import { useDashboardTasks } from '../../src/hooks/useDashboardTasks';
import { colors, radius, shadow, spacing, typography } from '../../src/theme/tokens';

type Feature = {
  key: 'picking' | 'lookup' | 'putaway' | 'audit' | 'outbound' | 'exceptions';
  title: string;
  subtitle: string;
  tag: string;
  tint: string;
  tintSoft: string;
  href: '/picking' | '/lookup' | '/putaway' | '/audit' | '/outbound' | '/exceptions';
};

const FEATURES: Feature[] = [
  {
    key: 'picking',
    title: 'Picking',
    subtitle: 'Xem và nhận phiếu lấy hàng',
    tag: 'PK',
    tint: colors.primary,
    tintSoft: colors.primarySoft,
    href: '/picking',
  },
  {
    key: 'lookup',
    title: 'Tra cứu nhanh',
    subtitle: 'Quét mã để xem sách, tồn kho, vị trí',
    tag: 'TC',
    tint: colors.warning,
    tintSoft: colors.warningSoft,
    href: '/lookup',
  },
  {
    key: 'putaway',
    title: 'Putaway',
    subtitle: 'Cất sách từ khu chờ vào kệ',
    tag: 'PA',
    tint: colors.success,
    tintSoft: colors.successSoft,
    href: '/putaway',
  },
  {
    key: 'audit',
    title: 'Stock Audit',
    subtitle: 'Kiểm kê, đối chiếu tồn kho thực tế',
    tag: 'KK',
    tint: colors.neutral,
    tintSoft: colors.neutralSoft,
    href: '/audit',
  },
  {
    key: 'outbound',
    title: 'Xuất kho',
    subtitle: 'Quét mã đơn trên kiện hàng để xác nhận xuất kho',
    tag: 'XK',
    tint: colors.danger,
    tintSoft: colors.dangerSoft,
    href: '/outbound',
  },
  {
    key: 'exceptions',
    title: 'Báo cáo sự cố',
    subtitle: 'Thiếu/dư/hư hỏng — kèm ảnh bằng chứng',
    tag: 'BC',
    tint: colors.danger,
    tintSoft: colors.dangerSoft,
    href: '/exceptions',
  },
];

export default function HomeDashboardScreen() {
  const { user } = useAuth();
  const { data, isLoading, error, refetch } = useDashboardTasks();
  const total = useCountUp(data.total);

  const tileCounts: Record<Feature['key'], number | undefined> = {
    picking: data.counts.picking,
    lookup: undefined,
    putaway: data.counts.putaway,
    audit: data.counts.audit,
    outbound: data.counts.outbound,
    exceptions: data.counts.exceptions,
  };

  const segments: SpineSegment[] = [
    { key: 'picking', label: 'Lấy hàng', count: data.counts.picking, tone: 'primary' },
    { key: 'putaway', label: 'Cất hàng', count: data.counts.putaway, tone: 'primary' },
    { key: 'outbound', label: 'Xuất kho', count: data.counts.outbound, tone: 'primary' },
    { key: 'audit', label: 'Kiểm kê', count: data.counts.audit, tone: 'primary' },
    { key: 'exceptions', label: 'Sự cố', count: data.counts.exceptions, tone: 'warning' },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.primary} />}
      >
        <Text style={styles.greeting}>Xin chào, {user?.username}</Text>
        <Text style={styles.role}>Vai trò: {user?.roles.join(', ')}</Text>

        <MotiView
          key={data.total}
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 300 }}
          style={styles.hero}
        >
          <Text style={styles.heroLabel}>VIỆC ĐANG CHỜ CA NÀY</Text>
          <Text style={styles.heroNumber}>{total}</Text>
          {error ? (
            <Text style={styles.heroError}>{error}</Text>
          ) : (
            <SpineChart key={`spines-${data.total}`} segments={segments} />
          )}
        </MotiView>

        <Text style={styles.sectionLabel}>Chức năng</Text>

        <View style={styles.list}>
          {FEATURES.map((feature) => (
            <FeatureCard
              key={feature.key}
              title={feature.title}
              subtitle={feature.subtitle}
              tag={feature.tag}
              tint={feature.tint}
              tintSoft={feature.tintSoft}
              count={tileCounts[feature.key]}
              onPress={() => router.push(feature.href)}
            />
          ))}
        </View>

        {isLoading ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}
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
  },
  greeting: {
    ...typography.h2,
  },
  role: {
    ...typography.caption,
    marginTop: 2,
  },
  hero: {
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadow.card,
  },
  heroLabel: {
    ...typography.label,
  },
  heroNumber: {
    ...typography.h1,
    fontSize: 52,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  heroError: {
    color: colors.danger,
    fontSize: 13,
  },
  sectionLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.md,
  },
  spinner: {
    marginTop: spacing.lg,
  },
});
