import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Alert, Text, View } from 'react-native';

import * as customerProfileApi from '../../../src/api/customerProfile';
import { ApiError, useAuth } from '../../../src/auth/auth-context';
import { useUnreadNotifications } from '../../../src/hooks/useUnreadNotifications';
import { formatVnd, toMoney } from '../../../src/lib/money';
import {
  Avatar, Button, Card, InlineAlert, ListGroup, ListRow, PageTitle, Screen, Skeleton, StatusBadge, fontFamily, radii, space, useTheme,
} from '../../../src/design-system';
import type { CustomerProfile, MembershipInfo } from '../../../src/types/customerProfile';

export default function CustomerProfileScreen() {
  const { user, logout } = useAuth();
  const { colors, type } = useTheme();
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
    <Screen safeTop onRefresh={() => void load()} refreshing={false}>
      <PageTitle title="Cá nhân" />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          <Avatar name={name} size={60} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={type.heading} numberOfLines={2}>{name || 'Bạn đọc'}</Text>
            <Text style={type.caption} numberOfLines={1}>{profile?.email ?? user?.email}</Text>
            {profile?.phone ? <Text style={type.caption}>{profile.phone}</Text> : null}
          </View>
        </View>
        {/* The library card number: what the counter asks for. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md, padding: space.md, borderRadius: radii.md, backgroundColor: colors.surfaceRaised }}>
          <Text style={type.caption}>Mã thẻ thư viện</Text>
          <Text selectable style={{ fontFamily: fontFamily.monoBold, fontSize: 15, color: colors.textPrimary, letterSpacing: 0.5 }}>{profile?.customer_code ?? '—'}</Text>
        </View>
        {profile ? <Button label="Sửa thông tin" icon="create-outline" variant="secondary" size="md" onPress={() => router.push('/customer/profile-edit')} /> : null}
      </Card>

      {isLoading && !profile ? (
        <Skeleton height={150} radius={radii.lg} />
      ) : error ? (
        <InlineAlert message={error} actionLabel="Thử lại" onAction={() => void load()} />
      ) : null}

      {membership ? (
        <View style={{ padding: space.xl, gap: space.lg, borderRadius: radii.xl, borderCurve: 'continuous', backgroundColor: colors.inkField }}>
          <View style={{ gap: 2 }}>
            <Text style={{ fontFamily: fontFamily.medium, fontSize: 13.5, color: colors.onInkMuted }}>Gói thành viên</Text>
            <Text style={{ fontFamily: fontFamily.serif, fontSize: 24, lineHeight: 29, color: colors.onInk }}>{membership.plan_name}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <MetaTile label="Đang mượn" value={`${membership.active_loan_count}/${membership.limits.max_active_loans}`} />
            <MetaTile label="Còn mượn thêm" value={String(membership.remaining_loan_slots)} />
            <MetaTile label="Ngày mượn" value={`${membership.limits.max_loan_days}`} />
          </View>
          <Text style={{ fontFamily: fontFamily.regular, fontSize: 13.5, lineHeight: 19, color: colors.onInkMuted }}>
            Gia hạn tối đa {membership.limits.max_renewal_count} lần, giữ sách đặt trước {membership.limits.reservation_hold_hours} giờ.
          </Text>
        </View>
      ) : membershipMissing ? (
        <InlineAlert tone="info" title="Chưa có gói thành viên" message="Bạn chưa có gói thành viên đang hoạt động. Liên hệ quầy thư viện để đăng ký." />
      ) : null}

      <ListGroup>
        <ListRow icon="heart-outline" title="Sách đã lưu" onPress={() => router.push('/customer/saved')} />
        <ListRow
          icon="notifications-outline"
          title="Thông báo"
          trailing={unreadCount > 0 ? <StatusBadge tone="danger" label={`${unreadCount} mới`} icon={null} /> : null}
          onPress={() => router.push('/customer/notifications')}
        />
        <ListRow
          icon="wallet-outline"
          title="Ví & phí phạt"
          subtitle={outstanding > 0 ? `Còn ${formatVnd(outstanding)} chưa thanh toán` : 'Không có khoản nợ'}
          onPress={() => router.push('/customer/wallet')}
        />
        <ListRow icon="sparkles-outline" title="Trợ lý tìm sách" subtitle="Mô tả cuốn sách bạn muốn đọc" onPress={() => router.push('/customer/assistant')} />
      </ListGroup>

      <ListGroup>
        <ListRow icon="log-out-outline" title="Đăng xuất" destructive onPress={confirmLogout} />
      </ListGroup>
    </Screen>
  );
}

function MetaTile({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, padding: space.md, gap: 2, borderRadius: radii.md, backgroundColor: 'rgba(255,255,255,0.08)' }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={{ fontFamily: fontFamily.bold, fontSize: 22, color: colors.onInk, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ fontFamily: fontFamily.regular, fontSize: 12.5, color: colors.onInkMuted }}>{label}</Text>
    </View>
  );
}
