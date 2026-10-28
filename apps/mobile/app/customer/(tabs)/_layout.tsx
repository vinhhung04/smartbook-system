import Ionicons from '@expo/vector-icons/Ionicons';
import { NativeTabs } from 'expo-router/native-tabs';

import { customerTheme, fontFamily } from '../../../src/design-system';

const { colors } = customerTheme;

/**
 * Reader tabs on the platform's own tab bar. The old floating blurred bar sat on
 * top of the last rows of every list; the native bar reserves its own space and
 * handles the home indicator / gesture bar itself.
 */
export default function CustomerTabsLayout() {
  return (
    <NativeTabs
      tintColor={colors.primary}
      iconColor={{ default: colors.textMuted, selected: colors.primary }}
      labelStyle={{ default: { fontFamily: fontFamily.medium, fontSize: 11.5, color: colors.textSecondary }, selected: { fontFamily: fontFamily.semibold, fontSize: 11.5, color: colors.primary } }}
      backgroundColor={colors.surface}
      indicatorColor={colors.primarySoft}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'safari', selected: 'safari.fill' }}
          src={{ default: <NativeTabs.Trigger.VectorIcon family={Ionicons} name="compass-outline" />, selected: <NativeTabs.Trigger.VectorIcon family={Ionicons} name="compass" /> }}
        />
        <NativeTabs.Trigger.Label>Khám phá</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="my-books">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'books.vertical', selected: 'books.vertical.fill' }}
          src={{ default: <NativeTabs.Trigger.VectorIcon family={Ionicons} name="library-outline" />, selected: <NativeTabs.Trigger.VectorIcon family={Ionicons} name="library" /> }}
        />
        <NativeTabs.Trigger.Label>Sách của tôi</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wallet">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'creditcard', selected: 'creditcard.fill' }}
          src={{ default: <NativeTabs.Trigger.VectorIcon family={Ionicons} name="wallet-outline" />, selected: <NativeTabs.Trigger.VectorIcon family={Ionicons} name="wallet" /> }}
        />
        <NativeTabs.Trigger.Label>Ví & phí</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon
          sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }}
          src={{ default: <NativeTabs.Trigger.VectorIcon family={Ionicons} name="person-circle-outline" />, selected: <NativeTabs.Trigger.VectorIcon family={Ionicons} name="person-circle" /> }}
        />
        <NativeTabs.Trigger.Label>Cá nhân</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
