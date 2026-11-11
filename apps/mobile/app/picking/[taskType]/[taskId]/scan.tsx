import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as pickingApi from '../../../../src/api/picking';
import { ApiError } from '../../../../src/auth/auth-context';
import { isOutcomeUnknown } from '../../../../src/api/client';
import { parseWholeQuantity, sanitizeQuantityInput } from '../../../../src/lib/quantity';
import { useSubmitLock } from '../../../../src/lib/submitLock';
import { notifyScanError, notifyScanSuccess } from '../../../../src/scanner/haptics';
import { matchesCode } from '../../../../src/scanner/matching';
import { ScanField } from '../../../../src/scanner/ScanField';
import { ScanStep } from '../../../../src/components/ScanStep';
import { StampBadge } from '../../../../src/components/StampBadge';
import type { PickingLine, PickingTaskDetail, PickingTaskType, VariantMatch } from '../../../../src/types/picking';
import {
  Button, EmptyState, ErrorState, InlineAlert, LoadingState, PressableScale, Screen, ScreenHeader, StepIndicator, TextField, fontFamily, radii, space, useTheme,
} from '../../../../src/design-system';

const STEPS = ['Vị trí', 'Sản phẩm', 'Số lượng'];

export default function ScanScreen() {
  const { taskType, taskId } = useLocalSearchParams<{ taskType: PickingTaskType; taskId: string }>();
  const { colors, type } = useTheme();
  const [task, setTask] = useState<PickingTaskDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Step 1: location — verified client-side against the current line's known
  // location (code/barcode/id), same as apps/web/src/components/pages/picking.tsx.
  const [locationInput, setLocationInput] = useState('');
  const [locationVerified, setLocationVerified] = useState(false);
  const [locationMessage, setLocationMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // Step 2: product — verified server-side via lookup-variant-by-barcode,
  // matched against the current line's variant_id.
  const [productInput, setProductInput] = useState('');
  const [productVerified, setProductVerified] = useState(false);
  const [productMessage, setProductMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [isLookingUpProduct, setIsLookingUpProduct] = useState(false);
  const [ambiguousMatches, setAmbiguousMatches] = useState<VariantMatch[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const productLookupRef = useRef(0);

  // Step 3: quantity + submit.
  const [quantity, setQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submitLock = useSubmitLock();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const detail = await pickingApi.getTaskDetail(taskType, taskId);
      setTask(detail);
      setQuantity(detail.current_line ? String(detail.current_line.remaining_qty) : '');
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Không tải được phiếu');
    }
  }, [taskType, taskId]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  function resetProductStep() {
    setProductInput('');
    setProductVerified(false);
    setProductMessage(null);
    setAmbiguousMatches([]);
    setSelectedVariantId(null);
  }

  function resetAll(line: PickingLine | null) {
    setLocationInput('');
    setLocationVerified(false);
    setLocationMessage(null);
    resetProductStep();
    setSubmitError(null);
    setQuantity(line ? String(line.remaining_qty) : '');
  }

  function handleLocationChange(text: string) {
    setLocationInput(text);
    if (locationVerified) {
      setLocationVerified(false);
      resetProductStep();
    }
  }

  function handleLocationSubmit(value: string) {
    const line = task?.current_line;
    if (!line) return;
    if (!value.trim()) return;

    if (matchesCode([line.source_location_id, line.source_location_code, line.source_location_barcode], value)) {
      notifyScanSuccess();
      setLocationVerified(true);
      setLocationMessage({ text: 'Đúng vị trí, tiếp tục quét sản phẩm bên dưới.', ok: true });
      resetProductStep();
    } else {
      notifyScanError();
      setLocationVerified(false);
      setLocationMessage({ text: `Sai vị trí. Cần đến ${line.source_location_code ?? 'vị trí được chỉ định'}`, ok: false });
    }
  }

  function handleProductChange(text: string) {
    setProductInput(text);
    if (productVerified) {
      setProductVerified(false);
      setSelectedVariantId(null);
    }
    setAmbiguousMatches([]);
    setProductMessage(null);
  }

  async function handleProductSubmit(value: string) {
    const line = task?.current_line;
    const barcode = value.trim();
    if (!line || !barcode) return;

    const requestId = ++productLookupRef.current;
    setIsLookingUpProduct(true);
    setProductMessage(null);
    setAmbiguousMatches([]);
    try {
      const result = await pickingApi.lookupVariantByBarcode(barcode);
      // A newer scan was submitted while this lookup was in flight — its answer wins.
      if (requestId !== productLookupRef.current) return;

      if (result.ambiguous) {
        setAmbiguousMatches(result.matches);
        setProductVerified(false);
        setProductMessage({ text: 'Mã trùng nhiều sản phẩm, chọn đúng sản phẩm bên dưới.', ok: false });
        return;
      }

      if (result.selected?.variant_id === line.variant_id) {
        notifyScanSuccess();
        setProductVerified(true);
        setSelectedVariantId(result.selected.variant_id);
        setProductMessage({ text: `Đã nhận diện: ${result.selected.book_title}`, ok: true });
      } else {
        notifyScanError();
        setProductVerified(false);
        setProductMessage({ text: 'Sai sản phẩm cho dòng hiện tại.', ok: false });
      }
    } catch (err) {
      if (requestId !== productLookupRef.current) return;
      notifyScanError();
      setProductVerified(false);
      setProductMessage({ text: err instanceof ApiError ? err.message : 'Không tra được mã sản phẩm', ok: false });
    } finally {
      if (requestId === productLookupRef.current) setIsLookingUpProduct(false);
    }
  }

  function handleSelectAmbiguous(match: VariantMatch) {
    const line = task?.current_line;
    if (!line) return;
    if (match.variant_id === line.variant_id) {
      notifyScanSuccess();
      setProductVerified(true);
      setSelectedVariantId(match.variant_id);
      setProductMessage({ text: `Đã chọn đúng: ${match.book_title}`, ok: true });
    } else {
      notifyScanError();
      setProductVerified(false);
      setSelectedVariantId(null);
      setProductMessage({ text: 'Sai sản phẩm cho dòng hiện tại.', ok: false });
    }
  }

  async function handleConfirm() {
    const line = task?.current_line;
    if (!line) return;
    const parsed = parseWholeQuantity(quantity, { max: line.remaining_qty, maxLabel: 'số còn cần lấy' });
    if (!parsed.ok) {
      setSubmitError(parsed.error);
      return;
    }

    await submitLock.run(async () => {
      setIsSubmitting(true);
      setSubmitError(null);
      try {
        const result = await pickingApi.confirmLine(taskType, taskId, line.line_id, {
          quantity: parsed.value,
          scanned_location_input: locationInput.trim(),
          scanned_product_barcode: productInput.trim() || undefined,
          scanned_variant_id: selectedVariantId ?? undefined,
        });

        if (result.data.task_completed) {
          Alert.alert('Hoàn tất!', 'Đã lấy đủ toàn bộ sản phẩm trong phiếu này.', [
            { text: 'OK', onPress: () => router.replace('/picking') },
          ]);
          return;
        }

        await load();
        resetAll(null);
      } catch (err) {
        if (isOutcomeUnknown(err)) {
          // confirm-line adds to picked_qty, so a blind retry could pick the line twice.
          // Reload the task: if the line moved on, the pick was recorded.
          const before = line.picked_qty;
          await load();
          setSubmitError(
            `Chưa rõ lần xác nhận vừa rồi đã được ghi nhận chưa (trước đó đã lấy ${before}/${line.requested_qty}). ` +
              'Đã tải lại phiếu — kiểm tra số "đã lấy" trước khi xác nhận lại.',
          );
        } else {
          setSubmitError(err instanceof ApiError ? err.message : 'Xác nhận thất bại');
        }
      } finally {
        setIsSubmitting(false);
      }
    });
  }

  if (isLoading) {
    return (<><ScreenHeader title="Quét hàng" /><Screen scroll={false}><LoadingState label="Đang mở phiếu…" /></Screen></>);
  }

  if (loadError || !task) {
    return (<><ScreenHeader title="Quét hàng" /><Screen scroll={false}><ErrorState title={loadError ?? 'Không tìm thấy phiếu'} onRetry={() => { setIsLoading(true); void load().finally(() => setIsLoading(false)); }} /></Screen></>);
  }

  if (!task.current_line) {
    return (
      <>
        <ScreenHeader title="Quét hàng" />
        <Screen scroll={false}>
          <EmptyState icon="checkmark-done-circle" title="Đã lấy xong" message="Tất cả sản phẩm trong phiếu này đã được lấy." actionLabel="Về danh sách phiếu" onAction={() => router.replace('/picking')} />
        </Screen>
      </>
    );
  }

  const line = task.current_line;

  return (
    <>
      <ScreenHeader title={task.order_number} />
      <Screen
        footer={locationVerified && productVerified ? (
          <Button label="Xác nhận đã lấy" icon="checkmark-circle" loading={isSubmitting} loadingLabel="Đang xác nhận…" onPress={handleConfirm} />
        ) : null}
      >
        <View style={{ gap: space.md }}>
          <StepIndicator steps={STEPS} current={!locationVerified ? 0 : !productVerified ? 1 : 2} />
          <Text style={type.caption}>Đã lấy {line.picked_qty}/{line.requested_qty} cho dòng này</Text>
        </View>

        <ScanStep n={1} title="Đến đúng vị trí" done={locationVerified}>
          <View style={{ padding: space.md, borderRadius: radii.sm, backgroundColor: colors.inkField, gap: 2 }}>
            <Text style={{ fontFamily: fontFamily.medium, fontSize: 13, color: colors.onInkMuted }}>Mã vị trí</Text>
            <Text selectable style={{ fontFamily: fontFamily.monoBold, fontSize: 24, color: colors.onInk, letterSpacing: 1 }}>
              {line.source_location_code ?? '(chưa xác định)'}
            </Text>
          </View>
          <ScanField
            value={locationInput}
            onChangeText={handleLocationChange}
            onSubmit={handleLocationSubmit}
            placeholder="Quét hoặc nhập mã vị trí"
            autoFocus
          />
          {locationMessage ? (
            <StampBadge text={locationMessage.text} tone={locationMessage.ok ? 'success' : 'danger'} />
          ) : null}
        </ScanStep>

        {locationVerified && (
          <ScanStep n={2} title="Quét đúng sản phẩm" done={productVerified}>
            <View style={{ padding: space.md, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised, gap: 4 }}>
              <Text style={{ fontFamily: fontFamily.semibold, fontSize: 16, lineHeight: 22, color: colors.textPrimary }}>{line.book_title}</Text>
              <Text selectable style={{ fontFamily: fontFamily.mono, fontSize: 13.5, color: colors.textSecondary }}>
                SKU {line.sku ?? '—'}  ·  Mã {line.barcode ?? '—'}
              </Text>
              <Text style={type.caption}>Cần lấy {line.remaining_qty}</Text>
            </View>
            <ScanField
              value={productInput}
              onChangeText={handleProductChange}
              onSubmit={handleProductSubmit}
              placeholder="Quét hoặc nhập mã sản phẩm"
              autoFocus
            />
            {isLookingUpProduct ? <LoadingState label="Đang tra mã sản phẩm…" /> : null}
            {productMessage ? (
              <StampBadge text={productMessage.text} tone={productMessage.ok ? 'success' : 'danger'} />
            ) : null}

            {ambiguousMatches.length > 0 && (
              <View style={{ gap: space.sm }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.textPrimary }}>Chọn đúng sản phẩm</Text>
                {ambiguousMatches.map((match) => {
                  const code = match.sku ?? match.internal_barcode ?? match.isbn13 ?? match.isbn10;
                  return (
                    <PressableScale
                      key={match.variant_id}
                      onPress={() => handleSelectAmbiguous(match)}
                      accessibilityRole="button"
                      accessibilityLabel={`${match.book_title}, mã ${code ?? 'không có'}`}
                      style={{ minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoft }}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ fontFamily: fontFamily.medium, fontSize: 15, color: colors.textPrimary }} numberOfLines={2}>{match.book_title}</Text>
                        <Text style={{ fontFamily: fontFamily.mono, fontSize: 13, color: colors.textSecondary }}>{code ?? '—'}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </PressableScale>
                  );
                })}
              </View>
            )}
          </ScanStep>
        )}

        {locationVerified && productVerified && (
          <ScanStep n={3} title="Nhập số lượng đã lấy" done={false}>
            <TextField
              mono
              keyboardType="number-pad"
              value={quantity}
              onChangeText={(text) => setQuantity(sanitizeQuantityInput(text))}
              accessibilityLabel="Số lượng đã lấy"
              hint={`Tối đa ${line.remaining_qty}`}
              maxLength={6}
            />
            {submitError ? <InlineAlert message={submitError} /> : null}
          </ScanStep>
        )}
      </Screen>
    </>
  );
}
