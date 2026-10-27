import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import * as customerProfileApi from '../../src/api/customerProfile';
import { ApiError } from '../../src/auth/auth-context';
import { draftFromProfile, validateProfileDraft, type ProfileDraft } from '../../src/lib/profileForm';
import { useSubmitLock } from '../../src/lib/submitLock';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/customerTokens';

const FIELDS: { key: keyof ProfileDraft; label: string; placeholder: string; keyboard?: 'phone-pad' | 'numbers-and-punctuation'; multiline?: boolean }[] = [
  { key: 'full_name', label: 'Họ và tên *', placeholder: 'Nguyễn Văn An' },
  { key: 'phone', label: 'Số điện thoại', placeholder: '0901 234 567', keyboard: 'phone-pad' },
  { key: 'birth_date', label: 'Ngày sinh (YYYY-MM-DD)', placeholder: '2000-05-01', keyboard: 'numbers-and-punctuation' },
  { key: 'address', label: 'Địa chỉ', placeholder: 'Số nhà, đường, quận/huyện, tỉnh/thành', multiline: true },
];

export default function CustomerProfileEditScreen() {
  const [original, setOriginal] = useState<ProfileDraft | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: keyof ProfileDraft | null; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useSubmitLock();

  useEffect(() => {
    customerProfileApi
      .getMyProfile()
      .then((result) => {
        const initial = draftFromProfile(result.data);
        setOriginal(initial);
        setDraft(initial);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Không tải được thông tin'));
  }, []);

  async function handleSave() {
    if (!draft || !original) return;
    const check = validateProfileDraft(draft, original);
    if (!check.ok) {
      setFieldError({ field: check.field, message: check.error });
      return;
    }
    if (Object.keys(check.update).length === 0) {
      router.back();
      return;
    }
    await lock.run(async () => {
      setSaving(true);
      setFieldError(null);
      try {
        await customerProfileApi.updateMyProfile(check.update);
        router.back();
      } catch (err) {
        const message = err instanceof ApiError ? (err.message === 'Phone already exists' ? 'Số điện thoại này đã được dùng cho tài khoản khác' : err.message) : 'Không lưu được thông tin';
        setFieldError({ field: null, message });
      } finally {
        setSaving(false);
      }
    });
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Sửa thông tin' }} />
      {!draft ? (
        <View style={styles.center}>
          {loadError ? <Text style={styles.error}>{loadError}</Text> : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {FIELDS.map((field) => (
              <View key={field.key} style={styles.field}>
                <Text style={styles.label}>{field.label}</Text>
                <TextInput
                  style={[styles.input, field.multiline && styles.multiline, fieldError?.field === field.key && styles.inputError]}
                  value={draft[field.key]}
                  onChangeText={(text) => setDraft((current) => (current ? { ...current, [field.key]: text } : current))}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.textMuted}
                  keyboardType={field.keyboard}
                  multiline={field.multiline}
                  editable={!saving}
                  autoCapitalize={field.key === 'full_name' ? 'words' : 'none'}
                  accessibilityLabel={field.label}
                />
                {fieldError?.field === field.key ? <Text style={styles.error}>{fieldError.message}</Text> : null}
              </View>
            ))}
            <Text style={styles.hint}>Email đăng nhập và mã thẻ thư viện chỉ thư viện mới thay đổi được.</Text>
            {fieldError && !fieldError.field ? <Text style={styles.error}>{fieldError.message}</Text> : null}
            <Pressable style={[styles.button, saving && styles.disabled]} onPress={handleSave} disabled={saving} accessibilityRole="button">
              {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>Lưu thay đổi</Text>}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: spacing.lg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  field: { gap: spacing.xs },
  label: { ...typography.label },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  multiline: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  inputError: { borderColor: colors.dangerBorder },
  error: { color: colors.danger, fontWeight: '600' },
  hint: { ...typography.caption },
  button: { minHeight: 52, borderRadius: radius.pill, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: fonts.bodySemibold, color: colors.onPrimary, fontSize: 16 },
  disabled: { opacity: 0.6 },
});
