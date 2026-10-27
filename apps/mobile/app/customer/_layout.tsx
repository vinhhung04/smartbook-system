import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { colors } from '../../src/theme/customerTokens';

export default function CustomerLayout() {
  return (
    <>
      {/* Dark customer theme: light status-bar icons, or they vanish on the black background. */}
      <StatusBar style="light" />
      <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
      />
    </>
  );
}
