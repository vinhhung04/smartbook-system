import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { QuickLookupPanel } from '../../src/components/QuickLookupPanel';
import { colors, spacing, typography } from '../../src/theme/tokens';

export default function ScanTabScreen() {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Quét</Text>
        <Text style={styles.subtitle}>Quét mã để tra cứu sách, tồn kho, vị trí</Text>
      </View>
      <QuickLookupPanel />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  title: {
    ...typography.h2,
  },
  subtitle: {
    ...typography.caption,
    marginTop: 2,
  },
});
