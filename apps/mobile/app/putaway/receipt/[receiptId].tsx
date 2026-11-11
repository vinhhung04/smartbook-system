import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as putawayApi from '../../../src/api/putaway';
import { isOutcomeUnknown } from '../../../src/api/client';
import { ApiError, useAuth } from '../../../src/auth/auth-context';
import { isWarehouseManager } from '../../../src/auth/access';
import { notifyScanError, notifyScanSuccess } from '../../../src/scanner/haptics';
import { ScanField } from '../../../src/scanner/ScanField';
import { ScanStep } from '../../../src/components/ScanStep';
import { StampBadge } from '../../../src/components/StampBadge';
import { SelectionSheet } from '../../../src/components/SelectionSheet';
import { createIdempotencyKey } from '../../../src/lib/idempotency';
import { putawayLimit, sourcesHoldingVariant, type SourceOption } from '../../../src/lib/putawayPlan';
import { parseWholeQuantity, sanitizeQuantityInput } from '../../../src/lib/quantity';
import { useSubmitLock } from '../../../src/lib/submitLock';
import type { CompartmentCandidate, PutawayReceiptDetail, PutawayReceiptItem } from '../../../src/types/putaway';
import {
  Button, ErrorState, InlineAlert, LoadingState, ProgressBar, Screen, ScreenHeader, StatusBadge, TextField, fontFamily, radii, space, useTheme,
} from '../../../src/design-system';

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
  const { colors, type } = useTheme();

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
    return (<><ScreenHeader title="Cất hàng" /><Screen scroll={false}><LoadingState label="Đang mở phiếu nhập…" /></Screen></>);
  }

  if (loadError || !detail) {
    return (
      <>
        <ScreenHeader title="Cất hàng" />
        <Screen scroll={false}>
          <ErrorState title={loadError || 'Không tìm thấy phiếu'} onRetry={() => { setIsLoading(true); load().finally(() => setIsLoading(false)); }} />
        </Screen>
      </>
    );
  }

  const remainingItems = detail.items.filter((item) => item.remaining_quantity > 0);
  const assignee = detail.putaway_assignee_user_id;
  const assignedToOther = Boolean(assignee && assignee !== user?.id);
  const visibleCandidates = showAllCandidates ? candidates : candidates.slice(0, VISIBLE_CANDIDATES);

  const putAwayQty = detail.total_quantity - detail.remaining_quantity;
  const canConfirm = Boolean(selectedItem && resolvedLocation && limit);

  return (
    <>
      <ScreenHeader title={detail.receipt_number} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen
          footer={canConfirm ? (
            <Button label="Xác nhận cất hàng" icon="checkmark-circle" loading={isSubmitting} loadingLabel="Đang cất…" onPress={handleConfirm} />
          ) : null}
        >
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              <StatusBadge tone="neutral" label={`Kho ${detail.warehouse_code ?? '—'}`} icon="business-outline" />
              {assignee === user?.id ? <StatusBadge tone="primary" label="Bạn đã nhận" icon="person" /> : null}
            </View>
            <ProgressBar value={detail.total_quantity > 0 ? putAwayQty / detail.total_quantity : 0} tone={detail.remaining_quantity > 0 ? 'primary' : 'success'} accessibilityLabel="Tiến độ cất hàng" />
            <Text style={type.caption}>Đã cất {putAwayQty}/{detail.total_quantity}, còn {detail.remaining_quantity} sản phẩm</Text>
          </View>

          {assignee === null && remainingItems.length > 0 ? (
            <Button label="Nhận phiếu này" icon="hand-left-outline" variant="secondary" loading={isClaiming} loadingLabel="Đang nhận…" onPress={handleClaim} accessibilityHint="Để người khác không làm trùng" />
          ) : null}
          {assignedToOther ? (
            <StampBadge
              text={isWarehouseManager(user) ? 'Phiếu đang giao cho nhân viên khác — bạn thao tác với quyền quản lý.' : 'Phiếu đã giao cho nhân viên khác.'}
              tone="warning"
            />
          ) : null}

          <ScanStep n={1} title="Chọn dòng cần cất" done={Boolean(selectedItem)}>
            {remainingItems.length === 0 ? (
              <StampBadge text="Phiếu này đã cất hết lên kệ." tone="success" />
            ) : (
              <View style={{ gap: space.sm }}>
                {remainingItems.map((item) => {
                  const selected = selectedItem?.id === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      style={({ pressed }) => ({
                        minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radii.sm, borderWidth: selected ? 2 : 1,
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected ? colors.primarySoft : pressed ? colors.surfaceRaised : colors.surface,
                      })}
                      onPress={() => selectItem(item)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${item.book_title}, còn ${item.remaining_quantity} trên ${item.quantity}`}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 21, color: colors.textPrimary }} numberOfLines={2}>{item.book_title}</Text>
                        <Text style={type.caption}>
                          Còn {item.remaining_quantity}/{item.quantity}
                          {item.isbn13 ? `  ·  ISBN ${item.isbn13}` : ''}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: fontFamily.bold, fontSize: 20, color: selected ? colors.primary : colors.textPrimary, fontVariant: ['tabular-nums'] }}>{item.remaining_quantity}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScanStep>

          {selectedItem && (
            <ScanStep n={2} title="Chọn vị trí trên kệ" done={Boolean(plannedTarget)}>
              {source ? (
                <Pressable
                  onPress={() => sources.length > 1 && setSourcePickerOpen(true)}
                  disabled={sources.length <= 1}
                  accessibilityRole={sources.length > 1 ? 'button' : undefined}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}
                >
                  <Ionicons name="file-tray-outline" size={18} color={colors.textSecondary} />
                  <Text style={[type.caption, { flex: 1 }]}>
                    Lấy từ khu chờ cất <Text style={{ fontFamily: fontFamily.monoBold, color: colors.textPrimary }}>{source.location_code}</Text> (đang có {source.available})
                  </Text>
                  {sources.length > 1 ? <Text style={{ fontFamily: fontFamily.semibold, fontSize: 14, color: colors.primary }}>Đổi khu</Text> : null}
                </Pressable>
              ) : null}
              {stepError ? <InlineAlert message={stepError} /> : null}
              {isLoadingCandidates ? (
                <LoadingState label="Đang tìm vị trí trống…" />
              ) : source && candidates.length === 0 && !stepError ? (
                <InlineAlert tone="warning" message="Không tìm được vị trí trống phù hợp — liên hệ quản lý kho để mở thêm vị trí." />
              ) : (
                <View style={{ gap: space.sm }} accessibilityRole="radiogroup">
                  {visibleCandidates.map((candidate, index) => {
                    const planned = plannedTarget?.id === candidate.id;
                    return (
                      <Pressable
                        key={candidate.id}
                        style={({ pressed }) => ({
                          minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radii.sm, borderWidth: planned ? 2 : 1,
                          borderColor: planned ? colors.primary : colors.border,
                          backgroundColor: planned ? colors.primarySoft : pressed ? colors.surfaceRaised : colors.surface,
                        })}
                        onPress={() => {
                          setPlannedTarget(candidate);
                          attemptKeyRef.current = null;
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: planned }}
                        accessibilityLabel={`Vị trí ${candidate.location_code}, còn trống ${candidate.remaining_capacity}${index === 0 ? ', gợi ý tốt nhất' : ''}`}
                      >
                        <Ionicons name={planned ? 'radio-button-on' : 'radio-button-off'} size={20} color={planned ? colors.primary : colors.textMuted} />
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={{ fontFamily: fontFamily.monoBold, fontSize: 17, color: colors.textPrimary }}>{candidate.location_code}</Text>
                          <Text style={type.caption}>
                            Kệ {candidate.shelf_code}, khu {candidate.zone_code}
                            {candidate.mixed_sku_count > 0 ? `, đang chứa ${candidate.mixed_sku_count} đầu sách khác` : ''}
                          </Text>
                          {index === 0 ? <StatusBadge tone="success" label="Gợi ý tốt nhất" icon="star" /> : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontFamily: fontFamily.bold, fontSize: 20, color: colors.textPrimary, fontVariant: ['tabular-nums'] }}>{candidate.remaining_capacity}</Text>
                          <Text style={{ fontFamily: fontFamily.medium, fontSize: 12, color: colors.textSecondary }}>còn trống</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                  {candidates.length > VISIBLE_CANDIDATES ? (
                    <Button
                      label={showAllCandidates ? 'Thu gọn' : `Xem thêm ${candidates.length - VISIBLE_CANDIDATES} vị trí`}
                      variant="ghost"
                      size="md"
                      onPress={() => setShowAllCandidates((v) => !v)}
                    />
                  ) : null}
                </View>
              )}
            </ScanStep>
          )}

          {selectedItem && source ? (
            <ScanStep n={3} title={`Quét mã vị trí đã đến${plannedTarget ? ` (${plannedTarget.location_code})` : ''}`} done={Boolean(resolvedLocation)}>
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
            </ScanStep>
          ) : null}

          {selectedItem && !source && locationMessage ? (
            <StampBadge text={locationMessage.text} tone={locationMessage.ok ? 'success' : 'danger'} />
          ) : null}
          {!selectedItem && locationMessage ? <StampBadge text={locationMessage.text} tone={locationMessage.ok ? 'success' : 'danger'} /> : null}

          {selectedItem && resolvedLocation && limit && (
            <ScanStep n={4} title="Số lượng cất" done={false}>
              <TextField
                mono
                keyboardType="number-pad"
                value={quantity}
                onChangeText={(text) => {
                  setQuantity(sanitizeQuantityInput(text));
                  attemptKeyRef.current = null;
                }}
                maxLength={6}
                accessibilityLabel="Số lượng cất lên kệ"
                hint={`Tối đa ${limit.max} (${limit.reason})`}
              />
              {submitError ? <InlineAlert message={submitError} /> : null}
            </ScanStep>
          )}
        </Screen>
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

