import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import * as customerProfileApi from '../../../src/api/customerProfile';
import { ApiError, useAuth } from '../../../src/auth/auth-context';
import { useUnreadNotifications } from '../../../src/hooks/useUnreadNotifications';
import { formatVnd, toMoney } from '../../../src/lib/money';
import { useCustomerTabBarSpace } from '../../../src/hooks/useCustomerTabBarSpace';
import { colors, fonts, radius, shadow, spacing, typography } from '../../../src/theme/customerTokens';
import type { CustomerProfile, MembershipInfo } from '../../../src/types/customerProfile';

type IconName = keyof typeof Ionicons.glyphMap;

export default function CustomerProfileScreen() {
  const tabBarSpace = useCustomerTabBarSpace();
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [membershipMissing, setMembershipMissing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { count: unreadCount, refresh: refreshUnread } = useUnreadNotifications();

  const load = useCallback(async () => {
    setError(null);
    // A reader without an active plan gets 404 from /my/membership — the profile still shows.
    const [profileResult, membershipResult] = await Promise.allSettled([
      customerProfileApi.getMyProfile(),
      customerProfileApi.getMyMembership(),
    ]);
    if (profileResult.status === 'fulfilled') setProfile(profileResult.value.data);
    else setError(profileResult.reason instanceof ApiError ? profileResult.reason.message : 'Không tải được thông tin tài khoản');
    if (membershipResult.status === 'fulfilled') {
      setMembership(membershipResult.value.data);
      setMembershipMissing(false);
    } else {
      setMembership(null);
      setMembershipMissing(membershipResult.reason instanceof ApiError && membershipResult.reason.status === 404);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      void refreshUnread();
      load().finally(() => setIsLoading(false));
    }, [load, refreshUnread]),
  );

  function confirmLogout() {
    Alert.alert('Đăng xuất?', 'Bạn sẽ cần đăng nhập lại để xem sách đang mượn và phiếu đặt.', [
      { text: 'Ở lại', style: 'cancel' },
      { text: 'Đăng xuất', style: 'destructive', onPress: () => void logout() },
    ]);
  }

  const name = profile?.full_name ?? user?.username ?? '';
  const outstanding = membership ? toMoney(membership.outstanding_fine_balance) : profile ? toMoney(profile.total_fine_balance) : 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace }]}>
        <Text style={styles.title} accessibilityRole="header">Cá nhân</Text>

        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.trim().split(/\s+/).slice(-1)[0]?.slice(0, 2).toUpperCase() || '?'}</Text>
          </View>
          <Text style={styles.username}>{name}</Text>
          <Text style={styles.roles}>THẺ THƯ VIỆN · {profile?.customer_code ?? '—'}</Text>
          <Text style={styles.email}>{profile?.email ?? user?.email}</Text>
          {profile?.phone ? <Text style={styles.email}>{profile.phone}</Text> : null}
          {profile ? (
            <Pressable style={styles.editButton} onPress={() => router.push('/customer/profile-edit')} accessibilityRole="button">
              <Ionicons name="create-outline" size={16} color={colors.primary} />
              <Text style={styles.editText}>Sửa thông tin</Text>
            </Pressable>
          ) : null}
        </View>

        {isLoading && !profile ? (
          <ActivityIndicator color={colors.primary} style={styles.spinner} />
        ) : error ? (
          <Pressable onPress={() => void load()} accessibilityRole="button">
            <Text style={styles.error}>{error} · Thử lại</Text>
          </Pressable>
        ) : null}

        {membership ? (
          <View style={styles.membershipCard}>
            <Text style={styles.sectionLabel}>Gói thành viên</Text>
            <Text style={styles.membershipPlan}>{membership.plan_name}</Text>
            <View style={styles.membershipRow}>
              <MetaTile label="Đang mượn" value={`${membership.active_loan_count}/${membership.limits.max_active_loans}`} />
              <MetaTile label="Còn mượn thêm" value={String(membership.remaining_loan_slots)} />
              <MetaTile label="Số ngày mượn" value={`${membership.limits.max_loan_days}`} />
            </View>
            <Text style={styles.membershipNote}>
              Gia hạn tối đa {membership.limits.max_renewal_count} lần · giữ sách đặt trước {membership.limits.reservation_hold_hours} giờ
            </Text>
          </View>
        ) : membershipMissing ? (
          <View style={styles.membershipCard}>
            <Text style={styles.sectionLabel}>Gói thành viên</Text>
            <Text style={styles.membershipNote}>Bạn chưa có gói thành viên đang hoạt động. Liên hệ quầy thư viện để đăng ký.</Text>
          </View>
        ) : null}

        <View style={styles.menu}>
          <MenuRow icon="heart-outline" label="Sách đã lưu" onPress={() => router.push('/customer/saved')} />
          <MenuRow
            icon="notifications-outline"
            label="Thông báo"
            badge={unreadCount > 0 ? String(unreadCount) : undefined}
            onPress={() => router.push('/customer/notifications')}
          />
          <MenuRow
            icon="wallet-outline"
            label="Ví & phí phạt"
            detail={outstanding > 0 ? `Còn ${formatVnd(outstanding)}` : 'Không có khoản nợ'}
            onPress={() => router.push('/customer/wallet')}
          />
          <MenuRow icon="chatbubbles-outline" label="Trợ lý tìm sách" onPress={() => router.push('/customer/assistant')} />
        </View>

        <Pressable style={({ pressed }) => [styles.logoutButton, pressed && styles.logoutPressed]} onPress={confirmLogout} accessibilityRole="button">
          <Text style={styles.logoutText}>Đăng xuất</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function MenuRow({ icon, label, detail, badge, onPress }: { icon: IconName; label: string; detail?: string; badge?: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.menuRow, pressed && styles.logoutPressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={[label, detail, badge ? `${badge} chưa đọc` : null].filter(Boolean).join(', ')}>
      <Ionicons name={icon} size={20} color={colors.textPrimary} />
      <View style={styles.menuBody}>
        <Text style={styles.menuLabel}>{label}</Text>
        {detail ? <Text style={styles.menuDetail}>{detail}</Text> : null}
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
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
  safeArea: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  title: { ...typography.h2 },
  card: {
    alignItems: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: 2,
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
  avatarText: { fontFamily: fonts.displayBold, fontSize: 22, color: colors.primary },
  username: { ...typography.h3, textAlign: 'center' },
  roles: { ...typography.label, marginTop: spacing.xs, color: colors.primary },
  email: { ...typography.caption },
  editButton: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  editText: { fontFamily: fonts.bodySemibold, color: colors.primary },
  spinner: { marginVertical: spacing.lg },
  error: { color: colors.danger, fontWeight: '600', textAlign: 'center' },
  sectionLabel: { ...typography.label },
  membershipCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, gap: spacing.sm, ...shadow.card },
  membershipPlan: { ...typography.h3, color: colors.primary },
  membershipRow: { flexDirection: 'row', gap: spacing.sm },
  membershipNote: { ...typography.caption },
  metaTile: { flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bgElevated, alignItems: 'center' },
  metaTileValue: { ...typography.h3 },
  metaTileLabel: { ...typography.caption, fontSize: 11, textAlign: 'center' },
  menu: { borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuBody: { flex: 1, paddingVertical: spacing.sm },
  menuLabel: { ...typography.bodyBold, fontSize: 15 },
  menuDetail: { ...typography.caption, fontSize: 12 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#FFFFFF', fontFamily: fonts.bodySemibold, fontSize: 11 },
  logoutButton: {
    borderRadius: radius.pill,
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSoft,
  },
  logoutPressed: { opacity: 0.8 },
  logoutText: { fontFamily: fonts.bodySemibold, color: colors.danger, fontSize: 15 },
});
