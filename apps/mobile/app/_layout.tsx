import 'react-native-gesture-handler';

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts as useBeVietnamPro,
  BeVietnamPro_400Regular,
  BeVietnamPro_500Medium,
  BeVietnamPro_600SemiBold,
  BeVietnamPro_700Bold,
} from '@expo-google-fonts/be-vietnam-pro';
import { useFonts as useFraunces, Fraunces_600SemiBold, Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import {
  useFonts as useRobotoMono,
  RobotoMono_400Regular,
  RobotoMono_700Bold,
} from '@expo-google-fonts/roboto-mono';

import { AuthProvider, useAuth } from '../src/auth/auth-context';
import { resolveAppArea } from '../src/auth/access';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { ThemeProvider, brand, loginTheme, staffTheme } from '../src/design-system';

function RootNavigation() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const top = segments[0] as string | undefined;
    const onLoginScreen = top === 'login';

    if (!user) {
      if (!onLoginScreen) router.replace('/login');
      return;
    }

    // Area comes from real roles/permissions (auth/access.ts), not "CUSTOMER vs anyone
    // else": a supplier account used to land on the staff dashboard where every call 403s.
    const area = resolveAppArea(user);
    const home = area === 'customer' ? '/customer' : area === 'staff' ? '/' : '/unsupported';
    const inCustomerArea = top === 'customer';
    const onUnsupported = top === 'unsupported';

    if (onLoginScreen) {
      router.replace(home);
    } else if (area === 'customer' && !inCustomerArea) {
      // Warehouse-staff routes assume staff permissions a customer JWT doesn't
      // have — keep customer sessions confined to /customer even on a deep link.
      router.replace('/customer');
    } else if (area === 'staff' && (inCustomerArea || onUnsupported)) {
      router.replace('/');
    } else if (area === 'unsupported' && !onUnsupported) {
      router.replace('/unsupported');
    }
  }, [isLoading, user, segments, router]);

  if (isLoading) {
    // Role isn't known yet at this point (same moment login.tsx has to stay
    // neutral for) — use the neutral login palette, not staff green.
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: loginTheme.colors.bg }}>
        <ActivityIndicator color={brand.ink} />
      </View>
    );
  }

  return (
    // Staff is the default area theme; customer/_layout and the entry screens provide their own.
    <ThemeProvider name="staff">
    {/* Staff and login screens are light; the customer area overrides this (customer/_layout). */}
    <StatusBar style="dark" />
    <Stack
      screenOptions={{
        headerShown: false,
        headerStyle: { backgroundColor: staffTheme.colors.bg },
        headerTintColor: staffTheme.colors.textPrimary,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: staffTheme.colors.bg },
      }}
    />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // Every family here carries the full Vietnamese set (Sora, the old display face, did not).
  const [sansLoaded] = useBeVietnamPro({ BeVietnamPro_400Regular, BeVietnamPro_500Medium, BeVietnamPro_600SemiBold, BeVietnamPro_700Bold });
  const [serifLoaded] = useFraunces({ Fraunces_600SemiBold, Fraunces_700Bold });
  const [robotoMonoLoaded] = useRobotoMono({ RobotoMono_400Regular, RobotoMono_700Bold });

  if (!sansLoaded || !serifLoaded || !robotoMonoLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: loginTheme.colors.bg }}>
        <ActivityIndicator color={brand.ink} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <RootNavigation />
          <OfflineBanner />
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
