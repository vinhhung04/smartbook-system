import { useCallback, useEffect, useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as exceptionReportApi from '../../src/api/exceptionReport';
import { ApiError } from '../../src/auth/auth-context';
import { isOutcomeUnknown } from '../../src/api/client';
import { SelectionSheet } from '../../src/components/SelectionSheet';
import type { SelectOption } from '../../src/lib/optionSearch';
import { parseOptionalQuantity, sanitizeQuantityInput } from '../../src/lib/quantity';
import { useSubmitLock } from '../../src/lib/submitLock';
import { PhotoCaptureModal } from '../../src/scanner/PhotoCaptureModal';
import type { MyWarehouseTaskOption, WarehouseOption } from '../../src/types/exceptionReport';
import {
  Button, ErrorState, FilterChips, InlineAlert, LoadingState, Screen, ScreenHeader, TextField, fontFamily, radii, size, space, useTheme,
} from '../../src/design-system';

/** A labelled field that opens a selection sheet instead of taking typing. */
function PickerField({ label, value, placeholder, onPress }: { label: string; value: string | null; placeholder: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.textPrimary }}>{label}</Text>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? 'chưa chọn'}`}
        style={({ pressed }) => ({
          minHeight: size.control, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, borderRadius: radii.sm,
          borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : colors.surface,
        })}
      >
        <Text style={{ flex: 1, fontFamily: value ? fontFamily.medium : fontFamily.regular, fontSize: 16, color: value ? colors.textPrimary : colors.textMuted }} numberOfLines={2}>
          {value ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

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
  const { colors } = useTheme();
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
    return (<><ScreenHeader title="Báo cáo sự cố mới" /><Screen scroll={false}><LoadingState label="Đang tải task và kho…" /></Screen></>);
  }

  if (loadError) {
    return (<><ScreenHeader title="Báo cáo sự cố mới" /><Screen scroll={false}><ErrorState message={loadError} onRetry={() => void loadContext()} /></Screen></>);
  }

  return (
    <>
      <ScreenHeader title="Báo cáo sự cố mới" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen
          footer={<Button label="Gửi báo cáo" icon="send" loading={isSubmitting} loadingLabel="Đang gửi…" onPress={handleSubmit} />}
        >
          <PickerField
            label="Task liên quan *"
            value={selectedTask ? `${TASK_TYPE_LABEL[selectedTask.type] ?? selectedTask.type}: ${selectedTask.title}` : null}
            placeholder="Chọn task"
            onPress={() => setPicker('task')}
          />
          <PickerField label="Kho *" value={warehouseLabel(warehouseId)} placeholder="Chọn kho" onPress={() => setPicker('warehouse')} />

          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.textPrimary }}>Loại sự cố *</Text>
            <FilterChips accessibilityLabel="Loại sự cố" value={exceptionType} onChange={setExceptionType} options={EXCEPTION_TYPES} />
          </View>

          <View style={{ flexDirection: 'row', gap: space.md }}>
            <View style={{ flex: 1 }}>
              <TextField
                label="SL dự kiến"
                mono
                keyboardType="number-pad"
                value={expectedQty}
                onChangeText={(text) => setExpectedQty(sanitizeQuantityInput(text))}
                accessibilityLabel="Số lượng dự kiến"
                placeholder="—"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="SL thực tế"
                mono
                keyboardType="number-pad"
                value={actualQty}
                onChangeText={(text) => setActualQty(sanitizeQuantityInput(text))}
                accessibilityLabel="Số lượng thực tế"
                placeholder="—"
              />
            </View>
          </View>

          <TextField
            label="Mô tả sự cố *"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            value={note}
            onChangeText={setNote}
            placeholder="Mô tả chi tiết sự cố phát hiện…"
          />

          <View style={{ gap: space.sm }}>
            <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.textPrimary }}>Ảnh bằng chứng</Text>
            {photoDataUrl ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
                <Image source={{ uri: photoDataUrl }} style={{ width: 96, height: 96, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised }} accessibilityLabel="Ảnh bằng chứng đã chụp" />
                <View style={{ flex: 1, gap: space.sm }}>
                  <Button label="Chụp lại" icon="camera-outline" variant="secondary" size="md" onPress={() => setCameraOpen(true)} />
                  <Button label="Xóa ảnh" icon="trash-outline" variant="ghost" size="md" onPress={() => setPhotoDataUrl(null)} />
                </View>
              </View>
            ) : (
              <Button label="Chụp ảnh bằng chứng" icon="camera-outline" variant="secondary" onPress={() => setCameraOpen(true)} />
            )}
          </View>

          {submitError ? <InlineAlert message={submitError} /> : null}
        </Screen>
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

