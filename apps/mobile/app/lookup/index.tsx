import { Stack } from 'expo-router';

import { QuickLookupPanel } from '../../src/components/QuickLookupPanel';

export default function QuickLookupScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Tra cứu nhanh' }} />
      <QuickLookupPanel />
    </>
  );
}
