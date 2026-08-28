import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../src/auth/auth-context';
import { colors, radius, shadow, spacing, typography } from '../src/theme/tokens';

type Feature = {
  key: string;
  title: string;
  subtitle: string;
  tag: string;
  tint: string;
  tintSoft: string;
  href: '/picking' | '/lookup' | '/putaway' | '/audit' | '/outbound';
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
];

export default function HomeScreen() {
  const { user, logout } = useAuth();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>Xin chào, {user?.username}</Text>
            <Text style={styles.role}>Vai trò: {user?.roles.join(', ')}</Text>
          </View>
          <Pressable style={styles.logoutButton} onPress={logout} hitSlop={8}>
            <Text style={styles.logout}>Đăng xuất</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>Chức năng</Text>

        <View style={styles.list}>
          {FEATURES.map((feature) => (
            <Pressable
              key={feature.key}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => router.push(feature.href)}
            >
              <View style={[styles.iconTile, { backgroundColor: feature.tintSoft }]}>
                <Text style={[styles.iconTileText, { color: feature.tint }]}>{feature.tag}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{feature.title}</Text>
                <Text style={styles.cardSubtitle}>{feature.subtitle}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  headerText: {
    flex: 1,
    marginRight: spacing.md,
  },
  greeting: {
    ...typography.h2,
  },
  role: {
    ...typography.caption,
    marginTop: 2,
  },
  logoutButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  logout: {
    color: colors.danger,
    fontWeight: '600',
    fontSize: 14,
  },
  sectionLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.md,
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
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  iconTileText: {
    fontSize: 14,
    fontWeight: '700',
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
