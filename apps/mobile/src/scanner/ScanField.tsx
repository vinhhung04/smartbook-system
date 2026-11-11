import { useState } from 'react';
import { Platform, Pressable, TextInput, View, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { CameraScannerModal } from './CameraScannerModal';
import { fontFamily, radii, size, space, useTheme } from '../design-system';

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: (value: string) => void;
  placeholder: string;
  editable?: boolean;
  autoFocus?: boolean;
};

const NO_WEB_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : null) as TextStyle | null;

/**
 * The most repeated interaction in the staff app. A focused text field that
 * takes keyboard-wedge scanner input directly (the scanner types and presses
 * Enter, which fires onSubmitEditing) and doubles as manual entry, plus a
 * large camera button. Both paths go through the same onSubmit. Codes are set
 * in mono, large, so a misread character is visible before it is sent.
 */
export function ScanField({ value, onChangeText, onSubmit, placeholder, editable = true, autoFocus }: Props) {
  const { colors } = useTheme();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      <View
        style={{
          flex: 1, minHeight: size.control, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md,
          borderRadius: radii.sm, backgroundColor: editable ? colors.surface : colors.surfaceRaised,
          borderWidth: isFocused ? 2 : 1, borderColor: isFocused ? colors.focus : colors.borderStrong, opacity: editable ? 1 : 0.6,
        }}
      >
        <Ionicons name="barcode-outline" size={22} color={isFocused ? colors.focus : colors.textMuted} />
        <TextInput
          style={[NO_WEB_OUTLINE, { flex: 1, minHeight: size.control - 4, paddingRight: space.md, fontFamily: fontFamily.monoBold, fontSize: 17, letterSpacing: 0.6, color: colors.textPrimary }]}
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
          autoCorrect={false}
          returnKeyType="done"
          submitBehavior="submit"
          accessibilityLabel={placeholder}
          accessibilityHint="Quét bằng máy quét cầm tay hoặc nhập mã rồi nhấn Xong"
        />
      </View>
      <Pressable
        style={({ pressed }) => ({
          width: size.control, minHeight: size.control, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center',
          backgroundColor: pressed ? colors.primaryPressed : colors.primary, opacity: editable ? 1 : 0.5,
        })}
        onPress={() => setCameraOpen(true)}
        disabled={!editable}
        accessibilityRole="button"
        accessibilityLabel="Quét bằng camera"
      >
        <Ionicons name="camera" size={22} color={colors.onPrimary} />
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
