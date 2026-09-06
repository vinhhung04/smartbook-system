import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import * as stockAuditApi from '../../src/api/stockAudit';
import { ApiError } from '../../src/auth/auth-context';
import { notifyScanError, notifyScanSuccess } from '../../src/scanner/haptics';
import { ScanField } from '../../src/scanner/ScanField';
import type { StockAuditDetail, StockAuditLine } from '../../src/types/stockAudit';
import { colors, radius, spacing, typography } from '../../src/theme/tokens';

export default function StockAuditDetailScreen() {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const [audit, setAudit] = useState<StockAuditDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scanInput, setScanInput] = useState('');
  const [scanMessage, setScanMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [draftCounts, setDraftCounts] = useState<Record<string, string>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await stockAuditApi.getAuditById(auditId);
      setAudit(result.data);
      setDraftCounts(
        Object.fromEntries(result.data.items.map((line) => [line.id, line.counted_qty !== null ? String(line.counted_qty) : ''])),
      );
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Không tải được phiếu kiểm kê');
    }
  }, [auditId]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  async function saveCount(line: StockAuditLine, newQty: number) {
    setSavingLineId(line.id);
    try {
      const result = await stockAuditApi.submitLineCount(auditId, line.id, newQty);
      setAudit((prev) => (prev ? { ...prev, items: prev.items.map((l) => (l.id === line.id ? result.data : l)) } : prev));
      setDraftCounts((prev) => ({ ...prev, [line.id]: String(result.data.counted_qty) }));
      return true;
    } catch (err) {
      Alert.alert('Lỗi', err instanceof ApiError ? err.message : 'Không lưu được số lượng đếm');
      return false;
    } finally {
      setSavingLineId(null);
    }
  }

  async function handleScan(value: string) {
    const code = value.trim().toLowerCase();
    if (!code || !audit || savingLineId) return;

    const line = audit.items.find(
      (l) => (l.sku && l.sku.toLowerCase() === code) || (l.isbn13 && l.isbn13.toLowerCase() === code),
    );

    if (!line) {
      notifyScanError();
      setScanMessage({ text: 'Không tìm thấy sách này trong phiếu kiểm kê', ok: false });
      return;
    }

    const newQty = (line.counted_qty ?? 0) + 1;
    const ok = await saveCount(line, newQty);
    if (ok) notifyScanSuccess();
    else notifyScanError();
    setScanMessage({ text: ok ? `${line.title}: đếm được ${newQty}` : 'Lưu thất bại', ok });
    setScanInput('');
  }

  async function handleManualEntry(line: StockAuditLine) {
    const raw = draftCounts[line.id] ?? '';
    const qty = Number(raw);
    if (raw.trim() === '' || Number.isNaN(qty) || qty < 0) return;
    await saveCount(line, qty);
  }

  async function handleSubmitAudit() {
    if (!audit) return;
    const uncounted = audit.items.filter((l) => l.counted_qty === null).length;
    if (uncounted > 0) {
      setSubmitError(`Còn ${uncounted} mục chưa nhập số lượng đếm được`);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await stockAuditApi.submitAudit(auditId);
      Alert.alert('Đã nộp phiếu', 'Phiếu kiểm kê đã được nộp để chờ duyệt.', [
        { text: 'OK', onPress: () => router.replace('/audit') },
      ]);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Nộp phiếu thất bại');
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

  if (loadError || !audit) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{loadError ?? 'Không tìm thấy phiếu'}</Text>
      </View>
    );
  }

  const countedTotal = audit.items.filter((l) => l.counted_qty !== null).length;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: audit.audit_number }} />
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.header}>
          <Text style={styles.headerText}>
            {audit.warehouse_code ?? '-'} · {countedTotal}/{audit.items.length} đã đếm
          </Text>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${audit.items.length === 0 ? 0 : (countedTotal / audit.items.length) * 100}%` },
              ]}
            />
          </View>
        </View>

        <View style={styles.scanBox}>
          <ScanField
            value={scanInput}
            onChangeText={setScanInput}
            onSubmit={handleScan}
            placeholder="Quét mã sách để +1 số lượng đếm"
            autoFocus
            editable={!savingLineId}
          />
          {scanMessage ? <Text style={scanMessage.ok ? styles.success : styles.error}>{scanMessage.text}</Text> : null}
        </View>

        <FlatList
          data={audit.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowTitle}>{item.title ?? '-'}</Text>
                <Text style={styles.rowMeta}>
                  {item.location_code ?? '-'} · Hệ thống: {item.expected_qty}
                </Text>
              </View>
              <TextInput
                style={styles.countInput}
                keyboardType="number-pad"
                value={draftCounts[item.id] ?? ''}
                onChangeText={(text) => setDraftCounts((prev) => ({ ...prev, [item.id]: text }))}
                onSubmitEditing={() => handleManualEntry(item)}
                onBlur={() => handleManualEntry(item)}
                placeholder="-"
                placeholderTextColor={colors.textMuted}
              />
              {savingLineId === item.id ? (
                <ActivityIndicator style={styles.rowSpinner} color={colors.primary} />
              ) : item.variance_qty !== null ? (
                <Text style={item.variance_qty === 0 ? styles.varianceOk : styles.varianceBad}>
                  {item.variance_qty > 0 ? `+${item.variance_qty}` : item.variance_qty}
                </Text>
              ) : null}
            </View>
          )}
        />

        {submitError ? (
          <View style={styles.errorBox}>
            <Text style={styles.error}>{submitError}</Text>
          </View>
        ) : null}
        <Pressable
          style={({ pressed }) => [styles.submitButton, (isSubmitting || pressed) && styles.buttonDisabled]}
          onPress={handleSubmitAudit}
          disabled={isSubmitting}
        >
          {isSubmitting ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.submitButtonText}>Nộp phiếu kiểm kê</Text>}
        </Pressable>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
  errorBox: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  success: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '600',
  },
  header: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  headerText: {
    ...typography.caption,
    fontWeight: '700',
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  scanBox: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.xs + 2,
  },
  list: {
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowInfo: {
    flex: 1,
  },
  rowTitle: {
    fontWeight: '600',
    color: colors.textPrimary,
  },
  rowMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  countInput: {
    width: 60,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    textAlign: 'center',
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  rowSpinner: {
    width: 32,
  },
  varianceOk: {
    width: 32,
    textAlign: 'center',
    color: colors.success,
    fontWeight: '700',
  },
  varianceBad: {
    width: 32,
    textAlign: 'center',
    color: colors.danger,
    fontWeight: '700',
  },
  submitButton: {
    margin: spacing.lg,
    backgroundColor: colors.success,
    borderRadius: radius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: colors.onPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
});
