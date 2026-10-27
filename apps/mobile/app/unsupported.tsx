import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../src/auth/auth-context';
import { describeRoles } from '../src/lib/roles';
import { colors, fonts, radius, spacing } from '../src/theme/loginTokens';

/**
 * Signed in, but the account has no mobile workflow (e.g. a supplier or accountant).
 * Neutral login palette: the account is neither a reader nor warehouse staff.
 */
export default function UnsupportedAccountScreen() {
  const { user, logout } = useAuth();
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.card}>
        <Ionicons name="phone-portrait-outline" size={32} color={colors.accent} />
        <Text style={styles.title} accessibilityRole="header">Tài khoản chưa dùng được trên ứng dụng</Text>
        <Text style={styles.body}>
          Tài khoản {user?.username} ({describeRoles(user?.roles ?? [])}) không có nghiệp vụ nào trên ứng dụng di động.
          Vui lòng dùng website SmartBook, hoặc liên hệ quản trị viên để được cấp quyền phù hợp.
        </Text>
        <Pressable style={styles.button} onPress={logout} accessibilityRole="button">
          <Text style={styles.buttonText}>Đăng xuất</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.paperBottom,
  },
  card: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.cardStock,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    color: colors.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.inkSoft,
    textAlign: 'center',
  },
  button: {
    marginTop: spacing.sm,
    minHeight: 48,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.accent,
  },
  buttonText: {
    fontFamily: fonts.bodySemibold,
    color: colors.onAccent,
    fontSize: 15,
  },
});
