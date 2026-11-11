import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';

import * as customerProfileApi from '../../src/api/customerProfile';
import { ApiError } from '../../src/auth/auth-context';
import { draftFromProfile, validateProfileDraft, type ProfileDraft } from '../../src/lib/profileForm';
import { useSubmitLock } from '../../src/lib/submitLock';
import { Button, ErrorState, InlineAlert, LoadingState, ScreenHeader, TextField, space, useTheme, type IconName } from '../../src/design-system';

const FIELDS: {
  key: keyof ProfileDraft; label: string; placeholder: string; icon: IconName; hint?: string;
  keyboard?: 'phone-pad' | 'numbers-and-punctuation'; multiline?: boolean; autoComplete?: 'name' | 'tel' | 'birthdate-full' | 'street-address';
}[] = [
  { key: 'full_name', label: 'Họ và tên', placeholder: 'Nguyễn Văn An', icon: 'person-outline', autoComplete: 'name' },
  { key: 'phone', label: 'Số điện thoại', placeholder: '0901 234 567', icon: 'call-outline', keyboard: 'phone-pad', autoComplete: 'tel' },
  { key: 'birth_date', label: 'Ngày sinh', placeholder: '2000-05-01', icon: 'calendar-outline', hint: 'Năm-tháng-ngày, ví dụ 2000-05-01.', keyboard: 'numbers-and-punctuation', autoComplete: 'birthdate-full' },
  { key: 'address', label: 'Địa chỉ', placeholder: 'Số nhà, đường, quận/huyện, tỉnh/thành', icon: 'home-outline', multiline: true, autoComplete: 'street-address' },
];

export default function CustomerProfileEditScreen() {
  const { colors, type } = useTheme();
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
      <ScreenHeader title="Sửa thông tin" />
      {!draft ? (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          {loadError ? <ErrorState title="Không mở được thông tin" message={loadError} onRetry={() => router.replace('/customer/profile-edit')} /> : <LoadingState />}
        </View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}
            keyboardShouldPersistTaps="handled"
            contentInsetAdjustmentBehavior="automatic"
          >
            {FIELDS.map((field) => (
              <TextField
                key={field.key}
                label={field.label}
                icon={field.icon}
                hint={field.hint}
                value={draft[field.key]}
                onChangeText={(text) => {
                  setDraft((current) => (current ? { ...current, [field.key]: text } : current));
                  if (fieldError?.field === field.key) setFieldError(null);
                }}
                placeholder={field.placeholder}
                keyboardType={field.keyboard}
                multiline={field.multiline}
                autoComplete={field.autoComplete}
                editable={!saving}
                autoCapitalize={field.key === 'full_name' ? 'words' : 'none'}
                error={fieldError?.field === field.key ? fieldError.message : null}
              />
            ))}
            <Text style={type.caption}>Email đăng nhập và mã thẻ thư viện chỉ thư viện mới thay đổi được.</Text>
            {fieldError && !fieldError.field ? <InlineAlert message={fieldError.message} /> : null}
            <Button label="Lưu thay đổi" icon="checkmark" loading={saving} loadingLabel="Đang lưu…" onPress={handleSave} />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </>
  );
}
