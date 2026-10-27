import { useSafeAreaInsets } from 'react-native-safe-area-context';

const BAR_HEIGHT = 68;
const BAR_GAP = 8;
const BREATHING_ROOM = 24;

/**
 * Bottom padding for scroll content under the customer app's floating tab bar
 * (app/customer/(tabs)/_layout.tsx: bottom = max(inset, 12) + 8, height 68), so the
 * last row is never hidden behind the bar on gesture-navigation phones.
 */
export function useCustomerTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, 12) + BAR_GAP + BAR_HEIGHT + BREATHING_ROOM;
}
