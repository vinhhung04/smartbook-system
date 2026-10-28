import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Platform, Text, TextInput, View, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as stockAuditApi from '../../src/api/stockAudit';
import * as coverSearchApi from '../../src/api/coverSearch';
import { isAbortError, isOutcomeUnknown } from '../../src/api/client';
import { ApiError } from '../../src/auth/auth-context';
import { notifyScanError, notifyScanSuccess } from '../../src/scanner/haptics';
import { ScanField } from '../../src/scanner/ScanField';
import { PhotoCaptureModal } from '../../src/scanner/PhotoCaptureModal';
import { StampBadge } from '../../src/components/StampBadge';
import { ChecklistMeter } from '../../src/components/ChecklistMeter';
import { AuditCoverConfirmSheet } from '../../src/components/AuditCoverConfirmSheet';
import { SelectionSheet } from '../../src/components/SelectionSheet';
import { matchCoverCandidatesToAudit, nextCount, type AuditCoverMatch } from '../../src/lib/auditCoverMatch';
import { findAuditLinesByCode } from '../../src/lib/stockAuditScan';
import { parseWholeQuantity, sanitizeQuantityInput } from '../../src/lib/quantity';
import { useSubmitLock } from '../../src/lib/submitLock';
import type { SelectOption } from '../../src/lib/optionSearch';
import type { StockAuditDetail, StockAuditLine } from '../../src/types/stockAudit';
import {
  BottomActionBar, Button, ErrorState, IconButton, InlineAlert, LoadingState, Screen, ScreenHeader, fontFamily, radii, space, useTheme,
} from '../../src/design-system';

const SLOW_HINT_AFTER_MS = 12000;
/** The count box draws its own border; the browser's focus outline would draw a second one. */
const NO_WEB_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : null) as TextStyle | null;

type Tone = 'success' | 'danger' | 'primary' | 'warning';

export default function StockAuditDetailScreen() {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const { colors, type } = useTheme();
  const [audit, setAudit] = useState<StockAuditDetail | null>(null);
  // Every count write is "current + 1" or an absolute value; read the freshest lines from
  // here, not from a render-time closure that may predate the previous save.
  const auditRef = useRef<StockAuditDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [scanInput, setScanInput] = useState('');
  const [scanMessage, setScanMessage] = useState<{ text: string; tone: Tone } | null>(null);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [draftCounts, setDraftCounts] = useState<Record<string, string>>({});
  const [cameraOpen, setCameraOpen] = useState(false);
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [coverMatches, setCoverMatches] = useState<AuditCoverMatch[]>([]);
  const [coverOcrTitle, setCoverOcrTitle] = useState<string | null>(null);
  const [locationChoices, setLocationChoices] = useState<StockAuditLine[]>([]);
  const aiRequestRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const saveLock = useSubmitLock();
  const submitLock = useSubmitLock();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const applyAudit = useCallback((next: StockAuditDetail) => {
    auditRef.current = next;
    setAudit(next);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const result = await stockAuditApi.getAuditById(auditId);
      applyAudit(result.data);
      setDraftCounts(
        Object.fromEntries(result.data.items.map((line) => [line.id, line.counted_qty !== null ? String(line.counted_qty) : ''])),
      );
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Không tải được phiếu kiểm kê');
    }
  }, [auditId, applyAudit]);

  useEffect(() => {
    setIsLoading(true);
    load().finally(() => setIsLoading(false));
  }, [load]);

  // Leaving the screen cancels a cover search still in flight so its answer cannot
  // pop a confirm sheet over whatever screen comes next.
  useEffect(() => () => aiRequestRef.current.controller?.abort(), []);

  function latestLine(lineId: string): StockAuditLine | undefined {
    return auditRef.current?.items.find((l) => l.id === lineId);
  }

  /** Writes one line's count. Callers must hold saveLock so two writes never interleave. */
  async function saveCount(line: StockAuditLine, newQty: number): Promise<boolean> {
    setSavingLineId(line.id);
    try {
      const result = await stockAuditApi.submitLineCount(auditId, line.id, newQty);
      const current = auditRef.current;
      if (current) applyAudit({ ...current, items: current.items.map((l) => (l.id === line.id ? result.data : l)) });
      setDraftCounts((prev) => ({ ...prev, [line.id]: String(result.data.counted_qty) }));
      return true;
    } catch (err) {
      if (isOutcomeUnknown(err)) {
        // The count is an absolute value, but whether it landed is unknown — show the
        // server's number instead of guessing, so the next +1 starts from the truth.
        await load();
        setScanMessage({ text: `Chưa rõ đã lưu chưa — đã tải lại số liệu từ máy chủ cho "${line.title ?? 'sách'}". Kiểm tra trước khi đếm tiếp.`, tone: 'warning' });
      } else {
        Alert.alert('Lỗi', err instanceof ApiError ? err.message : 'Không lưu được số lượng đếm');
      }
      return false;
    } finally {
      setSavingLineId(null);
    }
  }

  async function incrementLine(lineId: string, suffix = '') {
    await saveLock.run(async () => {
      const line = latestLine(lineId);
      if (!line) return;
      const newQty = nextCount(line);
      const ok = await saveCount(line, newQty);
      if (ok) {
        notifyScanSuccess();
        setScanMessage({ text: `${line.title}${line.location_code ? ` (${line.location_code})` : ''}: đếm được ${newQty}${suffix}`, tone: 'success' });
      } else {
        notifyScanError();
      }
    });
  }

  async function handleScan(value: string) {
    const code = value.trim();
    const current = auditRef.current;
    if (!code || !current) return;
    setScanInput('');
    if (saveLock.busy) {
      notifyScanError();
      setScanMessage({ text: 'Đang lưu lần đếm trước — quét lại sau khi lưu xong.', tone: 'danger' });
      return;
    }

    const lines = findAuditLinesByCode(current.items, code);
    if (lines.length === 0) {
      notifyScanError();
      setScanMessage({ text: 'Không tìm thấy sách này trong phiếu kiểm kê', tone: 'danger' });
      return;
    }
    if (lines.length > 1) {
      // Same book on several shelves: only the counter knows which shelf this copy is on.
      setLocationChoices(lines);
      return;
    }
    await incrementLine(lines[0].id);
  }

  // Fallback for lines whose barcode/ISBN sticker is missing or unreadable — photograph
  // the cover. The AI result is only a proposal: it is narrowed to this audit's own lines
  // and shown for confirmation; nothing is counted until the counter confirms one line.
  async function handleCoverPhoto(photoDataUrl: string) {
    setCameraOpen(false);
    if (!auditRef.current) return;

    aiRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestId = aiRequestRef.current.id + 1;
    aiRequestRef.current = { id: requestId, controller };
    const isCurrent = () => aiRequestRef.current.id === requestId;

    setIsIdentifying(true);
    setCoverMatches([]);
    // No progress signal from the server for this call — the slow leg (OCR on CPU) can
    // run past a minute, so say so honestly instead of a blank spinner.
    setScanMessage({ text: 'Đang nhận diện ảnh bìa…', tone: 'primary' });
    const slowHintTimer = setTimeout(() => {
      if (isCurrent()) setScanMessage({ text: 'Đang đọc chữ trên bìa — có thể mất đến 1–2 phút', tone: 'primary' });
    }, SLOW_HINT_AFTER_MS);

    try {
      const result = await coverSearchApi.findBookByCover(photoDataUrl, controller.signal);
      if (!isCurrent() || !auditRef.current) return;
      const matches = matchCoverCandidatesToAudit(result.candidates, auditRef.current.items);
      if (matches.length === 0) {
        notifyScanError();
        setScanMessage({
          text: result.candidates.length > 0
            ? 'Ảnh khớp sách không có trong phiếu kiểm kê này — kiểm tra lại hoặc nhập số lượng thủ công.'
            : 'Không nhận diện được sách từ ảnh — chụp lại rõ hơn hoặc nhập số lượng thủ công.',
          tone: 'danger',
        });
        return;
      }
      setScanMessage(null);
      setCoverOcrTitle(result.signals.ocr_extracted?.title ?? null);
      setCoverMatches(matches);
    } catch (err) {
      if (!isCurrent() || isAbortError(err)) return;
      notifyScanError();
      const timedOut = err instanceof ApiError && err.kind === 'timeout';
      setScanMessage({
        text: timedOut
          ? 'Nhận diện ảnh quá lâu nên đã dừng. Chưa có gì được ghi — bạn có thể chụp lại hoặc nhập thủ công.'
          : err instanceof ApiError ? err.message : 'Không nhận diện được ảnh',
        tone: 'danger',
      });
    } finally {
      clearTimeout(slowHintTimer);
      if (isCurrent()) {
        setIsIdentifying(false);
        aiRequestRef.current.controller = null;
      }
    }
  }

  function handleConfirmCover(match: AuditCoverMatch) {
    setCoverMatches([]);
    void incrementLine(match.line.id, ` (xác nhận từ ảnh, AI ${Math.round(match.confidence * 100)}%)`);
  }

  async function handleManualEntry(line: StockAuditLine) {
    const raw = draftCounts[line.id] ?? '';
    const current = latestLine(line.id);
    if (raw.trim() === '') return;
    const parsed = parseWholeQuantity(raw, { min: 0 });
    if (!parsed.ok) {
      setScanMessage({ text: `${line.title ?? 'Dòng'}: ${parsed.error}`, tone: 'danger' });
      setDraftCounts((prev) => ({ ...prev, [line.id]: current?.counted_qty !== null && current?.counted_qty !== undefined ? String(current.counted_qty) : '' }));
      return;
    }
    // onSubmitEditing and onBlur both fire for one edit — only write a real change.
    if (current?.counted_qty === parsed.value) return;
    await saveLock.run(async () => {
      const fresh = latestLine(line.id);
      if (fresh) await saveCount(fresh, parsed.value);
    });
  }

  async function submitAuditNow() {
    await submitLock.run(async () => {
      setIsSubmitting(true);
      setSubmitError(null);
      try {
        await stockAuditApi.submitAudit(auditId);
        Alert.alert('Đã nộp phiếu', 'Phiếu kiểm kê đã được nộp để chờ duyệt.', [
          { text: 'OK', onPress: () => router.replace('/audit') },
        ]);
      } catch (err) {
        if (isOutcomeUnknown(err)) {
          await load();
          setSubmitError('Chưa rõ phiếu đã được nộp chưa — đã tải lại trạng thái phiếu. Kiểm tra trạng thái trước khi nộp lại.');
        } else {
          setSubmitError(err instanceof ApiError ? err.message : 'Nộp phiếu thất bại');
        }
      } finally {
        setIsSubmitting(false);
      }
    });
  }

  function handleSubmitAudit() {
    if (!audit) return;
    const uncounted = audit.items.filter((l) => l.counted_qty === null).length;
    if (uncounted > 0) {
      setSubmitError(`Còn ${uncounted} mục chưa nhập số lượng đếm được`);
      return;
    }
    const varianceLines = audit.items.filter((l) => (l.variance_qty ?? 0) !== 0).length;
    Alert.alert(
      'Nộp phiếu kiểm kê?',
      `${audit.items.length} mục đã đếm${varianceLines > 0 ? `, ${varianceLines} mục lệch so với hệ thống` : ''}. Sau khi nộp sẽ không sửa được số lượng.`,
      [
        { text: 'Kiểm tra lại', style: 'cancel' },
        { text: 'Nộp phiếu', onPress: () => void submitAuditNow() },
      ],
    );
  }

  if (isLoading) {
    return (<><ScreenHeader title="Kiểm kê" /><Screen scroll={false}><LoadingState label="Đang mở phiếu kiểm kê…" /></Screen></>);
  }

  if (loadError || !audit) {
    return (
      <>
        <ScreenHeader title="Kiểm kê" />
        <Screen scroll={false}>
          <ErrorState title={loadError ?? 'Không tìm thấy phiếu'} onRetry={() => { setIsLoading(true); void load().finally(() => setIsLoading(false)); }} />
        </Screen>
      </>
    );
  }

  const countedTotal = audit.items.filter((l) => l.counted_qty !== null).length;
  const locationOptions: (SelectOption & { lineId: string })[] = locationChoices.map((line) => ({
    id: line.id,
    lineId: line.id,
    title: `Vị trí ${line.location_code ?? '—'}`,
    subtitle: `Đã đếm ${line.counted_qty ?? 0} · Hệ thống ${line.expected_qty}`,
  }));

  return (
    <>
      <ScreenHeader title={audit.audit_number} />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: space.lg, gap: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }} accessible accessibilityLabel={`Đã đếm ${countedTotal} trên ${audit.items.length} dòng, kho ${audit.warehouse_code ?? 'không rõ'}`}>
            <Text style={{ fontFamily: fontFamily.bold, fontSize: 28, color: colors.textPrimary, fontVariant: ['tabular-nums'] }}>{countedTotal}/{audit.items.length}</Text>
            <Text style={[type.body, { flex: 1 }]}>dòng đã đếm, kho {audit.warehouse_code ?? '—'}</Text>
          </View>
          <ChecklistMeter value={countedTotal} max={audit.items.length} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <ScanField
                value={scanInput}
                onChangeText={setScanInput}
                onSubmit={handleScan}
                placeholder="Quét mã sách để +1 số lượng đếm"
                autoFocus
                editable={!savingLineId}
              />
            </View>
            {isIdentifying ? (
              <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel="Đang nhận diện ảnh bìa">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <View style={{ paddingTop: 2 }}>
                <IconButton icon="camera-outline" variant="tonal" accessibilityLabel="Chụp ảnh bìa để nhận diện sách" onPress={() => setCameraOpen(true)} />
              </View>
            )}
          </View>
          {scanMessage ? <StampBadge text={scanMessage.text} tone={scanMessage.tone} /> : null}
        </View>

        <FlatList
          data={audit.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: space.lg, paddingBottom: 180, gap: space.sm }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const variance = item.variance_qty;
            const varianceTone = variance === null ? colors.textMuted : variance === 0 ? colors.success : colors.danger;
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radii.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 21, color: colors.textPrimary }} numberOfLines={2}>{item.title ?? '—'}</Text>
                  <Text style={type.caption}>
                    <Text style={{ fontFamily: fontFamily.monoBold, color: colors.textPrimary }}>{item.location_code ?? '—'}</Text>, hệ thống {item.expected_qty}
                  </Text>
                </View>
                <TextInput
                  style={[{
                    width: 72, height: 48, borderRadius: radii.sm, borderWidth: 1.5, borderColor: item.counted_qty === null ? colors.borderStrong : colors.primary,
                    textAlign: 'center', fontFamily: fontFamily.monoBold, fontSize: 18, color: colors.textPrimary, backgroundColor: colors.surface,
                  }, NO_WEB_OUTLINE]}
                  keyboardType="number-pad"
                  value={draftCounts[item.id] ?? ''}
                  onChangeText={(text) => setDraftCounts((prev) => ({ ...prev, [item.id]: sanitizeQuantityInput(text) }))}
                  onSubmitEditing={() => handleManualEntry(item)}
                  onBlur={() => handleManualEntry(item)}
                  placeholder="—"
                  placeholderTextColor={colors.textMuted}
                  maxLength={6}
                  accessibilityLabel={`Số lượng đếm được của ${item.title ?? 'dòng'} tại ${item.location_code ?? 'vị trí không rõ'}`}
                />
                <View style={{ width: 52, alignItems: 'flex-end' }}>
                  {savingLineId === item.id ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : variance !== null ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }} accessible accessibilityLabel={variance === 0 ? 'Khớp hệ thống' : `Lệch ${variance}`}>
                      {variance === 0 ? <Ionicons name="checkmark-circle" size={16} color={varianceTone} /> : null}
                      <Text style={{ fontFamily: fontFamily.monoBold, fontSize: 15, color: varianceTone }}>
                        {variance === 0 ? '0' : variance > 0 ? `+${variance}` : variance}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          }}
        />

        <BottomActionBar>
          {submitError ? <InlineAlert message={submitError} /> : null}
          <Button label="Nộp phiếu kiểm kê" icon="send" loading={isSubmitting} loadingLabel="Đang nộp…" onPress={handleSubmitAudit} />
        </BottomActionBar>
      </View>

      <PhotoCaptureModal visible={cameraOpen} onCaptured={handleCoverPhoto} onClose={() => setCameraOpen(false)} />
      <AuditCoverConfirmSheet
        visible={coverMatches.length > 0}
        matches={coverMatches}
        photoTitle={coverOcrTitle}
        saving={savingLineId !== null}
        onConfirm={handleConfirmCover}
        onDismiss={() => {
          setCoverMatches([]);
          setScanMessage({ text: 'Đã bỏ qua kết quả ảnh — chưa ghi số lượng nào.', tone: 'primary' });
        }}
      />
      <SelectionSheet
        visible={locationChoices.length > 0}
        title="Sách này ở nhiều vị trí — bạn đang đếm ở đâu?"
        options={locationOptions}
        onSelect={(option) => {
          setLocationChoices([]);
          void incrementLine(option.lineId);
        }}
        onClose={() => setLocationChoices([])}
      />
    </>
  );
}

