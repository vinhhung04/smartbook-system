import { forwardRef, useState, type ReactNode } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../theme-context';
import { fontFamily, radii, size, space } from '../tokens';
import type { IconName } from './primitives';

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  hint?: string;
  error?: string | null;
  icon?: IconName;
  /** Control at the right end of the field (clear, show password, scan…). */
  right?: ReactNode;
  /** Codes and quantities are read character by character: mono, larger. */
  mono?: boolean;
}

/**
 * Labelled input. The label sits above (never placeholder-only), the error sits
 * right under the field with an icon and is announced, focus draws a 2pt ring.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, hint, error, icon, right, mono = false, onFocus, onBlur, editable = true, ...input },
  ref,
) {
  const { colors, name } = useTheme();
  const [focused, setFocused] = useState(false);
  const ring = error ? colors.danger : focused ? colors.focus : colors.border;
  return (
    <View style={{ gap: space.sm }}>
      {label ? <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.textPrimary }}>{label}</Text> : null}
      <View
        style={{
          minHeight: size.control,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingLeft: icon ? space.md : space.lg,
          paddingRight: right ? space.xs : space.lg,
          borderRadius: name === 'staff' ? radii.sm : radii.md,
          borderCurve: 'continuous',
          backgroundColor: editable ? colors.surface : colors.surfaceRaised,
          borderWidth: focused || error ? 2 : 1,
          borderColor: ring,
        }}
      >
        {icon ? <Ionicons name={icon} size={size.icon} color={error ? colors.danger : focused ? colors.focus : colors.textMuted} /> : null}
        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={colors.textMuted}
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          accessibilityLabel={input.accessibilityLabel ?? label}
          accessibilityHint={error ?? hint}
          style={{
            flex: 1,
            minHeight: size.control - 4,
            paddingVertical: space.sm,
            fontFamily: mono ? fontFamily.monoBold : fontFamily.regular,
            fontSize: mono ? 17 : 16,
            letterSpacing: mono ? 0.4 : 0,
            color: colors.textPrimary,
          }}
          {...input}
        />
        {right}
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', gap: space.xs, alignItems: 'flex-start' }} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={16} color={colors.danger} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontFamily: fontFamily.medium, fontSize: 13.5, lineHeight: 19, color: colors.danger }}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={{ fontFamily: fontFamily.regular, fontSize: 13, lineHeight: 18, color: colors.textSecondary }}>{hint}</Text>
      ) : null}
    </View>
  );
});

/** Password with a show/hide toggle that keeps the keyboard up. */
export const PasswordField = forwardRef<TextInput, Omit<TextFieldProps, 'right' | 'secureTextEntry'>>(function PasswordField(props, ref) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      ref={ref}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      right={(
        <Pressable
          onPress={() => setVisible((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          accessibilityState={{ selected: visible }}
          hitSlop={4}
          style={{ width: size.touch - 4, height: size.touch - 4, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={size.icon} color={colors.textSecondary} />
        </Pressable>
      )}
    />
  );
});

interface SearchFieldProps extends Omit<TextInputProps, 'style'> {
  value: string;
  onChangeText: (value: string) => void;
  /** Extra action at the end (e.g. search by cover photo). */
  trailing?: ReactNode;
}

/** Rounded search box with a clear button; Enter is "search". */
export const SearchField = forwardRef<TextInput, SearchFieldProps>(function SearchField({ value, onChangeText, trailing, onFocus, onBlur, ...input }, ref) {
  const { colors, name } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View
      style={{
        minHeight: size.control,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingLeft: space.md,
        paddingRight: space.xs,
        borderRadius: name === 'staff' ? radii.sm : radii.pill,
        borderCurve: 'continuous',
        backgroundColor: colors.surface,
        borderWidth: focused ? 2 : 1,
        borderColor: focused ? colors.focus : colors.border,
      }}
    >
      <Ionicons name="search" size={size.icon} color={focused ? colors.focus : colors.textMuted} />
      <TextInput
        ref={ref}
        value={value}
        onChangeText={onChangeText}
        returnKeyType="search"
        autoCorrect={false}
        placeholderTextColor={colors.textMuted}
        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        style={{ flex: 1, minHeight: size.control - 4, fontFamily: fontFamily.regular, fontSize: 16, color: colors.textPrimary }}
        {...input}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          accessibilityRole="button"
          accessibilityLabel="Xoá nội dung tìm kiếm"
          style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="close-circle" size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}
      {trailing}
    </View>
  );
});
