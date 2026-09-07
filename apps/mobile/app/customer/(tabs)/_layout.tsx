import { StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';

import { CustomerTabBarIcon } from '../../../src/components/customer/CustomerTabBarIcon';
import { colors, fonts } from '../../../src/theme/customerTokens';

export default function CustomerTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        // Floating dark-glass bar — the customer-side counterpart to the
        // login screen's liquid glass, but dark instead of light.
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 20,
          height: 68,
          borderRadius: 28,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: 'transparent',
          paddingBottom: 10,
          paddingTop: 8,
          elevation: 0,
        },
        tabBarBackground: () => (
          <BlurView intensity={50} tint="dark" style={[StyleSheet.absoluteFill, styles.barBackground]} />
        ),
        tabBarLabelStyle: {
          fontFamily: fonts.bodyMedium,
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Khám phá',
          tabBarIcon: ({ focused }) => <CustomerTabBarIcon name="compass" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="my-books"
        options={{
          title: 'Sách của tôi',
          tabBarIcon: ({ focused }) => <CustomerTabBarIcon name="bookmark" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Ví & Phí',
          tabBarIcon: ({ focused }) => <CustomerTabBarIcon name="wallet" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Cá nhân',
          tabBarIcon: ({ focused }) => <CustomerTabBarIcon name="person-circle" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  barBackground: {
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: 'rgba(20,20,23,0.6)',
  },
});
