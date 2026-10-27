import 'react-native-gesture-handler';

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts as useSora, Sora_600SemiBold, Sora_700Bold } from '@expo-google-fonts/sora';
import {
  useFonts as useManrope,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
} from '@expo-google-fonts/manrope';
import {
  useFonts as useRobotoMono,
  RobotoMono_400Regular,
  RobotoMono_700Bold,
} from '@expo-google-fonts/roboto-mono';

import { AuthProvider, useAuth } from '../src/auth/auth-context';
import { resolveAppArea } from '../src/auth/access';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { OfflineBanner } from '../src/components/OfflineBanner';
import { colors } from '../src/theme/tokens';
import { colors as loginColors } from '../src/theme/loginTokens';

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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: loginColors.paperBottom }}>
        <ActivityIndicator color={loginColors.accent} />
      </View>
    );
  }

  return (
    <>
    {/* Staff and login screens are light; the customer area overrides this (customer/_layout). */}
    <StatusBar style="dark" />
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

export default function RootLayout() {
  const [soraLoaded] = useSora({ Sora_600SemiBold, Sora_700Bold });
  const [manropeLoaded] = useManrope({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold });
  const [robotoMonoLoaded] = useRobotoMono({ RobotoMono_400Regular, RobotoMono_700Bold });

  if (!soraLoaded || !manropeLoaded || !robotoMonoLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: loginColors.paperBottom }}>
        <ActivityIndicator color={loginColors.accent} />
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
