import { useCallback, useEffect, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import { AccessibilityInfo, ActivityIndicator, Easing, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';

import * as coverSearchApi from '../../src/api/coverSearch';
import type { CoverSearchCandidate } from '../../src/api/coverSearch';
import { ApiError } from '../../src/auth/auth-context';
import { PhotoCaptureModal } from '../../src/scanner/PhotoCaptureModal';
import { PosterCard } from '../../src/components/customer/PosterCard';
import { colors, radius, spacing, typography } from '../../src/theme/customerTokens';

function confidenceTone(confidence: number) {
  if (confidence >= 0.85) return colors.success;
  if (confidence >= 0.65) return colors.warning;
  return colors.neutral;
}

// Visual matching (CLIP) is fast in practice (~2s/image against the real
// gallery) — this timer just gives that checklist row a legible "done"
// moment. OCR (Ollama vision, CPU) is the real bottleneck and has no
// progress signal from the server, so its row stays "in progress" until the
// actual response arrives — never faked past that point.
const VISUAL_STEP_MS = 3000;
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

export default function CustomerScanCoverScreen() {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<CoverSearchCandidate[]>([]);
  const [ocrTitle, setOcrTitle] = useState<string | null>(null);
  const [visualStepDone, setVisualStepDone] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const visualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(setReducedMotion).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReducedMotion);
    return () => sub?.remove?.();
  }, []);

  const clearTimers = useCallback(() => {
    if (visualTimerRef.current) clearTimeout(visualTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  async function handleCaptured(photoDataUrl: string) {
    setCameraOpen(false);
    setPhotoPreview(photoDataUrl);
    setIsSearching(true);
    setError(null);
    setVisualStepDone(false);
    setElapsedMs(0);
    clearTimers();
    const startedAt = Date.now();
    visualTimerRef.current = setTimeout(() => setVisualStepDone(true), VISUAL_STEP_MS);
    elapsedTimerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);

    try {
      const result = await coverSearchApi.findBookByCover(photoDataUrl);
      setCandidates(result.candidates);
      setOcrTitle(result.signals.ocr_extracted?.title ?? null);
      setSearched(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể tìm sách từ ảnh này');
    } finally {
      clearTimers();
      setIsSearching(false);
    }
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
              <ChecklistRow label="So khớp hình ảnh bìa" done={visualStepDone} />
              <ChecklistRow
                label="Đọc chữ trên bìa sách"
                done={false}
                hint={elapsedMs >= SLOW_HINT_AFTER_MS ? 'có thể mất đến 1–2 phút' : undefined}
              />
            </View>
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

            {error && <Text style={styles.error}>{error}</Text>}

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
