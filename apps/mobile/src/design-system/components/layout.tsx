import type { ReactNode } from 'react';
import { Platform, RefreshControl, ScrollView, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme-context';
import { fontFamily, radii, size, space } from '../tokens';
import { PressableScale, type IconName } from './primitives';

interface ScreenProps {
  children: ReactNode;
  /** Tab roots have no stack header, so they pad for the status bar themselves. */
  safeTop?: boolean;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pinned bottom actions (BottomActionBar is added around it). */
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Full-bleed first block (e.g. a hero) without side padding. */
  bleed?: boolean;
}

/**
 * Screen frame: theme background, safe areas, pull to refresh, taps that reach
 * controls while the keyboard is up, and room under the content for a pinned
 * action bar so nothing ever hides behind it.
 */
export function Screen({ children, safeTop = false, scroll = true, refreshing = false, onRefresh, footer, contentStyle, bleed = false }: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const padding: ViewStyle = {
    paddingTop: (safeTop ? insets.top : 0) + (bleed ? 0 : space.lg),
    paddingHorizontal: bleed ? 0 : space.lg,
    paddingBottom: footer ? 120 + insets.bottom : space.xxl + (Platform.OS === 'web' ? insets.bottom : 0),
    gap: space.xl,
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {scroll ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[padding, contentStyle]}
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, padding, contentStyle]}>{children}</View>
      )}
      {footer ? <BottomActionBar>{footer}</BottomActionBar> : null}
    </View>
  );
}

/** Native stack header for a pushed screen: real back gesture/button, themed title. */
export function ScreenHeader({ title, right, transparent = false }: { title: string; right?: ReactNode; transparent?: boolean }) {
  const { colors, name } = useTheme();
  return (
    <Stack.Screen
      options={{
        headerShown: true,
        title,
        headerTransparent: transparent,
        headerStyle: { backgroundColor: transparent ? 'transparent' : colors.bg },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        headerTitleStyle: { fontFamily: name === 'customer' ? fontFamily.serif : fontFamily.semibold, fontSize: 18, color: colors.textPrimary },
        headerRight: right ? () => right : undefined,
      }}
    />
  );
}

/** Title block for a tab's root screen (tabs carry no stack header). */
export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const { type } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.md }}>
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={type.display} accessibilityRole="header">{title}</Text>
        {subtitle ? <Text style={type.caption}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={{ flexDirection: 'row', gap: space.xs }}>{right}</View> : null}
    </View>
  );
}

export function SectionHeader({ title, caption, actionLabel, onAction }: { title: string; caption?: string; actionLabel?: string; onAction?: () => void }) {
  const { colors, type } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.heading} accessibilityRole="header">{title}</Text>
        {caption ? <Text style={type.caption}>{caption}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Text
          onPress={onAction}
          accessibilityRole="button"
          suppressHighlighting
          style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.primary, paddingVertical: space.sm, paddingLeft: space.sm }}
        >
          {actionLabel}
        </Text>
      ) : null}
    </View>
  );
}

/** Grouped surface. Tappable cards scale; static ones do not. */
export function Card({ children, onPress, style, accessibilityLabel, accessibilityHint, padded = true }: {
  children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; accessibilityHint?: string; padded?: boolean;
}) {
  const { colors, shadow, name } = useTheme();
  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: name === 'staff' ? radii.md : radii.lg,
    borderCurve: 'continuous',
    padding: padded ? space.lg : 0,
    gap: space.md,
    borderWidth: name === 'staff' ? 1 : 0,
    borderColor: colors.border,
    ...(name === 'staff' ? null : shadow.card),
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} style={[base, style]}>
      {children}
    </PressableScale>
  );
}

/** Settings-style row: icon tile, title, detail, value or chevron. Full-width rows highlight, not scale. */
export function ListRow({ icon, iconTone, title, subtitle, value, onPress, trailing, destructive = false, accessibilityHint }: {
  icon?: IconName; iconTone?: string; title: string; subtitle?: string; value?: string; onPress?: () => void; trailing?: ReactNode; destructive?: boolean; accessibilityHint?: string;
}) {
  const { colors } = useTheme();
  const content = (
    <>
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: radii.sm, backgroundColor: destructive ? colors.dangerSoft : colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={icon} size={19} color={destructive ? colors.danger : iconTone ?? colors.textPrimary} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontFamily: fontFamily.medium, fontSize: 16, color: destructive ? colors.danger : colors.textPrimary }}>{title}</Text>
        {subtitle ? <Text style={{ fontFamily: fontFamily.regular, fontSize: 13.5, lineHeight: 19, color: colors.textSecondary }}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={{ fontFamily: fontFamily.medium, fontSize: 14.5, color: colors.textSecondary }}>{value}</Text> : null}
      {trailing}
      {onPress && !destructive ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </>
  );
  const rowStyle: ViewStyle = { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md };
  if (!onPress) return <View style={rowStyle}>{content}</View>;
  return (
    <PressableScale
      onPress={onPress}
      scale={false}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, value].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      style={rowStyle}
      pressedStyle={{ backgroundColor: colors.surfaceRaised }}
    >
      {content}
    </PressableScale>
  );
}

/** Rows inside one surface, separated by hairline insets. */
export function ListGroup({ children }: { children: ReactNode }) {
  const { colors, name } = useTheme();
  const items = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: name === 'staff' ? radii.md : radii.lg, borderCurve: 'continuous', overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
      {items.map((child, index) => (
        <View key={index}>
          {index > 0 ? <View style={{ height: 1, marginLeft: space.lg, backgroundColor: colors.border }} /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/** Label and value on one line; values that are codes render in mono and can be copied. */
export function InfoRow({ label, value, mono = false, tone }: { label: string; value: ReactNode; mono?: boolean; tone?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.lg, paddingVertical: space.xs }}>
      <Text style={{ fontFamily: fontFamily.regular, fontSize: 14.5, color: colors.textSecondary, flexShrink: 0, maxWidth: '45%' }}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text
          selectable
          style={{ flex: 1, textAlign: 'right', fontFamily: mono ? fontFamily.monoBold : fontFamily.semibold, fontSize: mono ? 14.5 : 15, color: tone ?? colors.textPrimary }}
        >
          {value}
        </Text>
      ) : (
        <View style={{ flex: 1, alignItems: 'flex-end' }}>{value}</View>
      )}
    </View>
  );
}

export function Avatar({ name, size: diameter = 56 }: { name?: string | null; size?: number }) {
  const { colors } = useTheme();
  const initials = String(name || '?').trim().split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toUpperCase()).join('') || '?';
  return (
    <View style={{ width: diameter, height: diameter, borderRadius: diameter / 2, backgroundColor: colors.inkField, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: diameter * 0.36, color: colors.onInk }} allowFontScaling={false}>{initials}</Text>
    </View>
  );
}

/** Pinned bottom bar for the screen's primary action, above the home indicator. */
export function BottomActionBar({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: Math.max(insets.bottom, space.md) + space.xs,
        backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, gap: space.sm,
      }}
    >
      {children}
    </View>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** Peer views of the same list. Changing it ticks a selection haptic; no sliding animation (it is used dozens of times a day). */
export function SegmentedControl<T extends string>({ options, value, onChange, accessibilityLabel }: { options: SegmentOption<T>[]; value: T; onChange: (value: T) => void; accessibilityLabel?: string }) {
  const { colors, name } = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', padding: 4, gap: 4, borderRadius: name === 'staff' ? radii.sm + 2 : radii.pill, backgroundColor: colors.surfaceRaised }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <PressableScale
            key={option.value}
            onPress={() => {
              if (active) return;
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              onChange(option.value);
            }}
            scale={false}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.count != null ? `${option.label}, ${option.count}` : option.label}
            style={{
              flex: 1, minHeight: size.controlCompact - 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
              borderRadius: name === 'staff' ? radii.sm : radii.pill,
              backgroundColor: active ? colors.surface : 'transparent',
              ...(active ? { borderWidth: 1, borderColor: colors.border } : null),
            }}
          >
            <Text numberOfLines={1} style={{ fontFamily: active ? fontFamily.semibold : fontFamily.medium, fontSize: 14, color: active ? colors.textPrimary : colors.textSecondary }}>
              {option.label}
            </Text>
            {option.count != null ? (
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: 12.5, color: active ? colors.primary : colors.textMuted }}>{option.count}</Text>
            ) : null}
          </PressableScale>
        );
      })}
    </View>
  );
}

/** Horizontal filter chips; the selected one is filled. */
export function FilterChips<T extends string>({ options, value, onChange, accessibilityLabel }: { options: SegmentOption<T>[]; value: T; onChange: (value: T) => void; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingRight: space.lg }} accessibilityLabel={accessibilityLabel}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <PressableScale
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              minHeight: 40, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radii.pill,
              backgroundColor: active ? colors.textPrimary : colors.surface, borderWidth: 1, borderColor: active ? colors.textPrimary : colors.border,
            }}
          >
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: active ? colors.surface : colors.textPrimary }}>{option.label}</Text>
            {option.count != null ? <Text style={{ fontFamily: fontFamily.medium, fontSize: 13, color: active ? colors.surface : colors.textMuted }}>{option.count}</Text> : null}
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
