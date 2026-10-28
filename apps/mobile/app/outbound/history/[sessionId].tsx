import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { FlatList, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../../../src/auth/auth-context';
import { getSessionById, successCount, SESSION_SCAN_CAP, type OutboundSession } from '../../../src/lib/outboundSession';
import { EmptyState, ErrorState, LoadingState, ProgressBar, ScreenHeader, Screen, fontFamily, radii, space, useTheme } from '../../../src/design-system';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function OutboundSessionHistoryScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { user } = useAuth();
  const userId = user?.id ?? 'anonymous';
  const [session, setSession] = useState<OutboundSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { colors, type } = useTheme();

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setIsLoading(true);
      getSessionById(userId, sessionId)
        .then((data) => {
          if (!cancelled) setSession(data);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [userId, sessionId]),
  );

  if (isLoading) {
    return (<><ScreenHeader title="Phiên quét" /><Screen scroll={false}><LoadingState /></Screen></>);
  }

  if (!session) {
    return (<><ScreenHeader title="Phiên quét" /><Screen scroll={false}><ErrorState title="Không tìm thấy phiên này" /></Screen></>);
  }

  const ok = successCount(session);

  return (
    <>
      <ScreenHeader title={session.mode === 'outbound' ? 'Xuất kho' : 'Điều chuyển kho'} />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <FlatList
          data={[...session.attempts].reverse()}
          keyExtractor={(_, index) => String(index)}
          contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.sm }}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={
            <View style={{ gap: space.sm, marginBottom: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
                <Text style={{ fontFamily: fontFamily.bold, fontSize: 34, color: colors.textPrimary, fontVariant: ['tabular-nums'] }}>{ok}</Text>
                <Text style={type.body}>/{SESSION_SCAN_CAP} kiện thành công, {session.attempts.length} lượt quét</Text>
              </View>
              <ProgressBar value={ok / SESSION_SCAN_CAP} tone={ok >= SESSION_SCAN_CAP ? 'success' : 'primary'} accessibilityLabel="Số kiện thành công" />
              <Text style={type.caption}>
                Bắt đầu {formatDateTime(session.started_at)}
                {session.ended_at
                  ? `, ${session.interrupted ? 'gián đoạn' : 'kết thúc'} ${formatDateTime(session.ended_at)}`
                  : ', đang thực hiện'}
              </Text>
            </View>
          }
          ListEmptyComponent={<EmptyState icon="scan-outline" title="Phiên này chưa quét kiện nào" compact />}
          renderItem={({ item }) => (
            <View
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md, borderRadius: radii.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
              accessible
              accessibilityLabel={`${item.success ? 'Thành công' : 'Lỗi'}, mã ${item.code}, ${item.message}`}
            >
              <Ionicons name={item.success ? 'checkmark-circle' : 'close-circle'} size={22} color={item.success ? colors.success : colors.danger} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text selectable style={{ fontFamily: fontFamily.monoBold, fontSize: 15, color: colors.textPrimary }}>{item.code}</Text>
                <Text style={type.caption}>{item.message}</Text>
              </View>
              <Text style={{ fontFamily: fontFamily.mono, fontSize: 13, color: colors.textMuted }}>
                {new Date(item.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          )}
        />
      </View>
    </>
  );
}
