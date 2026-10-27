import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { probeApi } from '../api/client';
import { getConnectivity, subscribeConnectivity } from '../lib/connectivity';
import { fonts, spacing } from '../theme/tokens';

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
    <View style={[styles.wrap, { paddingTop: insets.top + 4 }]} pointerEvents="box-none" accessibilityLiveRegion="polite">
      <View style={styles.banner}>
        <Ionicons name="cloud-offline-outline" size={16} color="#FFFFFF" />
        <Text style={styles.text} numberOfLines={2}>
          Mất kết nối tới máy chủ. Thao tác ghi dữ liệu sẽ không tự gửi lại.
        </Text>
        <Pressable onPress={handleRetry} hitSlop={8} style={styles.retry} accessibilityRole="button" accessibilityLabel="Kiểm tra lại kết nối">
          <Text style={styles.retryText}>{checking ? 'Đang thử…' : 'Thử lại'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    zIndex: 1000,
    elevation: 1000,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    backgroundColor: '#3A2A12',
    borderWidth: 1,
    borderColor: '#B5791A',
  },
  text: {
    flex: 1,
    color: '#FFFFFF',
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
  },
  retry: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  retryText: {
    color: '#F2C14E',
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
  },
});
