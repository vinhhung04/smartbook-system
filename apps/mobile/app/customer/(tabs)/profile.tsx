import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MotiView } from 'moti';

import * as customerProfileApi from '../../../src/api/customerProfile';
import { ApiError, useAuth } from '../../../src/auth/auth-context';
import { colors, fonts, radius, shadow, spacing, typography } from '../../../src/theme/customerTokens';
import type { CustomerProfile, MembershipInfo } from '../../../src/types/customerProfile';

export default function CustomerProfileScreen() {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [profileResult, membershipResult] = await Promise.all([
        customerProfileApi.getMyProfile(),
        customerProfileApi.getMyMembership(),
      ]);
      setProfile(profileResult.data);
      setMembership(membershipResult.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tải được thông tin tài khoản');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load().finally(() => setIsLoading(false));
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Cá nhân</Text>

        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 260 }}
          style={styles.card}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user?.username?.slice(0, 2).toUpperCase()}</Text>
          </View>
          <Text style={styles.username}>{profile?.full_name ?? user?.username}</Text>
          <Text style={styles.roles}>THẺ THƯ VIỆN · {profile?.customer_code ?? '—'}</Text>
          <Text style={styles.email}>{profile?.email ?? user?.email}</Text>
        </MotiView>

        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.spinner} />
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : membership ? (
          <View style={styles.membershipCard}>
            <Text style={styles.membershipPlan}>{membership.plan_name}</Text>
            <View style={styles.membershipRow}>
              <MetaTile label="Đang mượn" value={`${membership.active_loan_count}/${membership.limits.max_active_loans}`} />
              <MetaTile label="Còn lại" value={String(membership.remaining_loan_slots)} />
              <MetaTile label="Ngày mượn tối đa" value={`${membership.limits.max_loan_days}`} />
            </View>
          </View>
        ) : null}

        <Pressable style={({ pressed }) => [styles.logoutButton, pressed && styles.logoutPressed]} onPress={logout}>
          <Text style={styles.logoutText}>Đăng xuất</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaTile}>
      <Text style={styles.metaTileValue}>{value}</Text>
      <Text style={styles.metaTileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 120,
  },
  title: {
    ...typography.h2,
    marginBottom: spacing.lg,
  },
  card: {
    alignItems: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
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
    ...shadow.glow,
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
  spinner: {
    marginBottom: spacing.lg,
  },
  error: {
    color: colors.danger,
    marginBottom: spacing.lg,
  },
  membershipCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
    ...shadow.card,
  },
  membershipPlan: {
    ...typography.bodyBold,
    marginBottom: spacing.md,
  },
  membershipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metaTile: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
  },
  metaTileValue: {
    fontFamily: fonts.monoSemibold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  metaTileLabel: {
    ...typography.caption,
    fontSize: 11,
    marginTop: 2,
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
