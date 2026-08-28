import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import * as pickingApi from '../../../../src/api/picking';
import { ApiError } from '../../../../src/auth/auth-context';
import { notifyScanError, notifyScanSuccess } from '../../../../src/scanner/haptics';
import { matchesCode } from '../../../../src/scanner/matching';
import { ScanField } from '../../../../src/scanner/ScanField';
import type { PickingLine, PickingTaskDetail, PickingTaskType, VariantMatch } from '../../../../src/types/picking';
import { colors, radius, shadow, spacing, typography } from '../../../../src/theme/tokens';

export default function ScanScreen() {
  const { taskType, taskId } = useLocalSearchParams<{ taskType: PickingTaskType; taskId: string }>();
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

  // Step 3: quantity + submit.
  const [quantity, setQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

    setIsLookingUpProduct(true);
    setProductMessage(null);
    setAmbiguousMatches([]);
    try {
      const result = await pickingApi.lookupVariantByBarcode(barcode);

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
      notifyScanError();
      setProductVerified(false);
      setProductMessage({ text: err instanceof ApiError ? err.message : 'Không tra được mã sản phẩm', ok: false });
    } finally {
      setIsLookingUpProduct(false);
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
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setSubmitError('Số lượng phải lớn hơn 0');
      return;
    }
    if (qty > line.remaining_qty) {
      setSubmitError(`Số lượng không được vượt quá ${line.remaining_qty}`);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await pickingApi.confirmLine(taskType, taskId, line.line_id, {
        quantity: qty,
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
      setSubmitError(err instanceof ApiError ? err.message : 'Xác nhận thất bại');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (loadError || !task) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{loadError ?? 'Không tìm thấy phiếu'}</Text>
      </View>
    );
  }

  if (!task.current_line) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Quét hàng' }} />
        <View style={styles.center}>
          <View style={styles.doneBox}>
            <Text style={styles.done}>Đã lấy xong tất cả sản phẩm trong phiếu này.</Text>
          </View>
        </View>
      </>
    );
  }

  const line = task.current_line;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: task.order_number }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.stepCard}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>1</Text>
            </View>
            <Text style={styles.stepLabel}>Vị trí cần đến</Text>
          </View>
          <View style={styles.infoBox}>
            <Text style={styles.infoLabel}>Mã vị trí</Text>
            <Text style={styles.infoValue}>{line.source_location_code ?? '(chưa xác định)'}</Text>
          </View>
          <ScanField
            value={locationInput}
            onChangeText={handleLocationChange}
            onSubmit={handleLocationSubmit}
            placeholder="Quét hoặc nhập mã vị trí"
            autoFocus
          />
          {locationMessage ? (
            <Text style={locationMessage.ok ? styles.success : styles.error}>{locationMessage.text}</Text>
          ) : null}
        </View>

        {locationVerified && (
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>2</Text>
              </View>
              <Text style={styles.stepLabel}>Sản phẩm cần lấy</Text>
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.infoValueBold}>{line.book_title}</Text>
              <Text style={styles.infoLabel}>
                SKU: {line.sku ?? '-'} · Mã: {line.barcode ?? '-'}
              </Text>
              <Text style={styles.infoLabel}>
                Cần lấy: {line.remaining_qty} (đã lấy {line.picked_qty}/{line.requested_qty})
              </Text>
            </View>
            <ScanField
              value={productInput}
              onChangeText={handleProductChange}
              onSubmit={handleProductSubmit}
              placeholder="Quét hoặc nhập mã sản phẩm"
              autoFocus
            />
            {isLookingUpProduct ? <ActivityIndicator color={colors.primary} /> : null}
            {productMessage ? (
              <Text style={productMessage.ok ? styles.success : styles.error}>{productMessage.text}</Text>
            ) : null}

            {ambiguousMatches.length > 0 && (
              <View style={styles.ambiguousBox}>
                <Text style={styles.infoLabel}>Chọn đúng sản phẩm:</Text>
                {ambiguousMatches.map((match) => (
                  <Pressable
                    key={match.variant_id}
                    style={({ pressed }) => [styles.ambiguousItem, pressed && styles.buttonPressed]}
                    onPress={() => handleSelectAmbiguous(match)}
                  >
                    <Text style={styles.ambiguousText}>
                      {match.sku ?? match.internal_barcode ?? match.isbn13 ?? match.isbn10} · {match.book_title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {locationVerified && productVerified && (
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>3</Text>
              </View>
              <Text style={styles.stepLabel}>Số lượng</Text>
            </View>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={quantity}
              onChangeText={setQuantity}
            />
            {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.confirmButton, (isSubmitting || pressed) && styles.buttonDisabled]}
              onPress={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.confirmButtonText}>Xác nhận đã lấy</Text>
              )}
            </Pressable>
          </View>
        )}
      </ScrollView>
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
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  success: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '600',
  },
  doneBox: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  done: {
    color: colors.success,
    fontWeight: '600',
    textAlign: 'center',
  },
  stepCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: spacing.sm + 2,
    ...shadow.card,
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  stepLabel: {
    ...typography.h3,
  },
  infoBox: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  infoLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  infoValueBold: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  ambiguousBox: {
    gap: spacing.xs + 2,
  },
  ambiguousItem: {
    borderWidth: 1,
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
  },
  ambiguousText: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  confirmButton: {
    backgroundColor: colors.success,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
});
