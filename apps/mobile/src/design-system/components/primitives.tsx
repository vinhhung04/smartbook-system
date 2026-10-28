import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cubicBezier, useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme-context';
import { fontFamily, motion, radii, size, space } from '../tokens';

export type IconName = keyof typeof Ionicons.glyphMap;

const PRESS_EASE = cubicBezier(0.23, 1, 0.32, 1);

interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Full-width rows highlight instead of scaling (a scaling row reads as the screen squishing). */
  scale?: boolean;
  pressedStyle?: StyleProp<ViewStyle>;
}

/**
 * Press feedback on press-in, commit on press-out: scale 0.97 over 120 ms as a
 * Reanimated CSS transition (UI thread, one render per press, not per frame).
 * Reduced motion keeps the press highlight and drops the scale.
 */
export function PressableScale({ children, style, scale = true, pressedStyle, onPressIn, onPressOut, ...props }: PressableScaleProps) {
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion();
  return (
    <Pressable
      {...props}
      pressRetentionOffset={{ top: 16, bottom: 16, left: 16, right: 16 }}
      onPressIn={(event) => { setPressed(true); onPressIn?.(event); }}
      onPressOut={(event) => { setPressed(false); onPressOut?.(event); }}
    >
      <Animated.View
        style={[
          style,
          pressed && pressedStyle,
          {
            transform: [{ scale: pressed && scale && !reduced ? motion.pressScale : 1 }],
            transitionProperty: 'transform',
            transitionDuration: motion.press,
            transitionTimingFunction: PRESS_EASE,
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'inverse';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: 'lg' | 'md';
  icon?: IconName;
  /** Icon after the label (e.g. an arrow for "continue"). */
  trailingIcon?: IconName;
  loading?: boolean;
  /** Label while loading; defaults to the label. */
  loadingLabel?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

/** One button for both apps; the theme decides pill (reader) or rounded rectangle (staff). */
export function Button({
  label, onPress, variant = 'primary', size: sizeName = 'lg', icon, trailingIcon, loading = false, loadingLabel,
  disabled = false, fullWidth = true, accessibilityLabel, accessibilityHint, testID,
}: ButtonProps) {
  const { colors, name } = useTheme();
  const inactive = disabled || loading;
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string; pressed: string }> = {
    primary: { bg: colors.primary, fg: colors.onPrimary, pressed: colors.primaryPressed },
    secondary: { bg: colors.surface, fg: colors.textPrimary, border: colors.borderStrong, pressed: colors.surfaceRaised },
    ghost: { bg: 'transparent', fg: colors.primary, pressed: colors.primarySoft },
    danger: { bg: colors.danger, fg: '#FFFFFF', pressed: colors.danger },
    inverse: { bg: colors.onInk, fg: colors.inkField, pressed: colors.onInkMuted },
  };
  const tone = palette[variant];
  const height = sizeName === 'lg' ? size.control : size.controlCompact;
  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={{
        minHeight: height,
        alignSelf: fullWidth ? 'stretch' : 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        paddingHorizontal: sizeName === 'lg' ? space.xl : space.lg,
        borderRadius: name === 'staff' ? radii.sm : radii.pill,
        borderCurve: 'continuous',
        backgroundColor: tone.bg,
        borderWidth: tone.border ? 1 : 0,
        borderColor: tone.border,
        opacity: disabled && !loading ? 0.45 : 1,
      }}
      pressedStyle={{ backgroundColor: tone.pressed }}
    >
      {loading ? <ActivityIndicator size="small" color={tone.fg} /> : icon ? <Ionicons name={icon} size={size.icon} color={tone.fg} /> : null}
      <Text
        style={{ fontFamily: fontFamily.semibold, fontSize: sizeName === 'lg' ? 16 : 15, color: tone.fg, textAlign: 'center', flexShrink: 1 }}
        numberOfLines={2}
      >
        {loading ? loadingLabel ?? label : label}
      </Text>
      {trailingIcon && !loading ? <Ionicons name={trailingIcon} size={18} color={tone.fg} /> : null}
    </PressableScale>
  );
}

interface IconButtonProps {
  icon: IconName;
  accessibilityLabel: string;
  onPress?: () => void;
  variant?: 'plain' | 'tonal' | 'inverse';
  /** Small count drawn on the corner; announced as part of the label. */
  badge?: number;
  disabled?: boolean;
  color?: string;
}

/** 48dp target whatever the glyph size. */
export function IconButton({ icon, accessibilityLabel, onPress, variant = 'plain', badge, disabled, color }: IconButtonProps) {
  const { colors } = useTheme();
  const bg = variant === 'tonal' ? colors.surfaceRaised : variant === 'inverse' ? 'rgba(255,255,255,0.14)' : 'transparent';
  const fg = color ?? (variant === 'inverse' ? colors.onInk : colors.textPrimary);
  const label = badge ? `${accessibilityLabel}, ${badge} mục mới` : accessibilityLabel;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: size.touch, height: size.touch, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: disabled ? 0.4 : 1 }}
      pressedStyle={{ backgroundColor: variant === 'inverse' ? 'rgba(255,255,255,0.24)' : colors.surfaceRaised }}
    >
      <Ionicons name={icon} size={22} color={fg} />
      {badge ? (
        <View style={{ position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fontFamily.bold, fontSize: 10.5, color: '#FFFFFF' }} allowFontScaling={false}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}
