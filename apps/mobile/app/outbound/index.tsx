import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../../src/auth/auth-context';
import { SESSION_SCAN_CAP, loadSessions, successCount, type OutboundSession } from '../../src/lib/outboundSession';
import {
  EmptyState, ListGroup, ListRow, PressableScale, Screen, ScreenHeader, SectionHeader, Skeleton, fontFamily, radii, space, useTheme, type IconName,
} from '../../src/design-system';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function StartTile({ icon, title, caption, onPress }: { icon: IconName; title: string; caption: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${caption}`}
      style={{ flex: 1, minHeight: 132, padding: space.lg, gap: space.sm, borderRadius: radii.md, backgroundColor: colors.inkField, justifyContent: 'space-between' }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' }}>
        <Ionicons name={icon} size={24} color={colors.onInk} />
      </View>
      <View style={{ gap: 2 }}>
        <Text style={{ fontFamily: fontFamily.semibold, fontSize: 17, color: colors.onInk }}>{title}</Text>
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13.5, lineHeight: 19, color: colors.onInkMuted }}>{caption}</Text>
      </View>
    </PressableScale>
  );
}

function sessionStatusLabel(session: OutboundSession): string {
  if (!session.ended_at) return 'Đang thực hiện';
  if (session.interrupted) return 'Bị gián đoạn';
  return successCount(session) >= SESSION_SCAN_CAP ? 'Hoàn tất (đủ 50)' : 'Đã kết thúc';
}

export default function OutboundHomeScreen() {
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous';
  const [sessions, setSessions] = useState<OutboundSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { colors } = useTheme();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setIsLoading(true);
      loadSessions(userId)
        .then((data) => {
          if (!cancelled) setSessions(data);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [userId]),
  );

  return (
    <>
      <ScreenHeader title="Xuất kho" />
      <Screen>
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <StartTile icon="cube-outline" title="Xuất kho" caption="Quét đơn xuất kho" onPress={() => router.push('/outbound/scan/outbound')} />
          <StartTile icon="swap-horizontal" title="Điều chuyển kho" caption="Quét kiện điều chuyển" onPress={() => router.push('/outbound/scan/transfer')} />
        </View>

        <View style={{ gap: space.md }}>
          <SectionHeader
            title="Phiên quét trên máy này"
            caption="Chỉ là nhật ký quét của bạn trên máy này. Trạng thái xuất kho chính thức của từng đơn nằm trên hệ thống."
          />
          {isLoading ? (
            <View style={{ gap: space.sm }} accessibilityLabel="Đang tải lịch sử">
              {[0, 1].map((i) => <Skeleton key={i} height={64} radius={radii.md} />)}
            </View>
          ) : sessions.length === 0 ? (
            <EmptyState icon="time-outline" title="Chưa có phiên nào" message="Bắt đầu một phiên xuất kho hoặc điều chuyển ở trên." compact />
          ) : (
            <ListGroup>
              {sessions.map((item) => {
                const finished = item.ended_at && !item.interrupted;
                return (
                  <ListRow
                    key={item.id}
                    icon={item.mode === 'outbound' ? 'cube-outline' : 'swap-horizontal'}
                    iconTone={!item.ended_at ? colors.primary : item.interrupted ? colors.warning : finished ? colors.success : undefined}
                    title={`${item.mode === 'outbound' ? 'Xuất kho' : 'Điều chuyển kho'}, ${formatDateTime(item.started_at)}`}
                    subtitle={`${sessionStatusLabel(item)}, ${successCount(item)}/${SESSION_SCAN_CAP} kiện`}
                    onPress={() => router.push(`/outbound/history/${item.id}`)}
                  />
                );
              })}
            </ListGroup>
          )}
        </View>
      </Screen>
    </>
  );
}
