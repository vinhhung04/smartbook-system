import * as Haptics from 'expo-haptics';

// expo-haptics throws on platforms without a haptics engine (e.g. web) — swallow
// so a scan confirmation never fails just because feedback isn't available.
export function notifyScanSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function notifyScanError() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}
