import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { probeApi } from '../api/client';
import { getConnectivity, subscribeConnectivity } from '../lib/connectivity';
import { brand, fontFamily, radii, space } from '../design-system';

const AUTO_PROBE_MS = 15000;

/**
 * Shown on every screen while the SmartBook server cannot be reached. Reads can be
 * retried freely; writes are never re-sent automatically (see api/client.ts) — this
 * banner only tells the user why things are failing and checks when it is back.
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [online, setOnline] = useState(getConnectivity().online);
  const [checking, setChecking] = useState(false);

  useEffect(() => subscribeConnectivity((state) => setOnline(state.online)), []);

  useEffect(() => {
    if (online) return;
    const timer = setInterval(() => void probeApi(), AUTO_PROBE_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void probeApi();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [online]);

  if (online) return null;

  async function handleRetry() {
    if (checking) return;
    setChecking(true);
    try {
      await probeApi();
    } finally {
      setChecking(false);
    }
  }

  return (
    <View
      style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 4, paddingHorizontal: space.md, zIndex: 1000, elevation: 1000 }}
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
    >
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, paddingLeft: space.md, paddingRight: space.xs,
          borderRadius: radii.md, borderCurve: 'continuous', backgroundColor: brand.inkDeep, boxShadow: '0 6px 18px rgba(20, 18, 58, 0.28)',
        }}
      >
        <Ionicons name="cloud-offline-outline" size={18} color={brand.lamp} />
        <Text style={{ flex: 1, color: '#FFFFFF', fontFamily: fontFamily.medium, fontSize: 13.5, lineHeight: 19 }} numberOfLines={2}>
          Mất kết nối tới máy chủ. Thao tác ghi dữ liệu sẽ không tự gửi lại.
        </Text>
        <Pressable
          onPress={handleRetry}
          hitSlop={4}
          style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radii.sm, backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'transparent' })}
          accessibilityRole="button"
          accessibilityLabel="Kiểm tra lại kết nối"
          accessibilityState={{ busy: checking }}
        >
          <Text style={{ color: brand.lamp, fontFamily: fontFamily.semibold, fontSize: 14 }}>{checking ? 'Đang thử…' : 'Thử lại'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
