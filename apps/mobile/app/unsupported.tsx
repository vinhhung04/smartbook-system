import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../src/auth/auth-context';
import { describeRoles } from '../src/lib/roles';
import { Button, InfoRow, ThemeProvider, loginTheme, radii, space } from '../src/design-system';

const { colors, type } = loginTheme;

/**
 * Signed in, but the account has no mobile workflow (e.g. a supplier or accountant).
 * The neutral entry look: the account is neither a reader nor warehouse staff,
 * and it is never sent into the staff dashboard where every request would be refused.
 */
export default function UnsupportedAccountScreen() {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  return (
    <ThemeProvider name="login">
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.xl, gap: space.xl }}>
        <View style={{ width: 56, height: 56, borderRadius: radii.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="phone-portrait-outline" size={26} color={colors.primary} />
        </View>
        <View style={{ gap: space.sm }}>
          <Text style={type.title} accessibilityRole="header">Tài khoản này chưa dùng được trên ứng dụng</Text>
          <Text style={type.body}>
            Ứng dụng di động hiện phục vụ bạn đọc và nhân viên kho. Vai trò của tài khoản này chưa có nghiệp vụ nào trên điện thoại.
          </Text>
        </View>
        <View style={{ borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.xs }}>
          <InfoRow label="Tài khoản" value={user?.username ?? '—'} />
          <InfoRow label="Vai trò" value={describeRoles(user?.roles ?? [])} />
        </View>
        <Text style={type.caption}>
          Hãy dùng website SmartBook, hoặc liên hệ quản trị viên nếu bạn cần quyền phù hợp trên điện thoại.
        </Text>
        <View style={{ flex: 1 }} />
        <Button label="Đăng xuất" icon="log-out-outline" variant="secondary" onPress={logout} />
      </View>
    </ThemeProvider>
  );
}
