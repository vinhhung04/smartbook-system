import { useCallback, useEffect, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import * as putawayApi from '../../../src/api/putaway';
import { ApiError } from '../../../src/auth/auth-context';
import { notifyScanError, notifyScanSuccess } from '../../../src/scanner/haptics';
import { ScanField } from '../../../src/scanner/ScanField';
import { StampBadge } from '../../../src/components/StampBadge';
import type { CompartmentCandidate, PutawayReceiptDetail, PutawayReceiptItem } from '../../../src/types/putaway';
import { colors, fonts, radius, shadow, spacing, typography } from '../../../src/theme/tokens';

/**
 * Putaway locked to one goods receipt — the mobile counterpart of the web app's
 * putaway-detail → locked receiving-putaway flow. Unlike putting away any SKU sitting in a
 * receiving bin regardless of which receipt it came from, this screen only offers this
 * receipt's own lines and passes goods_receipt_id through on confirm, so the receipt's own
 * remaining_quantity tracks what was actually put
 * away instead of staying stuck at "chưa cất" forever.
 */
export default function PutawayReceiptScreen() {
  const { receiptId } = useLocalSearchParams<{ receiptId: string }>();

  const [detail, setDetail] = useState<PutawayReceiptDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedItem, setSelectedItem] = useState<PutawayReceiptItem | null>(null);
  const [sourceReceiving, setSourceReceiving] = useState<{ id: string; location_code: string } | null>(null);
  const [candidates, setCandidates] = useState<CompartmentCandidate[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);

  const [locationInput, setLocationInput] = useState('');
  const [resolvedLocation, setResolvedLocation] = useState<{ id: string; location_code: string } | null>(null);
  const [locationMessage, setLocationMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [quantity, setQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await putawayApi.getReceiptDetail(receiptId);
      setDetail(result);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Không tải được phiếu nhập');
    }
  }, [receiptId]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  function resetSelection() {
    setSelectedItem(null);
    setSourceReceiving(null);
    setCandidates([]);
    setLocationInput('');
    setResolvedLocation(null);
    setLocationMessage(null);
    setQuantity('');
    setSubmitError(null);
  }

  async function selectItem(item: PutawayReceiptItem) {
    if (!detail) return;
    setSelectedItem(item);
    setSourceReceiving(null);
    setLocationInput('');
    setResolvedLocation(null);
    setLocationMessage(null);
    setSubmitError(null);
    setQuantity(String(item.remaining_quantity));
    setIsLoadingCandidates(true);
    try {
      const { receivings } = await putawayApi.getWarehouseReceivings(detail.warehouse_id);
      const receiving = receivings[0];
      if (!receiving) {
        setSubmitError('Kho này chưa có khu vực chờ cất (RECEIVING), liên hệ quản lý kho.');
        return;
      }
      setSourceReceiving({ id: receiving.id, location_code: receiving.location_code });
      const result = await putawayApi.getCandidates(receiving.id, item.variant_id);
      setCandidates(result.candidates);
    } catch (err) {
      setLocationMessage({ text: err instanceof ApiError ? err.message : 'Không lấy được gợi ý vị trí', ok: false });
    } finally {
      setIsLoadingCandidates(false);
    }
  }

  async function handleScanLocation(value: string) {
    const code = value.trim();
    if (!code || !detail) return;
    setLocationMessage(null);
    try {
      const location = await putawayApi.lookupLocationByBarcode(detail.warehouse_id, code);
      notifyScanSuccess();
      setResolvedLocation(location);
      setLocationMessage({ text: `Đúng vị trí: ${location.location_code}`, ok: true });
    } catch (err) {
      notifyScanError();
      setResolvedLocation(null);
      setLocationMessage({ text: err instanceof ApiError ? err.message : 'Sai vị trí', ok: false });
    }
  }

  async function handleConfirm() {
    if (!selectedItem || !sourceReceiving || !resolvedLocation || !detail) return;
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setSubmitError('Số lượng phải lớn hơn 0');
      return;
    }
    if (qty > selectedItem.remaining_quantity) {
      setSubmitError(`Số lượng không được vượt quá ${selectedItem.remaining_quantity} (còn lại của phiếu này)`);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await putawayApi.transferToShelf({
        warehouse_id: detail.warehouse_id,
        source_receiving_location_id: sourceReceiving.id,
        variant_id: selectedItem.variant_id,
        goods_receipt_id: detail.id,
        allocations: [
          {
            target_location_id: resolvedLocation.id,
            quantity: qty,
            reason: 'Putaway qua mobile app',
            scanned_location_barcode: locationInput.trim() || undefined,
          },
        ],
      });

      notifyScanSuccess();
      setSubmitError(null);
      resetSelection();
      await load();
      setLocationMessage({ text: `Đã chuyển ${result.data.moved_quantity} sản phẩm vào ${resolvedLocation.location_code}.`, ok: true });
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

  if (loadError || !detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{loadError || 'Không tìm thấy phiếu'}</Text>
      </View>
    );
  }

  const remainingItems = detail.items.filter((item) => item.remaining_quantity > 0);
  const topCandidate = candidates[0] ?? null;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: detail.receipt_number }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>{detail.receipt_number}</Text>
          <Text style={styles.headerSubtitle}>
            {detail.warehouse_code ?? '-'} · còn {detail.remaining_quantity}/{detail.total_quantity} sản phẩm
          </Text>
        </View>

        <View style={styles.stepCard}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>1</Text>
            </View>
            <Text style={styles.stepLabel}>Chọn dòng cần cất của phiếu này</Text>
          </View>
          {remainingItems.length === 0 ? (
            <StampBadge text="Phiếu này đã cất hết lên kệ." tone="success" />
          ) : (
            <View style={styles.itemList}>
              {remainingItems.map((item) => (
                <Pressable
                  key={item.id}
                  style={({ pressed }) => [
                    styles.itemRow,
                    selectedItem?.id === item.id && styles.itemRowSelected,
                    pressed && styles.rowPressed,
                  ]}
                  onPress={() => selectItem(item)}
                >
                  <View style={styles.itemBody}>
                    <Text style={styles.itemTitle}>{item.book_title}</Text>
                    <Text style={styles.itemMeta}>Còn lại: {item.remaining_quantity}/{item.quantity}</Text>
                  </View>
                  <Text style={styles.itemQty}>{item.remaining_quantity}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {selectedItem && (
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>2</Text>
              </View>
              <Text style={styles.stepLabel}>Vị trí gợi ý</Text>
            </View>
            {sourceReceiving ? (
              <Text style={styles.itemMeta}>Lấy từ khu chờ cất: {sourceReceiving.location_code}</Text>
            ) : null}
            {isLoadingCandidates ? (
              <ActivityIndicator color={colors.primary} />
            ) : topCandidate ? (
              <View style={styles.infoBox}>
                <Text style={styles.infoValue}>{topCandidate.location_code}</Text>
                <Text style={styles.infoLabel}>
                  Kệ {topCandidate.shelf_code} · Khu {topCandidate.zone_code} · còn trống {topCandidate.remaining_capacity}
                </Text>
              </View>
            ) : (
              <Text style={styles.error}>Không tìm được vị trí trống phù hợp</Text>
            )}

            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>3</Text>
              </View>
              <Text style={styles.stepLabel}>Quét mã vị trí đã đến</Text>
            </View>
            <ScanField
              value={locationInput}
              onChangeText={(text) => {
                setLocationInput(text);
                setResolvedLocation(null);
                setLocationMessage(null);
              }}
              onSubmit={handleScanLocation}
              placeholder="Quét hoặc nhập mã vị trí"
            />
            {locationMessage ? (
              <StampBadge text={locationMessage.text} tone={locationMessage.ok ? 'success' : 'danger'} />
            ) : null}
          </View>
        )}

        {selectedItem && resolvedLocation && (
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>4</Text>
              </View>
              <Text style={styles.stepLabel}>Số lượng cất</Text>
            </View>
            <TextInput style={styles.input} keyboardType="number-pad" value={quantity} onChangeText={setQuantity} />
            {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.confirmButton, (isSubmitting || pressed) && styles.buttonDisabled]}
              onPress={handleConfirm}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color={colors.onPrimary} />
              ) : (
                <Text style={styles.confirmButtonText}>Xác nhận cất hàng</Text>
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
    ...typography.code,
    color: colors.danger,
    fontSize: 13,
  },
  headerCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    gap: 2,
    ...shadow.card,
  },
  headerTitle: {
    ...typography.h3,
  },
  headerSubtitle: {
    ...typography.caption,
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
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    color: colors.onPrimary,
    fontFamily: fonts.monoSemibold,
    fontSize: 13,
  },
  stepLabel: {
    ...typography.h3,
  },
  itemList: {
    gap: spacing.xs + 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  rowPressed: {
    opacity: 0.7,
  },
  itemBody: {
    flex: 1,
    marginRight: spacing.sm,
  },
  itemTitle: {
    color: colors.textPrimary,
  },
  itemMeta: {
    ...typography.caption,
    marginTop: 2,
  },
  itemQty: {
    ...typography.code,
    color: colors.textSecondary,
    fontSize: 14,
  },
  infoBox: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 2,
  },
  infoLabel: {
    ...typography.code,
    fontSize: 12,
    color: colors.textSecondary,
  },
  infoValue: {
    ...typography.code,
    fontSize: 17,
    color: colors.primary,
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
  buttonDisabled: {
    opacity: 0.6,
  },
  confirmButtonText: {
    fontFamily: fonts.displayBold,
    color: colors.onPrimary,
    fontSize: 16,
    letterSpacing: 0.5,
  },
});
