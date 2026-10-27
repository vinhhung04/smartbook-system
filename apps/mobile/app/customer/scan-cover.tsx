import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import { AccessibilityInfo, ActivityIndicator, Easing, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';

import * as coverSearchApi from '../../src/api/coverSearch';
import type { CoverSearchCandidate } from '../../src/api/coverSearch';
import { isAbortError } from '../../src/api/client';
import { ApiError } from '../../src/auth/auth-context';
import { PhotoCaptureModal } from '../../src/scanner/PhotoCaptureModal';
import { PosterCard } from '../../src/components/customer/PosterCard';
import { colors, radius, spacing, typography } from '../../src/theme/customerTokens';

function confidenceTone(confidence: number) {
  if (confidence >= 0.85) return colors.success;
  if (confidence >= 0.65) return colors.warning;
  return colors.neutral;
}

// The server runs visual matching and OCR in parallel and answers once, with no
// progress signal — so both rows stay "in progress" until that answer arrives.
// Neither is ever shown as done on a timer.
const SLOW_HINT_AFTER_MS = 12000;
const SCAN_PREVIEW_HEIGHT = 220;

function ChecklistRow({ label, done, hint }: { label: string; done: boolean; hint?: string }) {
  return (
    <View style={styles.checklistRow}>
      {done ? (
        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
      ) : (
        <ActivityIndicator size="small" color={colors.primary} />
      )}
      <Text style={[styles.checklistLabel, done && styles.checklistLabelDone]}>
        {label}
        {hint ? <Text style={styles.checklistHint}> — {hint}</Text> : null}
      </Text>
    </View>
  );
}

// The one authored moment: a scan-line sweeping the user's own photo — names
// the actual thing the AI is doing to it, not a generic spinner. Skipped
// under Reduce Motion; the checklist state below still communicates progress.
function ScanSweep({ reducedMotion }: { reducedMotion: boolean }) {
  if (reducedMotion) return null;
  return (
    <MotiView
      style={styles.sweep}
      from={{ translateY: -40 }}
      animate={{ translateY: SCAN_PREVIEW_HEIGHT + 40 }}
      transition={{ type: 'timing', duration: 2200, loop: true, easing: Easing.inOut(Easing.quad) }}
    />
  );
}

function describeSearchError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.kind === 'timeout') return 'Hệ thống nhận diện phản hồi quá lâu. Bạn có thể thử lại hoặc chụp ảnh khác.';
    if (err.kind === 'network') return 'Mất kết nối mạng khi gửi ảnh. Kiểm tra Internet rồi thử lại.';
    if (err.status === 429) return 'Bạn đã tìm quá nhiều lần trong thời gian ngắn. Vui lòng đợi một lát rồi thử lại.';
    if (err.status >= 500) return 'Dịch vụ nhận diện ảnh đang tạm thời gián đoạn. Vui lòng thử lại sau.';
    return err.message;
  }
  return 'Không thể tìm sách từ ảnh này';
}

export default function CustomerScanCoverScreen() {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<CoverSearchCandidate[]>([]);
  const [ocrTitle, setOcrTitle] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Each search gets an id + AbortController: retaking the photo or leaving the screen
  // cancels the old request, and a late answer for an old id is ignored.
  const requestRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const lastPhotoRef = useRef<string | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReducedMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReducedMotion);
    return () => sub?.remove?.();
  }, []);

  const clearTimers = useCallback(() => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearTimers();
      requestRef.current.controller?.abort();
    },
    [clearTimers],
  );

  async function handleCaptured(photoDataUrl: string) {
    setCameraOpen(false);
    lastPhotoRef.current = photoDataUrl;
    requestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestId = requestRef.current.id + 1;
    requestRef.current = { id: requestId, controller };
    const isCurrent = () => requestRef.current.id === requestId;

    setPhotoPreview(photoDataUrl);
    setIsSearching(true);
    setError(null);
    setElapsedMs(0);
    clearTimers();
    const startedAt = Date.now();
    elapsedTimerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);

    try {
      const result = await coverSearchApi.findBookByCover(photoDataUrl, controller.signal);
      if (!isCurrent()) return;
      setCandidates(result.candidates);
      setOcrTitle(result.signals.ocr_extracted?.title ?? null);
      setSearched(true);
    } catch (err) {
      if (!isCurrent() || isAbortError(err)) return;
      setCandidates([]);
      setSearched(true);
      setError(describeSearchError(err));
    } finally {
      if (isCurrent()) {
        clearTimers();
        setIsSearching(false);
        requestRef.current.controller = null;
      }
    }
  }

  function handleCancel() {
    requestRef.current.controller?.abort();
    requestRef.current = { id: requestRef.current.id + 1, controller: null };
    clearTimers();
    setIsSearching(false);
    setSearched(false);
    setError(null);
  }

  function handleRetry() {
    if (lastPhotoRef.current) void handleCaptured(lastPhotoRef.current);
  }

  const showEmptyHero = !isSearching && !searched && !error;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Tìm sách bằng ảnh bìa' }} />
      <View style={styles.container}>
        {showEmptyHero ? (
          // First-run state teaches the feature instead of showing a bare
          // button on empty space — matches the customer web page's hero.
          <View style={styles.emptyHero}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="camera-outline" size={30} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>Tìm sách bằng ảnh bìa</Text>
            <Text style={styles.emptySubtitle}>
              Chụp ảnh bìa bất kỳ cuốn sách nào — hệ thống sẽ tìm sách khớp trong thư viện để bạn đặt trước ngay.
            </Text>
            <Pressable style={styles.captureButton} onPress={() => setCameraOpen(true)}>
              <Ionicons name="camera" size={17} color={colors.onPrimary} />
              <Text style={styles.captureButtonText}>Chụp ảnh bìa sách</Text>
            </Pressable>
          </View>
        ) : isSearching ? (
          <View style={styles.scanningWrap}>
            <View style={styles.scanPreview}>
              {photoPreview && <Image source={{ uri: photoPreview }} style={StyleSheet.absoluteFill} resizeMode="contain" />}
              <ScanSweep reducedMotion={reducedMotion} />
              <View style={styles.elapsedBadge}>
                <Text style={styles.elapsedBadgeText}>Đã chờ {Math.round(elapsedMs / 1000)}s</Text>
              </View>
            </View>

            <View style={styles.checklist}>
              <ChecklistRow label="So khớp hình ảnh bìa" done={false} />
              <ChecklistRow
                label="Đọc chữ trên bìa sách"
                done={false}
                hint={elapsedMs >= SLOW_HINT_AFTER_MS ? 'có thể mất đến 1–2 phút' : undefined}
              />
            </View>
            <Pressable style={styles.cancelButton} onPress={handleCancel} accessibilityRole="button">
              <Text style={styles.retakeText}>Hủy tìm kiếm</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.searchedHeader}>
              {photoPreview && <Image source={{ uri: photoPreview }} style={styles.photoThumb} />}
              <View style={styles.searchedHeaderBody}>
                {ocrTitle && (
                  <Text style={styles.ocrHint} numberOfLines={2}>
                    Đọc được trên bìa: {ocrTitle}
                  </Text>
                )}
                <Pressable onPress={() => setCameraOpen(true)} hitSlop={8}>
                  <Text style={styles.retakeText}>Chụp ảnh khác</Text>
                </Pressable>
              </View>
            </View>

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.error}>{error}</Text>
                <Pressable style={styles.cancelButton} onPress={handleRetry} accessibilityRole="button">
                  <Text style={styles.retakeText}>Thử lại với ảnh này</Text>
                </Pressable>
              </View>
            )}

            {!error && (
              <FlatList
                data={candidates}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                  <View style={styles.emptyResult}>
                    <Ionicons name="search-outline" size={24} color={colors.textMuted} />
                    <Text style={styles.emptyResultText}>
                      Không tìm thấy sách khớp. Thử chụp lại ở nơi đủ sáng, giữ bìa thẳng trong khung hình.
                    </Text>
                  </View>
                }
                renderItem={({ item }) => (
                  <View style={styles.row}>
                    <View style={styles.posterWrap}>
                      <PosterCard
                        title={item.title}
                        category={item.category}
                        coverImageUrl={item.cover_image_url}
                        width={80}
                        height={120}
                        onPress={() => router.push(`/customer/book/${item.id}`)}
                      />
                      <View style={[styles.confidenceBadge, { backgroundColor: confidenceTone(item.confidence) }]}>
                        <Text style={styles.confidenceBadgeText}>{Math.round(item.confidence * 100)}%</Text>
                      </View>
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {item.author ?? 'Chưa rõ tác giả'}
                      </Text>
                    </View>
                  </View>
                )}
              />
            )}
          </>
        )}
      </View>

      <PhotoCaptureModal visible={cameraOpen} onCaptured={handleCaptured} onClose={() => setCameraOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  emptyHero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    ...typography.h3,
  },
  emptySubtitle: {
    ...typography.caption,
    textAlign: 'center',
    maxWidth: 280,
  },
  captureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.md,
  },
  captureButtonText: {
    ...typography.bodyBold,
    color: colors.onPrimary,
  },
  scanningWrap: {
    gap: spacing.lg,
  },
  scanPreview: {
    height: SCAN_PREVIEW_HEIGHT,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  sweep: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 40,
    backgroundColor: colors.primarySoft,
  },
  elapsedBadge: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  elapsedBadgeText: {
    ...typography.caption,
    color: '#fff',
    fontSize: 11,
  },
  checklist: {
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checklistLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  checklistLabelDone: {
    color: colors.textPrimary,
  },
  checklistHint: {
    color: colors.textMuted,
  },
  searchedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  photoThumb: {
    width: 48,
    height: 64,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchedHeaderBody: {
    flex: 1,
    gap: 4,
  },
  error: {
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  ocrHint: {
    ...typography.caption,
  },
  retakeText: {
    ...typography.caption,
    color: colors.primary,
    fontFamily: typography.bodyBold.fontFamily,
  },
  errorBox: {
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  cancelButton: {
    alignSelf: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  list: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  emptyResult: {
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  emptyResultText: {
    ...typography.caption,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  posterWrap: {
    position: 'relative',
  },
  confidenceBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  confidenceBadgeText: {
    ...typography.label,
    color: colors.onPrimary,
    fontSize: 10,
    letterSpacing: 0,
    textTransform: 'none',
  },
  rowBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  rowTitle: {
    ...typography.bodyBold,
  },
  rowMeta: {
    ...typography.caption,
  },
});
