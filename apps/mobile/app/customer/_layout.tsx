import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, customerTheme } from '../../src/design-system';

const { colors } = customerTheme;

/** The reader area: light reading-room theme for every screen below. */
export default function CustomerLayout() {
  return (
    <ThemeProvider name="customer">
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </ThemeProvider>
  );
}
