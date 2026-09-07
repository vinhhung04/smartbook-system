import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';

import { useAuth } from '../../src/auth/auth-context';
import { colors, fonts, radius, shadow, spacing, typography } from '../../src/theme/tokens';

export default function ProfileScreen() {
  const { user, logout } = useAuth();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Cá nhân</Text>
      </View>

      <MotiView
        from={{ opacity: 0, translateY: 8 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 260 }}
        style={styles.card}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.username?.slice(0, 2).toUpperCase()}</Text>
        </View>
        <Text style={styles.username}>{user?.username}</Text>
        <Text style={styles.roles}>{user?.roles.join(', ')}</Text>
        <Text style={styles.email}>{user?.email}</Text>
      </MotiView>

      <Pressable style={({ pressed }) => [styles.logoutButton, pressed && styles.logoutPressed]} onPress={logout}>
        <Text style={styles.logoutText}>Đăng xuất</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  header: {
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.h2,
  },
  card: {
    alignItems: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    marginBottom: spacing.xl,
    ...shadow.card,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: colors.primary,
  },
  username: {
    ...typography.h3,
  },
  roles: {
    ...typography.label,
    marginTop: spacing.xs,
  },
  email: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  logoutButton: {
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSoft,
  },
  logoutPressed: {
    opacity: 0.8,
  },
  logoutText: {
    fontFamily: fonts.bodySemibold,
    color: colors.danger,
    fontSize: 15,
  },
});
