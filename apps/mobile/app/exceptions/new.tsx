import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack, router } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import * as exceptionReportApi from '../../src/api/exceptionReport';
import { ApiError } from '../../src/auth/auth-context';
import { isOutcomeUnknown } from '../../src/api/client';
import { SelectionSheet } from '../../src/components/SelectionSheet';
import type { SelectOption } from '../../src/lib/optionSearch';
import { parseOptionalQuantity, sanitizeQuantityInput } from '../../src/lib/quantity';
import { useSubmitLock } from '../../src/lib/submitLock';
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

  const [picker, setPicker] = useState<'task' | 'warehouse' | null>(null);
  const submitLock = useSubmitLock();

  const loadContext = useCallback(async () => {
    setIsLoadingContext(true);
    setLoadError(null);
    try {
      const [taskList, warehouseResult] = await Promise.all([
        exceptionReportApi.getMyOperationalTasks(),
        exceptionReportApi.getWarehouses(),
      ]);
      setTasks(taskList);
      setWarehouses(warehouseResult.data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Không tải được dữ liệu task/kho');
    } finally {
      setIsLoadingContext(false);
    }
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const taskOptions = useMemo<(SelectOption & { task: MyWarehouseTaskOption })[]>(
    () =>
      tasks.map((task) => ({
        id: `${task.type}-${task.id}`,
        title: task.title,
        subtitle: [TASK_TYPE_LABEL[task.type] ?? task.type, task.warehouse].filter(Boolean).join(' · '),
        keywords: task.status,
        task,
      })),
    [tasks],
  );

  const warehouseOptions = useMemo<SelectOption[]>(
    () => warehouses.map((wh) => ({ id: wh.id, title: wh.name, subtitle: wh.code, keywords: wh.code })),
    [warehouses],
  );

  function warehouseLabel(id: string | null) {
    const wh = warehouses.find((w) => w.id === id);
    return wh ? `${wh.code} — ${wh.name}` : null;
  }

  function handleSelectTask(option: SelectOption & { task: MyWarehouseTaskOption }) {
    setPicker(null);
    setSelectedTask(option.task);
    const matched = warehouses.find((w) => w.code === option.task.warehouse || w.name === option.task.warehouse);
    if (matched) setWarehouseId(matched.id);
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
    const expected = parseOptionalQuantity(expectedQty);
    if (!expected.ok) {
      setSubmitError(`SL dự kiến: ${expected.error}`);
      return;
    }
    const actual = parseOptionalQuantity(actualQty);
    if (!actual.ok) {
      setSubmitError(`SL thực tế: ${actual.error}`);
      return;
    }
    if (!note.trim()) {
      setSubmitError('Vui lòng mô tả sự cố');
      return;
    }

    await submitLock.run(async () => {
      setIsSubmitting(true);
      setSubmitError(null);
      try {
        await exceptionReportApi.createReport({
          warehouse_id: warehouseId,
          task_type: selectedTask.type,
          task_id: selectedTask.id,
          exception_type: exceptionType,
          expected_qty: expected.value,
          actual_qty: actual.value,
          note: note.trim(),
          evidence_photo_url: photoDataUrl ?? undefined,
        });
        Alert.alert('Đã gửi báo cáo', 'Quản lý sẽ xem xét và xử lý sự cố này.', [
          { text: 'OK', onPress: () => router.replace('/exceptions') },
        ]);
      } catch (err) {
        if (isOutcomeUnknown(err)) {
          // The report may already exist — re-sending blindly would file it twice.
          Alert.alert(
            'Chưa rõ báo cáo đã được gửi hay chưa',
            'Kết nối bị gián đoạn khi đang gửi. Hãy mở danh sách báo cáo để kiểm tra trước khi gửi lại.',
            [
              { text: 'Ở lại', style: 'cancel' },
              { text: 'Xem danh sách', onPress: () => router.replace('/exceptions') },
            ],
          );
        } else {
          setSubmitError(err instanceof ApiError ? err.message : 'Gửi báo cáo thất bại');
        }
      } finally {
        setIsSubmitting(false);
      }
    });
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
        <Pressable style={styles.retryButton} onPress={() => void loadContext()} accessibilityRole="button">
          <Text style={styles.retryText}>Thử lại</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Báo cáo sự cố mới' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Task liên quan *</Text>
          <Pressable style={styles.picker} onPress={() => setPicker('task')} accessibilityRole="button" accessibilityLabel="Chọn task liên quan">
            <Text style={selectedTask ? styles.pickerValue : styles.pickerPlaceholder}>
              {selectedTask
                ? `[${TASK_TYPE_LABEL[selectedTask.type] ?? selectedTask.type}] ${selectedTask.title}`
                : '-- Chọn task --'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Kho *</Text>
          <Pressable style={styles.picker} onPress={() => setPicker('warehouse')} accessibilityRole="button" accessibilityLabel="Chọn kho">
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
              onChangeText={(text) => setExpectedQty(sanitizeQuantityInput(text))}
              accessibilityLabel="Số lượng dự kiến"
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
              onChangeText={(text) => setActualQty(sanitizeQuantityInput(text))}
              accessibilityLabel="Số lượng thực tế"
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
      </KeyboardAvoidingView>

      <SelectionSheet
        visible={picker === 'task'}
        title="Chọn task liên quan"
        options={taskOptions}
        selectedId={selectedTask ? `${selectedTask.type}-${selectedTask.id}` : null}
        onSelect={handleSelectTask}
        onClose={() => setPicker(null)}
        searchPlaceholder="Tìm theo mã phiếu, loại, kho"
        emptyText="Bạn không có task đang hoạt động (tiếp nhận/cất hàng/lấy hàng/xuất kho)."
      />
      <SelectionSheet
        visible={picker === 'warehouse'}
        title="Chọn kho"
        options={warehouseOptions}
        selectedId={warehouseId}
        onSelect={(option) => {
          setPicker(null);
          setWarehouseId(option.id);
        }}
        onClose={() => setPicker(null)}
        searchPlaceholder="Tìm theo tên hoặc mã kho"
        emptyText="Không có kho nào đang hoạt động"
      />

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
  flex: {
    flex: 1,
  },
  retryButton: {
    marginTop: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: colors.primary,
    fontFamily: fonts.bodySemibold,
  },
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
