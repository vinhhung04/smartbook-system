import { Alert, Text, View } from 'react-native';

import { useAuth } from '../../src/auth/auth-context';
import { canUseStaffFeature, type StaffFeature } from '../../src/auth/access';
import { describeRoles } from '../../src/lib/roles';
import { Avatar, Card, InfoRow, ListGroup, ListRow, PageTitle, Screen, SectionHeader, StatusBadge, space, useTheme } from '../../src/design-system';

// What each permission opens on this phone; the account's real permissions decide which show.
const WORKFLOWS: { key: StaffFeature; label: string }[] = [
  { key: 'tasks', label: 'Xem việc được giao' },
  { key: 'picking', label: 'Lấy hàng' },
  { key: 'putaway', label: 'Cất hàng lên kệ' },
  { key: 'outbound', label: 'Xuất kho' },
  { key: 'transferReceiving', label: 'Nhận điều chuyển' },
  { key: 'audit', label: 'Kiểm kê' },
  { key: 'exceptions', label: 'Báo cáo sự cố' },
  { key: 'lookup', label: 'Tra cứu nhanh' },
];

export default function ProfileScreen() {
  const { colors, type } = useTheme();
  const { user, logout } = useAuth();
  const allowed = WORKFLOWS.filter((workflow) => canUseStaffFeature(user, workflow.key));

  function confirmLogout() {
    Alert.alert('Đăng xuất?', 'Phiên quét đang mở (nếu có) sẽ được lưu vào lịch sử trên máy này.', [
      { text: 'Ở lại', style: 'cancel' },
      { text: 'Đăng xuất', style: 'destructive', onPress: () => void logout() },
    ]);
  }

  return (
    <Screen safeTop>
      <PageTitle title="Cá nhân" />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <Avatar name={user?.full_name || user?.username} size={60} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.heading} numberOfLines={2}>{user?.full_name || user?.username}</Text>
            <Text style={{ fontFamily: type.bodyStrong.fontFamily, fontSize: 14, color: colors.primary }}>{describeRoles(user?.roles ?? [])}</Text>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: colors.border }} />
        <InfoRow label="Tên đăng nhập" value={user?.username ?? '—'} mono />
        <InfoRow label="Email" value={user?.email ?? '—'} />
      </Card>

      <View style={{ gap: space.md }}>
        <SectionHeader title="Dùng được trên điện thoại" caption="Theo quyền hệ thống cấp cho tài khoản này." />
        {allowed.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {allowed.map((workflow) => <StatusBadge key={workflow.key} tone="success" label={workflow.label} icon="checkmark-circle" />)}
          </View>
        ) : (
          <Text style={type.caption}>Tài khoản chưa có nghiệp vụ kho nào trên ứng dụng. Liên hệ quản lý để được cấp quyền.</Text>
        )}
      </View>

      <ListGroup>
        <ListRow icon="log-out-outline" title="Đăng xuất" destructive onPress={confirmLogout} />
      </ListGroup>
    </Screen>
  );
}
