import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { QuickLookupPanel } from '../../src/components/QuickLookupPanel';
import { PageTitle, space, useTheme } from '../../src/design-system';

/** The scan tab: one job, look up whatever code is in front of you. */
export default function ScanTabScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingTop: insets.top + space.md, paddingHorizontal: space.lg }}>
        <PageTitle title="Quét mã" subtitle="Mã sách, ISBN hoặc mã vị trí kệ: xem sách, tồn kho và vị trí." />
      </View>
      <QuickLookupPanel />
    </View>
  );
}
