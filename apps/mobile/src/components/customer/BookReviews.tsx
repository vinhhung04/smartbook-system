import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as engagementApi from '../../api/customerEngagement';
import type { MyReview, PublicReview, PublicReviewPage } from '../../api/customerEngagement';
import { ApiError } from '../../api/client';
import { MAX_REVIEW_COMMENT, reviewMode, validateReview } from '../../lib/reviewForm';
import { useSubmitLock } from '../../lib/submitLock';
import { colors, fonts, radius, spacing, typography } from '../../theme/customerTokens';

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={styles.stars} accessible accessibilityLabel={`${value} trên 5 sao`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={value >= n ? 'star' : value >= n - 0.5 ? 'star-half' : 'star-outline'} size={size} color={colors.warning} />
      ))}
    </View>
  );
}

function StarPicker({ value, onChange, disabled }: { value: number | null; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={`Chọn số sao, hiện ${value ?? 0}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange(n)} disabled={disabled} hitSlop={6} style={styles.starButton} accessibilityRole="button" accessibilityLabel={`${n} sao`}>
          <Ionicons name={(value ?? 0) >= n ? 'star' : 'star-outline'} size={30} color={colors.warning} />
        </Pressable>
      ))}
    </View>
  );
}

export function BookReviews({ bookId }: { bookId: string }) {
  const [page, setPage] = useState<PublicReviewPage | null>(null);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<MyReview | null>(null);
  const [canReview, setCanReview] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useSubmitLock();

  const load = useCallback(async () => {
    setError(null);
    const [publicResult, mineResult] = await Promise.allSettled([engagementApi.getBookReviews(bookId, 1, 5), engagementApi.getMyReviewForBook(bookId)]);
    if (publicResult.status === 'fulfilled') {
      setPage(publicResult.value);
      setReviews(publicResult.value.data);
    } else {
      setError('Không tải được đánh giá');
    }
    if (mineResult.status === 'fulfilled') {
      setMine(mineResult.value.data);
      setCanReview(mineResult.value.can_review);
    }
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!page || loadingMore || page.meta.page >= page.meta.totalPages) return;
    setLoadingMore(true);
    try {
      const next = await engagementApi.getBookReviews(bookId, page.meta.page + 1, 5);
      setPage(next);
      setReviews((current) => [...current, ...next.data.filter((r) => !current.some((c) => c.id === r.id))]);
    } catch {
      setError('Không tải thêm được đánh giá');
    } finally {
      setLoadingMore(false);
    }
  }

  function startEditing() {
    setRating(mine?.rating ?? null);
    setComment(mine?.comment ?? '');
    setFormError(null);
    setEditing(true);
  }

  async function handleSave() {
    const check = validateReview(rating, comment);
    if (!check.ok) {
      setFormError(check.error);
      return;
    }
    await lock.run(async () => {
      setSaving(true);
      setFormError(null);
      try {
        await engagementApi.saveMyReview(bookId, check.rating, check.comment);
        setEditing(false);
        await load();
      } catch (err) {
        setFormError(err instanceof ApiError ? err.message : 'Không lưu được đánh giá');
      } finally {
        setSaving(false);
      }
    });
  }

  function handleDelete() {
    Alert.alert('Xóa đánh giá?', 'Đánh giá của bạn sẽ bị xóa khỏi trang sách.', [
      { text: 'Giữ lại', style: 'cancel' },
      {
        text: 'Xóa',
        style: 'destructive',
        onPress: () =>
          void lock.run(async () => {
            setSaving(true);
            try {
              await engagementApi.deleteMyReview(bookId);
              setEditing(false);
              await load();
            } catch (err) {
              Alert.alert('Không xóa được', err instanceof ApiError ? err.message : 'Vui lòng thử lại.');
            } finally {
              setSaving(false);
            }
          }),
      },
    ]);
  }

  const mode = reviewMode(canReview, Boolean(mine));
  const stats = page?.stats;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Đánh giá của bạn đọc</Text>
      {stats && stats.totalReviews > 0 ? (
        <View style={styles.summary}>
          <Text style={styles.average}>{stats.averageRating.toFixed(1)}</Text>
          <View>
            <Stars value={stats.averageRating} />
            <Text style={styles.caption}>{stats.totalReviews} đánh giá</Text>
          </View>
        </View>
      ) : !error ? (
        <Text style={styles.caption}>Chưa có đánh giá nào cho cuốn sách này.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {editing ? (
        <View style={styles.form}>
          <StarPicker value={rating} onChange={setRating} disabled={saving} />
          <TextInput
            style={styles.input}
            value={comment}
            onChangeText={setComment}
            placeholder="Cảm nhận của bạn về cuốn sách (không bắt buộc)"
            placeholderTextColor={colors.textMuted}
            multiline
            maxLength={MAX_REVIEW_COMMENT}
            editable={!saving}
            accessibilityLabel="Nhận xét"
          />
          <Text style={styles.counter}>{comment.trim().length}/{MAX_REVIEW_COMMENT}</Text>
          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          <View style={styles.formActions}>
            <Pressable style={styles.secondary} onPress={() => setEditing(false)} disabled={saving} accessibilityRole="button">
              <Text style={styles.secondaryText}>Hủy</Text>
            </Pressable>
            <Pressable style={[styles.primary, saving && styles.disabled]} onPress={handleSave} disabled={saving} accessibilityRole="button">
              {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.primaryText}>Lưu đánh giá</Text>}
            </Pressable>
          </View>
        </View>
      ) : mode === 'edit' && mine ? (
        <View style={styles.mine}>
          <Text style={styles.mineLabel}>Đánh giá của bạn</Text>
          <Stars value={mine.rating} />
          {mine.comment ? <Text style={styles.comment}>{mine.comment}</Text> : null}
          <View style={styles.formActions}>
            <Pressable style={styles.secondary} onPress={handleDelete} disabled={saving} accessibilityRole="button">
              <Text style={[styles.secondaryText, { color: colors.danger }]}>Xóa</Text>
            </Pressable>
            <Pressable style={styles.primary} onPress={startEditing} accessibilityRole="button">
              <Text style={styles.primaryText}>Sửa đánh giá</Text>
            </Pressable>
          </View>
        </View>
      ) : mode === 'write' ? (
        <Pressable style={styles.primary} onPress={startEditing} accessibilityRole="button">
          <Text style={styles.primaryText}>Viết đánh giá</Text>
        </Pressable>
      ) : mode === 'not-eligible' ? (
        <Text style={styles.caption}>Bạn có thể đánh giá sau khi đã mượn và trả cuốn sách này.</Text>
      ) : null}

      {reviews.map((review) => (
        <View key={review.id} style={styles.review}>
          <View style={styles.reviewHeader}>
            <Text style={styles.reviewer}>{review.reviewer_name}</Text>
            <Stars value={review.rating} size={12} />
          </View>
          {review.comment ? <Text style={styles.comment}>{review.comment}</Text> : null}
          <Text style={styles.caption}>{new Date(review.created_at).toLocaleDateString('vi-VN')}</Text>
        </View>
      ))}
      {page && page.meta.page < page.meta.totalPages ? (
        <Pressable style={styles.secondary} onPress={loadMore} disabled={loadingMore} accessibilityRole="button">
          {loadingMore ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.secondaryText}>Xem thêm đánh giá</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm },
  sectionLabel: { ...typography.label },
  summary: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  average: { ...typography.h1, fontSize: 36 },
  stars: { flexDirection: 'row', gap: 2, alignItems: 'center' },
  starButton: { padding: 2 },
  caption: { ...typography.caption },
  error: { color: colors.danger, fontWeight: '600' },
  form: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  input: {
    minHeight: 96,
    textAlignVertical: 'top',
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  counter: { ...typography.caption, fontSize: 11, textAlign: 'right' },
  formActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  primary: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontFamily: fonts.bodySemibold, color: colors.onPrimary },
  secondary: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontFamily: fonts.bodySemibold, color: colors.textSecondary },
  disabled: { opacity: 0.6 },
  mine: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primaryBorder },
  mineLabel: { ...typography.label, color: colors.primary },
  review: { gap: 4, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewer: { ...typography.bodyBold, fontSize: 14 },
  comment: { ...typography.body, fontSize: 14, lineHeight: 20 },
});
