import { useCallback, useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import * as coverSearchApi from '../../src/api/coverSearch';
import type { CoverSearchCandidate } from '../../src/api/coverSearch';
import { isAbortError } from '../../src/api/client';
import { ApiError } from '../../src/auth/auth-context';
import { PhotoCaptureModal } from '../../src/scanner/PhotoCaptureModal';
import { BookCover } from '../../src/components/customer/BookCover';
import { Button, EmptyState, InlineAlert, PressableScale, ScreenHeader, StatusBadge, fontFamily, radii, space, useTheme, type Tone } from '../../src/design-system';

/** How sure the match is, in words as well as a percentage. */
function confidenceView(confidence: number): { tone: Tone; label: string } {
  const pct = `${Math.round(confidence * 100)}%`;
  if (confidence >= 0.85) return { tone: 'success', label: `Rất khớp, ${pct}` };
  if (confidence >= 0.65) return { tone: 'warning', label: `Có thể khớp, ${pct}` };
  return { tone: 'neutral', label: `Ít khớp, ${pct}` };
}

// The server runs visual matching and OCR in parallel and answers once, with no
// progress signal — so both rows stay "in progress" until that answer arrives.
// Neither is ever shown as done on a timer.
const SLOW_HINT_AFTER_MS = 12000;
const SCAN_PREVIEW_HEIGHT = 220;

function ChecklistRow({ label, done, hint }: { label: string; done: boolean; hint?: string }) {
  const { colors, type } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 32 }}>
      {done ? <Ionicons name="checkmark-circle" size={20} color={colors.success} /> : <ActivityIndicator size="small" color={colors.primary} />}
      <View style={{ flex: 1 }}>
        <Text style={type.callout}>{label}</Text>
        {hint ? <Text style={type.caption}>{hint}</Text> : null}
      </View>
    </View>
  );
}

const SWEEP = { from: { transform: [{ translateY: -40 }] }, to: { transform: [{ translateY: SCAN_PREVIEW_HEIGHT + 40 }] } };

// The one authored moment: a scan line sweeping the reader's own photo, naming what
// the matching is doing to it. It runs only while a search is in flight and is
// dropped under Reduce Motion; the checklist below carries the progress either way.
function ScanSweep() {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <Animated.View
      style={{
        position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: '#8F87FF',
        animationName: SWEEP, animationDuration: 2200, animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out',
      }}
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
  const { colors, type } = useTheme();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<CoverSearchCandidate[]>([]);
  const [ocrTitle, setOcrTitle] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Each search gets an id + AbortController: retaking the photo or leaving the screen
  // cancels the old request, and a late answer for an old id is ignored.
  const requestRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const lastPhotoRef = useRef<string | null>(null);

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
      <ScreenHeader title="Tìm bằng ảnh bìa" />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {showEmptyHero ? (
          // First run teaches the feature instead of a bare button on empty space.
          <View style={{ flex: 1, padding: space.xl, gap: space.xl, justifyContent: 'center' }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="camera-outline" size={30} color={colors.primary} />
            </View>
            <View style={{ gap: space.sm }}>
              <Text style={type.title} accessibilityRole="header">Chụp bìa, tìm sách</Text>
              <Text style={type.body}>Chụp ảnh bìa một cuốn sách, hệ thống tìm cuốn khớp trong thư viện để bạn đặt trước ngay.</Text>
            </View>
            <View style={{ gap: space.sm }}>
              {['Chụp nơi đủ sáng, tránh lóa', 'Giữ bìa thẳng và lấp đầy khung hình', 'Tên sách rõ thì nhận diện nhanh hơn'].map((tip) => (
                <View key={tip} style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
                  <Ionicons name="checkmark" size={18} color={colors.success} />
                  <Text style={type.callout}>{tip}</Text>
                </View>
              ))}
            </View>
            <Button label="Chụp ảnh bìa sách" icon="camera" onPress={() => setCameraOpen(true)} />
          </View>
        ) : isSearching ? (
          <View style={{ flex: 1, padding: space.lg, gap: space.xl }}>
            <View style={{ height: SCAN_PREVIEW_HEIGHT, borderRadius: radii.lg, overflow: 'hidden', backgroundColor: colors.inkField }}>
              {photoPreview ? <Image source={{ uri: photoPreview }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="Ảnh bìa bạn vừa chụp" /> : null}
              <ScanSweep />
              <View style={{ position: 'absolute', right: space.sm, bottom: space.sm, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: 'rgba(0,0,0,0.6)' }}>
                <Text style={{ fontFamily: fontFamily.semibold, fontSize: 12.5, color: '#FFFFFF', fontVariant: ['tabular-nums'] }}>Đã chờ {Math.round(elapsedMs / 1000)} giây</Text>
              </View>
            </View>
            <View style={{ gap: space.sm }} accessibilityLiveRegion="polite">
              <Text style={type.heading}>Đang tìm sách khớp…</Text>
              <ChecklistRow label="So khớp hình ảnh bìa" done={false} />
              <ChecklistRow label="Đọc chữ trên bìa sách" done={false} hint={elapsedMs >= SLOW_HINT_AFTER_MS ? 'Có thể mất đến 1–2 phút.' : undefined} />
            </View>
            <Button label="Hủy tìm kiếm" variant="secondary" onPress={handleCancel} />
          </View>
        ) : (
          <FlatList
            data={error ? [] : candidates}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: space.xxl }}
            ListHeaderComponent={
              <View style={{ gap: space.md, marginBottom: space.sm }}>
                <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
                  {photoPreview ? <Image source={{ uri: photoPreview }} style={{ width: 56, height: 76, borderRadius: radii.xs, backgroundColor: colors.surfaceRaised }} accessibilityLabel="Ảnh bìa đã chụp" /> : null}
                  <View style={{ flex: 1, gap: space.xs }}>
                    <Text style={type.heading}>{error ? 'Chưa tìm được' : candidates.length > 0 ? `${candidates.length} sách có thể khớp` : 'Không có sách khớp'}</Text>
                    {ocrTitle ? <Text style={type.caption} numberOfLines={2}>Đọc được trên bìa: {ocrTitle}</Text> : null}
                  </View>
                </View>
                <Button label="Chụp ảnh khác" icon="camera-outline" variant="secondary" size="md" onPress={() => setCameraOpen(true)} />
                {error ? <InlineAlert message={error} actionLabel="Thử lại với ảnh này" onAction={handleRetry} /> : null}
              </View>
            }
            ListEmptyComponent={
              !error ? (
                <EmptyState icon="search-outline" title="Không tìm thấy sách khớp" message="Thử chụp lại ở nơi đủ sáng, giữ bìa thẳng trong khung hình, hoặc tìm theo tên sách." actionLabel="Tìm theo tên" onAction={() => router.push('/customer/search')} compact />
              ) : undefined
            }
            renderItem={({ item }) => {
              const confidence = confidenceView(item.confidence);
              return (
                <PressableScale
                  onPress={() => router.push(`/customer/book/${item.id}`)}
                  scale={false}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}, ${item.author ?? 'chưa rõ tác giả'}, ${confidence.label}`}
                  style={{ flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                  pressedStyle={{ backgroundColor: colors.surfaceRaised }}
                >
                  <BookCover title={item.title} author={item.author} category={item.category} coverImageUrl={item.cover_image_url} width={64} />
                  <View style={{ flex: 1, justifyContent: 'center', gap: 6 }}>
                    <Text style={{ fontFamily: fontFamily.serif, fontSize: 17, lineHeight: 22, color: colors.textPrimary }} numberOfLines={2}>{item.title}</Text>
                    <Text style={type.caption} numberOfLines={1}>{item.author ?? 'Chưa rõ tác giả'}</Text>
                    <StatusBadge tone={confidence.tone} label={confidence.label} icon={confidence.tone === 'success' ? 'checkmark-circle' : 'help-circle'} />
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={{ alignSelf: 'center' }} />
                </PressableScale>
              );
            }}
          />
        )}
      </View>

      <PhotoCaptureModal visible={cameraOpen} onCaptured={handleCaptured} onClose={() => setCameraOpen(false)} />
    </>
  );
}
