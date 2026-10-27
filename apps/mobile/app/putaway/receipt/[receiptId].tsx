import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import * as putawayApi from '../../../src/api/putaway';
import { isOutcomeUnknown } from '../../../src/api/client';
import { ApiError, useAuth } from '../../../src/auth/auth-context';
import { isWarehouseManager } from '../../../src/auth/access';
import { notifyScanError, notifyScanSuccess } from '../../../src/scanner/haptics';
import { ScanField } from '../../../src/scanner/ScanField';
import { StampBadge } from '../../../src/components/StampBadge';
import { SelectionSheet } from '../../../src/components/SelectionSheet';
import { createIdempotencyKey } from '../../../src/lib/idempotency';
import { putawayLimit, sourcesHoldingVariant, type SourceOption } from '../../../src/lib/putawayPlan';
import { parseWholeQuantity, sanitizeQuantityInput } from '../../../src/lib/quantity';
import { useSubmitLock } from '../../../src/lib/submitLock';
import type { CompartmentCandidate, PutawayReceiptDetail, PutawayReceiptItem } from '../../../src/types/putaway';
import { colors, fonts, radius, shadow, spacing, typography } from '../../../src/theme/tokens';

const VISIBLE_CANDIDATES = 4;

/**
 * Putaway locked to one goods receipt — the mobile counterpart of the web app's
 * putaway-detail → locked receiving-putaway flow. Only this receipt's own lines are
 * offered and goods_receipt_id is passed on confirm, so the receipt's remaining_quantity
 * tracks what was actually put away. Everything is re-derived from the server on open,
 * so leaving and coming back resumes exactly where the receipt stands.
 */
export default function PutawayReceiptScreen() {
  const { receiptId } = useLocalSearchParams<{ receiptId: string }>();
  const { user } = useAuth();

  const [detail, setDetail] = useState<PutawayReceiptDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedItem, setSelectedItem] = useState<PutawayReceiptItem | null>(null);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [source, setSource] = useState<SourceOption | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [candidates, setCandidates] = useState<CompartmentCandidate[]>([]);
  const [showAllCandidates, setShowAllCandidates] = useState(false);
  const [plannedTarget, setPlannedTarget] = useState<CompartmentCandidate | null>(null);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const [locationInput, setLocationInput] = useState('');
  const [resolvedLocation, setResolvedLocation] = useState<{ id: string; location_code: string } | null>(null);
  const [locationMessage, setLocationMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [quantity, setQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const submitLock = useSubmitLock();
  // Reused while the same putaway is retried after an unknown outcome, so the server
  // can recognise the repeat; replaced once anything about the putaway changes.
  const attemptKeyRef = useRef<string | null>(null);
  const selectionRequestRef = useRef(0);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await putawayApi.getReceiptDetail(receiptId);
      setDetail(result);
      return result;
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Không tải được phiếu nhập');
      return null;
    }
  }, [receiptId]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  function resetSelection() {
    selectionRequestRef.current += 1;
    attemptKeyRef.current = null;
    setSelectedItem(null);
    setSources([]);
    setSource(null);
    setCandidates([]);
    setPlannedTarget(null);
    setShowAllCandidates(false);
    setStepError(null);
    setLocationInput('');
    setResolvedLocation(null);
    setLocationMessage(null);
    setQuantity('');
    setSubmitError(null);
  }

  async function loadCandidatesFor(item: PutawayReceiptItem, chosen: SourceOption, requestId: number) {
    setSource(chosen);
    setIsLoadingCandidates(true);
    try {
      const result = await putawayApi.getCandidates(chosen.id, item.variant_id);
      if (requestId !== selectionRequestRef.current) return;
      setCandidates(result.candidates);
      setPlannedTarget(result.candidates[0] ?? null);
    } catch (err) {
      if (requestId !== selectionRequestRef.current) return;
      setStepError(err instanceof ApiError ? err.message : 'Không lấy được gợi ý vị trí');
    } finally {
      if (requestId === selectionRequestRef.current) setIsLoadingCandidates(false);
    }
  }

  async function selectItem(item: PutawayReceiptItem) {
    if (!detail) return;
    resetSelection();
    const requestId = selectionRequestRef.current;
    setSelectedItem(item);
    setQuantity(String(item.remaining_quantity));
    setIsLoadingCandidates(true);
    try {
      const { receivings } = await putawayApi.getWarehouseReceivings(detail.warehouse_id);
      if (receivings.length === 0) {
        setStepError('Kho này chưa có khu vực chờ cất (RECEIVING), liên hệ quản lý kho.');
        return;
      }
      const stock = await Promise.all(
        receivings.map(async (receiving) => ({
          ...receiving,
          items: (await putawayApi.getReceivingItems(receiving.id)).items,
        })),
      );
      if (requestId !== selectionRequestRef.current) return;
      const holding = sourcesHoldingVariant(stock, item.variant_id);
      if (holding.length === 0) {
        setStepError('Không thấy sách này ở khu chờ cất của kho. Có thể hàng chưa được nhập vào khu chờ — liên hệ quản lý kho.');
        return;
      }
      setSources(holding);
      if (holding.length > 1) {
        // Two receiving bins both hold this edition: the staff member knows which pile
        // they are standing at; the app must not pick one for them.
        setSourcePickerOpen(true);
        return;
      }
      await loadCandidatesFor(item, holding[0], requestId);
    } catch (err) {
      if (requestId !== selectionRequestRef.current) return;
      setStepError(err instanceof ApiError ? err.message : 'Không lấy được khu chờ cất');
    } finally {
      if (requestId === selectionRequestRef.current) setIsLoadingCandidates(false);
    }
  }

  async function handleScanLocation(value: string) {
    const code = value.trim();
    if (!code || !detail) return;
    setLocationMessage(null);
    attemptKeyRef.current = null;
    try {
      const location = await putawayApi.lookupLocationByBarcode(detail.warehouse_id, code);
      notifyScanSuccess();
      setResolvedLocation(location);
      const known = candidates.find((c) => c.id === location.id);
      if (known) setPlannedTarget(known);
      setLocationMessage({
        text: known
          ? `Đúng vị trí: ${location.location_code} · còn trống ${known.remaining_capacity}`
          : `Vị trí ${location.location_code} không nằm trong gợi ý — sức chứa sẽ được kiểm tra khi xác nhận.`,
        ok: true,
      });
    } catch (err) {
      notifyScanError();
      setResolvedLocation(null);
      setLocationMessage({ text: err instanceof ApiError ? err.message : 'Sai vị trí', ok: false });
    }
  }

  const scannedCandidate = resolvedLocation ? candidates.find((c) => c.id === resolvedLocation.id) ?? null : null;
  const limit = selectedItem ? putawayLimit(selectedItem.remaining_quantity, source?.available ?? null, scannedCandidate) : null;

  async function handleConfirm() {
    if (!selectedItem || !source || !resolvedLocation || !detail || !limit) return;
    const parsed = parseWholeQuantity(quantity, { max: limit.max, maxLabel: limit.reason });
    if (!parsed.ok) {
      setSubmitError(parsed.error);
      return;
    }

    await submitLock.run(async () => {
      setIsSubmitting(true);
      setSubmitError(null);
      const idempotencyKey = attemptKeyRef.current ?? createIdempotencyKey('putaway');
      attemptKeyRef.current = idempotencyKey;
      try {
        const result = await putawayApi.transferToShelf({
          warehouse_id: detail.warehouse_id,
          source_receiving_location_id: source.id,
          variant_id: selectedItem.variant_id,
          goods_receipt_id: detail.id,
          idempotency_key: idempotencyKey,
          allocations: [
            {
              target_location_id: resolvedLocation.id,
              quantity: parsed.value,
              reason: 'Putaway qua mobile app',
              scanned_location_barcode: locationInput.trim() || undefined,
            },
          ],
        });

        notifyScanSuccess();
        const targetCode = resolvedLocation.location_code;
        resetSelection();
        await load();
        setLocationMessage({ text: `Đã chuyển ${result.data.moved_quantity} sản phẩm vào ${targetCode}.`, ok: true });
      } catch (err) {
        if (isOutcomeUnknown(err)) {
          // Same key on the next tap: if the first one landed the server answers
          // "already applied" instead of moving the stock again.
          setSubmitError('Chưa rõ thao tác đã được ghi nhận chưa. Nhấn "Xác nhận cất hàng" lần nữa để kiểm tra — hệ thống sẽ không cất trùng.');
        } else {
          attemptKeyRef.current = null;
          setSubmitError(err instanceof ApiError ? err.message : 'Xác nhận thất bại');
        }
      } finally {
        setIsSubmitting(false);
      }
    });
  }

  async function handleClaim() {
    if (!detail || isClaiming) return;
    setIsClaiming(true);
    try {
      await putawayApi.claimReceipt(detail.id);
      await load();
    } catch (err) {
      setLoadError(null);
      setStepError(err instanceof ApiError ? err.message : 'Nhận phiếu thất bại');
    } finally {
      setIsClaiming(false);
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
        <Pressable style={styles.linkButton} onPress={() => { setIsLoading(true); load().finally(() => setIsLoading(false)); }} accessibilityRole="button">
          <Text style={styles.linkText}>Thử lại</Text>
        </Pressable>
      </View>
    );
  }

  const remainingItems = detail.items.filter((item) => item.remaining_quantity > 0);
  const assignee = detail.putaway_assignee_user_id;
  const assignedToOther = Boolean(assignee && assignee !== user?.id);
  const visibleCandidates = showAllCandidates ? candidates : candidates.slice(0, VISIBLE_CANDIDATES);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: detail.receipt_number }} />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>{detail.receipt_number}</Text>
          <Text style={styles.headerSubtitle}>
            {detail.warehouse_code ?? '-'} · còn {detail.remaining_quantity}/{detail.total_quantity} sản phẩm
          </Text>
          {assignee === null && remainingItems.length > 0 ? (
            <Pressable style={styles.claimButton} onPress={handleClaim} disabled={isClaiming} accessibilityRole="button">
              {isClaiming ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.linkText}>Nhận phiếu này để người khác không làm trùng</Text>}
            </Pressable>
          ) : null}
          {assignedToOther ? (
            <StampBadge
              text={isWarehouseManager(user) ? 'Phiếu đang giao cho nhân viên khác — bạn thao tác với quyền quản lý.' : 'Phiếu đã giao cho nhân viên khác.'}
              tone="warning"
            />
          ) : null}
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
                  accessibilityRole="button"
                  accessibilityState={{ selected: selectedItem?.id === item.id }}
                >
                  <View style={styles.itemBody}>
                    <Text style={styles.itemTitle}>{item.book_title}</Text>
                    <Text style={styles.itemMeta}>
                      Còn lại: {item.remaining_quantity}/{item.quantity}
                      {item.isbn13 ? ` · ISBN ${item.isbn13}` : ''}
                    </Text>
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
            {source ? (
              <Pressable
                onPress={() => sources.length > 1 && setSourcePickerOpen(true)}
                disabled={sources.length <= 1}
                accessibilityRole={sources.length > 1 ? 'button' : undefined}
              >
                <Text style={styles.itemMeta}>
                  Lấy từ khu chờ cất: {source.location_code} (đang có {source.available})
                  {sources.length > 1 ? ' · Đổi khu' : ''}
                </Text>
              </Pressable>
            ) : null}
            {stepError ? <Text style={styles.error}>{stepError}</Text> : null}
            {isLoadingCandidates ? (
              <ActivityIndicator color={colors.primary} />
            ) : source && candidates.length === 0 && !stepError ? (
              <Text style={styles.error}>Không tìm được vị trí trống phù hợp — liên hệ quản lý kho để mở thêm vị trí.</Text>
            ) : (
              <View style={styles.itemList}>
                {visibleCandidates.map((candidate, index) => {
                  const planned = plannedTarget?.id === candidate.id;
                  return (
                    <Pressable
                      key={candidate.id}
                      style={({ pressed }) => [styles.candidateRow, planned && styles.itemRowSelected, pressed && styles.rowPressed]}
                      onPress={() => {
                        setPlannedTarget(candidate);
                        attemptKeyRef.current = null;
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: planned }}
                      accessibilityLabel={`Vị trí ${candidate.location_code}, còn trống ${candidate.remaining_capacity}`}
                    >
                      <View style={styles.itemBody}>
                        <Text style={styles.infoValue}>
                          {candidate.location_code}
                          {index === 0 ? <Text style={styles.bestTag}>  GỢI Ý TỐT NHẤT</Text> : null}
                        </Text>
                        <Text style={styles.infoLabel}>
                          Kệ {candidate.shelf_code} · Khu {candidate.zone_code}
                          {candidate.mixed_sku_count > 0 ? ` · đang chứa ${candidate.mixed_sku_count} đầu sách khác` : ''}
                        </Text>
                      </View>
                      <View style={styles.capacityBox}>
                        <Text style={styles.capacityValue}>{candidate.remaining_capacity}</Text>
                        <Text style={styles.capacityLabel}>còn trống</Text>
                      </View>
                    </Pressable>
                  );
                })}
                {candidates.length > VISIBLE_CANDIDATES ? (
                  <Pressable style={styles.linkButton} onPress={() => setShowAllCandidates((v) => !v)} accessibilityRole="button">
                    <Text style={styles.linkText}>
                      {showAllCandidates ? 'Thu gọn' : `Xem thêm ${candidates.length - VISIBLE_CANDIDATES} vị trí`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            {source ? (
              <>
                <View style={styles.stepHeader}>
                  <View style={styles.stepBadge}>
                    <Text style={styles.stepBadgeText}>3</Text>
                  </View>
                  <Text style={styles.stepLabel}>
                    Quét mã vị trí đã đến{plannedTarget ? ` (${plannedTarget.location_code})` : ''}
                  </Text>
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
              </>
            ) : null}
            {locationMessage ? (
              <StampBadge text={locationMessage.text} tone={locationMessage.ok ? 'success' : 'danger'} />
            ) : null}
          </View>
        )}

        {!selectedItem && locationMessage ? <StampBadge text={locationMessage.text} tone={locationMessage.ok ? 'success' : 'danger'} /> : null}

        {selectedItem && resolvedLocation && limit && (
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>4</Text>
              </View>
              <Text style={styles.stepLabel}>Số lượng cất</Text>
            </View>
            <Text style={styles.itemMeta}>Tối đa {limit.max} ({limit.reason})</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={quantity}
              onChangeText={(text) => {
                setQuantity(sanitizeQuantityInput(text));
                attemptKeyRef.current = null;
              }}
              maxLength={6}
              accessibilityLabel="Số lượng cất lên kệ"
            />
            {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.confirmButton, (isSubmitting || pressed) && styles.buttonDisabled]}
              onPress={handleConfirm}
              disabled={isSubmitting}
              accessibilityRole="button"
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
      </KeyboardAvoidingView>

      <SelectionSheet
        visible={sourcePickerOpen}
        title="Sách này có ở nhiều khu chờ cất — bạn lấy từ khu nào?"
        options={sources.map((s) => ({ id: s.id, title: s.location_code, subtitle: `${s.location_type} · đang có ${s.available}` }))}
        selectedId={source?.id}
        onSelect={(option) => {
          setSourcePickerOpen(false);
          const chosen = sources.find((s) => s.id === option.id);
          if (chosen && selectedItem) {
            attemptKeyRef.current = null;
            setResolvedLocation(null);
            setLocationMessage(null);
            void loadCandidatesFor(selectedItem, chosen, selectionRequestRef.current);
          }
        }}
        onClose={() => setSourcePickerOpen(false)}
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
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bestTag: {
    fontFamily: fonts.monoSemibold,
    fontSize: 10,
    color: colors.success,
    letterSpacing: 0.5,
  },
  capacityBox: {
    alignItems: 'center',
    minWidth: 64,
  },
  capacityValue: {
    ...typography.code,
    fontSize: 18,
    color: colors.textPrimary,
  },
  capacityLabel: {
    ...typography.caption,
    fontSize: 11,
  },
  claimButton: {
    marginTop: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  linkButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  linkText: {
    color: colors.primary,
    fontFamily: fonts.bodySemibold,
  },
});
