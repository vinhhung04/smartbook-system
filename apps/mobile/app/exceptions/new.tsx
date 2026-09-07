import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import * as exceptionReportApi from '../../src/api/exceptionReport';
import { ApiError } from '../../src/auth/auth-context';
import { PhotoCaptureModal } from '../../src/scanner/PhotoCaptureModal';
import type { MyWarehouseTaskOption, WarehouseOption } from '../../src/types/exceptionReport';
import { colors, fonts, radius, shadow, spacing, typography } from '../../src/theme/tokens';

const EXCEPTION_TYPES: { value: string; label: string }[] = [
  { value: 'SHORT', label: 'Thiếu hàng' },
  { value: 'OVERAGE', label: 'Dư hàng' },
  { value: 'DAMAGED', label: 'Hư hỏng' },
  { value: 'WRONG_ITEM', label: 'Sai sản phẩm' },
  { value: 'WRONG_QTY', label: 'Sai số lượng' },
  { value: 'OTHER', label: 'Khác' },
];

const TASK_TYPE_LABEL: Record<string, string> = {
  RECEIVING: 'Tiếp nhận hàng',
  PUTAWAY: 'Cất hàng vào kho',
  PICKING: 'Lấy hàng',
  OUTBOUND: 'Xuất kho',
};

export default function NewExceptionReportScreen() {
  const [tasks, setTasks] = useState<MyWarehouseTaskOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [isLoadingContext, setIsLoadingContext] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedTask, setSelectedTask] = useState<MyWarehouseTaskOption | null>(null);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [exceptionType, setExceptionType] = useState<string>('SHORT');
  const [expectedQty, setExpectedQty] = useState('');
  const [actualQty, setActualQty] = useState('');
  const [note, setNote] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([exceptionReportApi.getMyOperationalTasks(), exceptionReportApi.getWarehouses()])
      .then(([taskList, warehouseResult]) => {
        setTasks(taskList);
        setWarehouses(warehouseResult.data);
      })
      .catch((err) => {
        setLoadError(err instanceof ApiError ? err.message : 'Không tải được dữ liệu task/kho');
      })
      .finally(() => setIsLoadingContext(false));
  }, []);

  function warehouseLabel(id: string | null) {
    const wh = warehouses.find((w) => w.id === id);
    return wh ? `${wh.code} — ${wh.name}` : null;
  }

  function handlePickTask() {
    if (tasks.length === 0) {
      Alert.alert('Không có task', 'Bạn không có task đang hoạt động (tiếp nhận/cất hàng/lấy hàng/xuất kho).');
      return;
    }
    Alert.alert(
      'Chọn task liên quan',
      undefined,
      [
        ...tasks.map((task) => ({
          text: `[${TASK_TYPE_LABEL[task.type] ?? task.type}] ${task.title}${task.warehouse ? ` — ${task.warehouse}` : ''}`,
          onPress: () => {
            setSelectedTask(task);
            const matched = warehouses.find((w) => w.code === task.warehouse || w.name === task.warehouse);
            if (matched) setWarehouseId(matched.id);
          },
        })),
        { text: 'Hủy', style: 'cancel' as const },
      ],
    );
  }

  function handlePickWarehouse() {
    if (warehouses.length === 0) return;
    Alert.alert(
      'Chọn kho',
      undefined,
      [
        ...warehouses.map((wh) => ({
          text: `${wh.code} — ${wh.name}`,
          onPress: () => setWarehouseId(wh.id),
        })),
        { text: 'Hủy', style: 'cancel' as const },
      ],
    );
  }

  async function handleSubmit() {
    if (!selectedTask) {
      setSubmitError('Vui lòng chọn task liên quan');
      return;
    }
    if (!warehouseId) {
      setSubmitError('Vui lòng chọn kho');
      return;
    }
    if (!note.trim()) {
      setSubmitError('Vui lòng mô tả sự cố');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await exceptionReportApi.createReport({
        warehouse_id: warehouseId,
        task_type: selectedTask.type,
        task_id: selectedTask.id,
        exception_type: exceptionType,
        expected_qty: expectedQty ? Number(expectedQty) : undefined,
        actual_qty: actualQty ? Number(actualQty) : undefined,
        note: note.trim(),
        evidence_photo_url: photoDataUrl ?? undefined,
      });
      Alert.alert('Đã gửi báo cáo', 'Quản lý sẽ xem xét và xử lý sự cố này.', [
        { text: 'OK', onPress: () => router.replace('/exceptions') },
      ]);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Gửi báo cáo thất bại');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoadingContext) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{loadError}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Báo cáo sự cố mới' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Task liên quan *</Text>
          <Pressable style={styles.picker} onPress={handlePickTask}>
            <Text style={selectedTask ? styles.pickerValue : styles.pickerPlaceholder}>
              {selectedTask
                ? `[${TASK_TYPE_LABEL[selectedTask.type] ?? selectedTask.type}] ${selectedTask.title}`
                : '-- Chọn task --'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Kho *</Text>
          <Pressable style={styles.picker} onPress={handlePickWarehouse}>
            <Text style={warehouseId ? styles.pickerValue : styles.pickerPlaceholder}>
              {warehouseLabel(warehouseId) ?? '-- Chọn kho --'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Loại sự cố *</Text>
          <View style={styles.chipRow}>
            {EXCEPTION_TYPES.map((t) => (
              <Pressable
                key={t.value}
                style={[styles.chip, exceptionType === t.value && styles.chipActive]}
                onPress={() => setExceptionType(t.value)}
              >
                <Text style={[styles.chipText, exceptionType === t.value && styles.chipTextActive]}>
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.field, styles.flex1]}>
            <Text style={styles.fieldLabel}>SL dự kiến</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={expectedQty}
              onChangeText={setExpectedQty}
              placeholder="-"
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={[styles.field, styles.flex1]}>
            <Text style={styles.fieldLabel}>SL thực tế</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={actualQty}
              onChangeText={setActualQty}
              placeholder="-"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Mô tả sự cố *</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            multiline
            numberOfLines={4}
            value={note}
            onChangeText={setNote}
            placeholder="Mô tả chi tiết sự cố phát hiện..."
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Ảnh bằng chứng</Text>
          {photoDataUrl ? (
            <View style={styles.photoRow}>
              <Image source={{ uri: photoDataUrl }} style={styles.photoThumb} />
              <View style={styles.photoActions}>
                <Pressable style={styles.photoActionButton} onPress={() => setCameraOpen(true)}>
                  <Text style={styles.photoActionText}>Chụp lại</Text>
                </Pressable>
                <Pressable style={styles.photoActionButton} onPress={() => setPhotoDataUrl(null)}>
                  <Text style={styles.photoActionTextDanger}>Xóa ảnh</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable style={styles.photoCaptureButton} onPress={() => setCameraOpen(true)}>
              <Text style={styles.photoCaptureText}>📷 CHỤP ẢNH BẰNG CHỨNG</Text>
            </Pressable>
          )}
        </View>

        {submitError ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>{submitError}</Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.submitButton, (isSubmitting || pressed) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.submitButtonText}>GỬI BÁO CÁO</Text>
          )}
        </Pressable>
      </ScrollView>

      <PhotoCaptureModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCaptured={(dataUrl) => {
          setPhotoDataUrl(dataUrl);
          setCameraOpen(false);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  flex1: {
    flex: 1,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    ...typography.label,
  },
  picker: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  pickerPlaceholder: {
    ...typography.body,
    color: colors.textMuted,
  },
  pickerValue: {
    ...typography.body,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs + 2,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.onPrimary,
    fontFamily: fonts.bodySemibold,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
  },
  textarea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  photoCaptureButton: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primaryBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
  },
  photoCaptureText: {
    fontFamily: fonts.monoSemibold,
    color: colors.primary,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  photoRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  photoThumb: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoActions: {
    gap: spacing.sm,
  },
  photoActionButton: {
    paddingVertical: spacing.xs,
  },
  photoActionText: {
    ...typography.caption,
    fontFamily: fonts.bodySemibold,
    color: colors.primary,
  },
  photoActionTextDanger: {
    ...typography.caption,
    fontFamily: fonts.bodySemibold,
    color: colors.danger,
  },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  error: {
    ...typography.code,
    color: colors.danger,
    fontSize: 13,
  },
  submitButton: {
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 4,
    alignItems: 'center',
    ...shadow.card,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontFamily: fonts.displayBold,
    color: colors.onPrimary,
    fontSize: 16,
    letterSpacing: 0.5,
  },
});
