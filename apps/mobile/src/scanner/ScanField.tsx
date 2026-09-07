import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { CameraScannerModal } from './CameraScannerModal';
import { colors, fonts, radius, spacing } from '../theme/tokens';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (value: string) => void;
  placeholder: string;
  editable?: boolean;
  autoFocus?: boolean;
};

/**
 * Reusable scan input: a focused text field that receives hardware
 * keyboard-wedge scanner input directly (the scanner types + presses
 * Enter, which fires onSubmitEditing), plus a camera button as an
 * alternative input source. Both paths funnel through the same onSubmit.
 *
 * Styled as a manifest form field (bordered box, monospace entry) since
 * this is the single most repeated interaction in the app.
 */
export function ScanField({ value, onChangeText, onSubmit, placeholder, editable = true, autoFocus }: Props) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.row}>
      <View style={[styles.inputWrap, isFocused && styles.inputWrapFocused, !editable && styles.inputDisabled]}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={(e) => onSubmit(e.nativeEvent.text)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          editable={editable}
          autoFocus={autoFocus}
          autoCapitalize="characters"
          blurOnSubmit={false}
        />
      </View>
      <Pressable
        style={({ pressed }) => [styles.cameraButton, pressed && styles.cameraButtonPressed, !editable && styles.cameraButtonDisabled]}
        onPress={() => setCameraOpen(true)}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel="Quét bằng camera"
      >
        <View style={styles.cameraIcon}>
          <View style={styles.cameraIconBump} />
          <View style={styles.cameraIconLens} />
        </View>
      </Pressable>
      <CameraScannerModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onScanned={(code) => {
          setCameraOpen(false);
          onChangeText(code);
          onSubmit(code);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inputWrap: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
  },
  inputWrapFocused: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  input: {
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontFamily: fonts.mono,
    fontSize: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textPrimary,
  },
  cameraButton: {
    width: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraButtonPressed: {
    opacity: 0.8,
  },
  cameraButtonDisabled: {
    opacity: 0.5,
  },
  cameraIcon: {
    width: 22,
    height: 17,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraIconBump: {
    position: 'absolute',
    top: -5,
    width: 8,
    height: 3,
    borderRadius: 1,
    backgroundColor: colors.primary,
  },
  cameraIconLens: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
});
