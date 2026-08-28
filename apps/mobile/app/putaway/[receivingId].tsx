import { useCallback, useEffect, useState } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import * as putawayApi from '../../src/api/putaway';
import { ApiError } from '../../src/auth/auth-context';
import { notifyScanError, notifyScanSuccess } from '../../src/scanner/haptics';
import { ScanField } from '../../src/scanner/ScanField';
import type { CompartmentCandidate, ReceivingItem, VariantMatch } from '../../src/types/putaway';
import { colors, radius, shadow, spacing, typography } from '../../src/theme/tokens';

type SelectedItem = {
  variant_id: string;
  book_title: string;
  on_hand_qty: number;
};

export default function PutawayReceivingScreen() {
  const { receivingId, warehouseId } = useLocalSearchParams<{ receivingId: string; warehouseId: string }>();

  const [items, setItems] = useState<ReceivingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scanBookInput, setScanBookInput] = useState('');
  const [isLookingUpBook, setIsLookingUpBook] = useState(false);
  const [bookMessage, setBookMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [ambiguousMatches, setAmbiguousMatches] = useState<VariantMatch[]>([]);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);

  const [candidates, setCandidates] = useState<CompartmentCandidate[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);

  const [locationInput, setLocationInput] = useState('');
  const [resolvedLocation, setResolvedLocation] = useState<CompartmentCandidate | { id: string; location_code: string } | null>(null);
  const [locationMessage, setLocationMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [quantity, setQuantity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await putawayApi.getReceivingItems(receivingId);
      setItems(result.items);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Không tải được danh sách sách');
    }
  }, [receivingId]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  function resetAfterSuccess() {
    setScanBookInput('');
    setBookMessage(null);
    setAmbiguousMatches([]);
    setSelectedItem(null);
    setCandidates([]);
    setLocationInput('');
    setResolvedLocation(null);
    setLocationMessage(null);
    setQuantity('');
    setSubmitError(null);
  }

  async function selectItem(item: SelectedItem) {
    setSelectedItem(item);
    setBookMessage({ text: `Đã chọn: ${item.book_title}`, ok: true });
    setLocationInput('');
    setResolvedLocation(null);
    setLocationMessage(null);
    setQuantity(String(item.on_hand_qty));
    setIsLoadingCandidates(true);
    try {
      const result = await putawayApi.getCandidates(receivingId, item.variant_id);
      setCandidates(result.candidates);
    } catch (err) {
      setLocationMessage({ text: err instanceof ApiError ? err.message : 'Không lấy được gợi ý vị trí', ok: false });
    } finally {
      setIsLoadingCandidates(false);
    }
  }

  async function handleScanBook(value: string) {
    const code = value.trim();
    if (!code) return;
    setIsLookingUpBook(true);
    setBookMessage(null);
    setAmbiguousMatches([]);
    try {
      const result = await putawayApi.lookupVariantByBarcode(code);
      if (result.ambiguous) {
        setAmbiguousMatches(result.matches);
        setBookMessage({ text: 'Mã trùng nhiều sản phẩm, chọn đúng bên dưới.', ok: false });
        return;
      }
      if (!result.selected) {
        notifyScanError();
        setBookMessage({ text: 'Không tìm thấy sản phẩm', ok: false });
        return;
      }
      const inReceiving = items.find((i) => i.variant_id === result.selected!.variant_id);
      if (!inReceiving) {
        notifyScanError();
        setBookMessage({ text: 'Sách này không có ở khu vực chờ cất hàng hiện tại', ok: false });
        return;
      }
      notifyScanSuccess();
      await selectItem({
        variant_id: inReceiving.variant_id,
        book_title: inReceiving.book_title,
        on_hand_qty: inReceiving.on_hand_qty,
      });
    } catch (err) {
      notifyScanError();
      setBookMessage({ text: err instanceof ApiError ? err.message : 'Không tra được mã sách', ok: false });
    } finally {
      setIsLookingUpBook(false);
    }
  }

  async function handleScanLocation(value: string) {
    const code = value.trim();
    if (!code || !warehouseId) return;
    setLocationMessage(null);
    try {
      const location = await putawayApi.lookupLocationByBarcode(warehouseId, code);
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
    if (!selectedItem || !resolvedLocation || !warehouseId) return;
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setSubmitError('Số lượng phải lớn hơn 0');
      return;
    }
    if (qty > selectedItem.on_hand_qty) {
      setSubmitError(`Số lượng không được vượt quá ${selectedItem.on_hand_qty}`);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const result = await putawayApi.transferToShelf({
        warehouse_id: warehouseId,
        source_receiving_location_id: receivingId,
        variant_id: selectedItem.variant_id,
        allocations: [
          {
            target_location_id: resolvedLocation.id,
            quantity: qty,
            reason: 'Putaway qua mobile app',
            scanned_location_barcode: locationInput.trim() || undefined,
            scanned_product_barcode: scanBookInput.trim() || undefined,
          },
        ],
      });

      Alert.alert('Đã cất hàng', `Đã chuyển ${result.data.moved_quantity} sản phẩm vào ${resolvedLocation.location_code}.`);
      resetAfterSuccess();
      await load();
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

  if (loadError) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{loadError}</Text>
      </View>
    );
  }

  const topCandidate = candidates[0] ?? null;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Chọn sách để cất' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.stepCard}>
          <View style={styles.stepHeader}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>1</Text>
            </View>
            <Text style={styles.stepLabel}>Quét mã sách đang cầm trên tay</Text>
          </View>
          <ScanField
            value={scanBookInput}
            onChangeText={setScanBookInput}
            onSubmit={handleScanBook}
            placeholder="Quét hoặc nhập ISBN sách"
            autoFocus
          />
          {isLookingUpBook ? <ActivityIndicator color={colors.primary} /> : null}
          {bookMessage ? <Text style={bookMessage.ok ? styles.success : styles.error}>{bookMessage.text}</Text> : null}

          {ambiguousMatches.length > 0 && (
            <View style={styles.ambiguousBox}>
              {ambiguousMatches.map((match) => {
                const inReceiving = items.find((i) => i.variant_id === match.variant_id);
                if (!inReceiving) return null;
                return (
                  <Pressable
                    key={match.variant_id}
                    style={({ pressed }) => [styles.ambiguousItem, pressed && styles.rowPressed]}
                    onPress={() =>
                      selectItem({
                        variant_id: inReceiving.variant_id,
                        book_title: inReceiving.book_title,
                        on_hand_qty: inReceiving.on_hand_qty,
                      })
                    }
                  >
                    <Text style={styles.ambiguousText}>{match.book_title}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <Text style={styles.sectionTitle}>Hoặc chọn từ danh sách đang chờ cất:</Text>
          <View style={styles.itemList}>
            {items.map((item) => (
              <Pressable
                key={item.variant_id}
                style={({ pressed }) => [
                  styles.itemRow,
                  selectedItem?.variant_id === item.variant_id && styles.itemRowSelected,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => selectItem({ variant_id: item.variant_id, book_title: item.book_title, on_hand_qty: item.on_hand_qty })}
              >
                <Text style={styles.itemTitle}>{item.book_title}</Text>
                <Text style={styles.itemQty}>{item.on_hand_qty}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {selectedItem && (
          <View style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>2</Text>
              </View>
              <Text style={styles.stepLabel}>Vị trí gợi ý</Text>
            </View>
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
              <Text style={locationMessage.ok ? styles.success : styles.error}>{locationMessage.text}</Text>
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
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  success: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '600',
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
  sectionTitle: {
    ...typography.caption,
    marginTop: spacing.xs,
  },
  itemList: {
    gap: spacing.xs + 2,
  },
  itemRow: {
    flexDirection: 'row',
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
  itemTitle: {
    flex: 1,
    marginRight: spacing.sm,
    color: colors.textPrimary,
  },
  itemQty: {
    color: colors.textSecondary,
    fontWeight: '600',
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
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
});
