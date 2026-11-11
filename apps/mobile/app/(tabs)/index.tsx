import { router } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../../src/auth/auth-context';
import { canUseStaffFeature, type StaffFeature } from '../../src/auth/access';
import { TaskCard } from '../../src/components/TaskCard';
import { useDashboardTasks, type FeatureCounts, type TaskEntry } from '../../src/hooks/useDashboardTasks';
import { describeRoles, greetingFor } from '../../src/lib/roles';
import {
  Button, EmptyState, InlineAlert, ListGroup, ListRow, Screen, SectionHeader, Skeleton, fontFamily, radii, space, useTheme, type IconName,
} from '../../src/design-system';

type Feature = {
  key: StaffFeature;
  countKey?: keyof FeatureCounts;
  title: string;
  subtitle: string;
  icon: IconName;
  href: string;
};

// Every workflow the app has; each account sees only those its permissions allow.
const FEATURES: Feature[] = [
  { key: 'picking', countKey: 'picking', title: 'Lấy hàng', subtitle: 'Nhận phiếu và lấy sách theo vị trí', icon: 'basket-outline', href: '/picking' },
  { key: 'putaway', countKey: 'putaway', title: 'Cất hàng lên kệ', subtitle: 'Từ khu chờ lên đúng vị trí', icon: 'file-tray-stacked-outline', href: '/putaway' },
  { key: 'outbound', countKey: 'outbound', title: 'Xuất kho', subtitle: 'Quét mã đơn trên kiện để xác nhận', icon: 'car-outline', href: '/outbound' },
  { key: 'transferReceiving', countKey: 'transferReceiving', title: 'Nhận điều chuyển', subtitle: 'Xác nhận hàng chuyển tới kho', icon: 'swap-horizontal-outline', href: '/transfer-receiving' },
  { key: 'audit', countKey: 'audit', title: 'Kiểm kê', subtitle: 'Đếm và đối chiếu tồn kho thực tế', icon: 'checkbox-outline', href: '/audit' },
  { key: 'exceptions', countKey: 'exceptions', title: 'Báo cáo sự cố', subtitle: 'Thiếu, dư, hư hỏng, kèm ảnh', icon: 'warning-outline', href: '/exceptions' },
  { key: 'lookup', title: 'Tra cứu nhanh', subtitle: 'Sách, tồn kho và vị trí theo mã', icon: 'search-outline', href: '/lookup' },
];

function Count({ label, value, tone, icon }: { label: string; value: number; tone: string; icon: IconName }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, gap: 4 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Ionicons name={icon} size={15} color={tone} />
        <Text style={{ fontFamily: fontFamily.medium, fontSize: 13, color: colors.textSecondary }} numberOfLines={1}>{label}</Text>
      </View>
      <Text style={{ fontFamily: fontFamily.bold, fontSize: 32, lineHeight: 36, color: colors.textPrimary, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

export default function HomeDashboardScreen() {
  const { colors, type } = useTheme();
  const { user } = useAuth();
  const { data, isLoading, isRefreshing, error, refetch } = useDashboardTasks();
  const features = FEATURES.filter((feature) => canUseStaffFeature(user, feature.key));
  const name = user?.full_name || user?.username || '';
  const canScan = canUseStaffFeature(user, 'lookup');

  function openTask(entry: TaskEntry) {
    if (entry.route.kind === 'screen') router.push(entry.route.href as never);
    else Alert.alert(entry.task.title, entry.route.reason);
  }

  return (
    <Screen safeTop onRefresh={refetch} refreshing={isRefreshing}>
      <View style={{ gap: 4 }}>
        <Text style={type.caption}>{greetingFor(new Date())},</Text>
        <Text style={type.display} numberOfLines={1} accessibilityRole="header">{name}</Text>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.primary }}>{describeRoles(user?.roles ?? [])}</Text>
      </View>

      {/* Today's load: three numbers, nothing decorative around them. */}
      <View style={{ padding: space.lg, gap: space.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
        <Text style={type.heading}>Ca làm việc</Text>
        {error ? (
          <InlineAlert message={error} actionLabel="Thử lại" onAction={() => void refetch()} />
        ) : isLoading && data.entries.length === 0 ? (
          <Skeleton height={56} />
        ) : (
          <View style={{ flexDirection: 'row', gap: space.md }}>
            <Count label="Cần làm" value={data.counts.todo} tone={colors.primary} icon="ellipse-outline" />
            <Count label="Đang làm" value={data.counts.in_progress} tone={colors.warning} icon="time-outline" />
            <Count label="Xong gần đây" value={data.counts.done} tone={colors.success} icon="checkmark-circle" />
          </View>
        )}
        {!error && data.counts.waiting > 0 ? (
          <Text style={type.caption}>Thêm {data.counts.waiting} việc đang chờ quản lý duyệt hoặc xử lý.</Text>
        ) : null}
      </View>
      {data.warnings.map((warning) => <InlineAlert key={warning} tone="warning" message={warning} />)}

      <View style={{ gap: space.md }}>
        <SectionHeader title="Việc tiếp theo" actionLabel={data.entries.length > 1 ? 'Tất cả việc' : undefined} onAction={() => router.push('/tasks')} />
        {isLoading && data.entries.length === 0 ? (
          <Skeleton height={150} radius={radii.md} />
        ) : data.next ? (
          <TaskCard entry={data.next} onOpen={openTask} />
        ) : !error ? (
          <EmptyState icon="checkmark-done-outline" title="Không có việc nào đang chờ" message="Khi quản lý giao việc, việc đó sẽ hiện ở đây." compact />
        ) : null}
      </View>

      {canScan ? <Button label="Quét mã" icon="scan" onPress={() => router.push('/scan')} accessibilityHint="Mở máy quét mã sách, ISBN hoặc vị trí kệ" /> : null}

      <View style={{ gap: space.md }}>
        <SectionHeader title="Nghiệp vụ" />
        {features.length === 0 ? (
          <InlineAlert tone="info" message="Tài khoản chưa được cấp quyền nghiệp vụ kho nào trên ứng dụng." />
        ) : (
          <ListGroup>
            {features.map((feature) => {
              const count = feature.countKey ? data.features[feature.countKey] : undefined;
              return (
                <ListRow
                  key={feature.key}
                  icon={feature.icon}
                  title={feature.title}
                  subtitle={feature.subtitle}
                  onPress={() => router.push(feature.href as never)}
                  trailing={count ? (
                    <View style={{ minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`${count} việc`}>
                      <Text style={{ fontFamily: fontFamily.bold, fontSize: 13.5, color: colors.onPrimary }}>{count}</Text>
                    </View>
                  ) : null}
                />
              );
            })}
          </ListGroup>
        )}
      </View>
    </Screen>
  );
}
