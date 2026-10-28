import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { fontFamily, staffTheme } from '../../src/design-system';

const { colors } = staffTheme;

/**
 * Staff tabs on the platform's own tab bar (Material 3 on Android, the system
 * bar on iOS): native safe areas, no overlap, no custom bar to keep in sync.
 * Four destinations only; every workflow is reached from Home or Scan. Tab
 * switches are not animated (they happen dozens of times a shift).
 * Ionicons via VectorIcon: the Material-symbol `md` icons need expo-symbols,
 * which this app does not ship.
 */
export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor={colors.primary}
      iconColor={{ default: colors.textMuted, selected: colors.primary }}
      labelStyle={{ default: { fontFamily: fontFamily.medium, fontSize: 11.5, color: colors.textSecondary }, selected: { fontFamily: fontFamily.semibold, fontSize: 11.5, color: colors.primary } }}
      backgroundColor={colors.surface}
      indicatorColor={colors.primarySoft}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.VectorIcon family={Ionicons} name="home" />
        <NativeTabs.Trigger.Label>Trang chủ</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks">
        <NativeTabs.Trigger.VectorIcon family={Ionicons} name="clipboard" />
        <NativeTabs.Trigger.Label>Việc của tôi</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="scan">
        <NativeTabs.Trigger.VectorIcon family={Ionicons} name="scan" />
        <NativeTabs.Trigger.Label>Quét</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.VectorIcon family={Ionicons} name="person-circle" />
        <NativeTabs.Trigger.Label>Cá nhân</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
