import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { fontFamily } from '../tokens';
import type { Theme } from '../themes';
import type { IconName } from './primitives';

/**
 * Web only. Native tabs have no system tab bar on the web and fall back to an
 * iPad-style bar across the top, over each screen's title; the browser build
 * (used for development and previews) gets a plain bottom bar instead.
 */
export function WebTabs({ theme, tabs }: { theme: Theme; tabs: { name: string; title: string; icon: IconName }[] }) {
  const { colors } = theme;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 11.5 },
      }}
    >
      {tabs.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={(focused ? tab.icon : `${tab.icon}-outline`) as IconName} size={22} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
