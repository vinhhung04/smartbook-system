import 'react-native-gesture-handler';

import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
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
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { colors } from '../src/theme/tokens';

function RootNavigation() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    const onLoginScreen = segments[0] === 'login';

    if (!user && !onLoginScreen) {
      router.replace('/login');
    } else if (user && onLoginScreen) {
      router.replace('/');
    }
  }, [isLoading, user, segments, router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
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
  );
}

export default function RootLayout() {
  const [soraLoaded] = useSora({ Sora_600SemiBold, Sora_700Bold });
  const [manropeLoaded] = useManrope({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold });
  const [robotoMonoLoaded] = useRobotoMono({ RobotoMono_400Regular, RobotoMono_700Bold });

  if (!soraLoaded || !manropeLoaded || !robotoMonoLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <RootNavigation />
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
