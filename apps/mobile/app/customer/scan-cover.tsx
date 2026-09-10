import { useState } from 'react';
import { Stack, router } from 'expo-router';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

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

export default function CustomerScanCoverScreen() {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<CoverSearchCandidate[]>([]);
  const [ocrTitle, setOcrTitle] = useState<string | null>(null);

  async function handleCaptured(photoDataUrl: string) {
    setCameraOpen(false);
    setPhotoPreview(photoDataUrl);
    setIsSearching(true);
    setError(null);
    try {
      const result = await coverSearchApi.findBookByCover(photoDataUrl);
      setCandidates(result.candidates);
      setOcrTitle(result.signals.ocr_extracted?.title ?? null);
      setSearched(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể tìm sách từ ảnh này');
    } finally {
      setIsSearching(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Tìm sách bằng ảnh bìa' }} />
      <View style={styles.container}>
        {!searched && !isSearching ? (
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
        ) : (
          <>
            <View style={styles.searchedHeader}>
              {photoPreview && <Image source={{ uri: photoPreview }} style={styles.photoThumb} />}
              <View style={styles.searchedHeaderBody}>
                {isSearching ? (
                  <View style={styles.searchingRow}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={styles.searchingText}>Đang tìm sách khớp...</Text>
                  </View>
                ) : (
                  <>
                    {ocrTitle && (
                      <Text style={styles.ocrHint} numberOfLines={2}>
                        Đọc được trên bìa: {ocrTitle}
                      </Text>
                    )}
                    <Pressable onPress={() => setCameraOpen(true)} hitSlop={8}>
                      <Text style={styles.retakeText}>Chụp ảnh khác</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            {!isSearching && (
              <FlatList
                data={candidates}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                  !error ? (
                    <View style={styles.emptyResult}>
                      <Ionicons name="search-outline" size={24} color={colors.textMuted} />
                      <Text style={styles.emptyResultText}>
                        Không tìm thấy sách khớp. Thử chụp lại ở nơi đủ sáng, giữ bìa thẳng trong khung hình.
                      </Text>
                    </View>
                  ) : null
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
  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchingText: {
    ...typography.caption,
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
