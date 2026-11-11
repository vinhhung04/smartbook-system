import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import * as engagementApi from '../../api/customerEngagement';
import type { MyReview, PublicReview, PublicReviewPage } from '../../api/customerEngagement';
import { ApiError } from '../../api/client';
import { MAX_REVIEW_COMMENT, reviewMode, validateReview } from '../../lib/reviewForm';
import { useSubmitLock } from '../../lib/submitLock';
import { Button, Card, InlineAlert, SectionHeader, TextField, fontFamily, radii, space, useTheme } from '../../design-system';

const STAR = '#C98A0B';

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }} accessible accessibilityLabel={`${value} trên 5 sao`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={value >= n ? 'star' : value >= n - 0.5 ? 'star-half' : 'star-outline'} size={size} color={STAR} />
      ))}
    </View>
  );
}

function StarPicker({ value, onChange, disabled }: { value: number | null; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }} accessibilityRole="adjustable" accessibilityLabel={`Chọn số sao, hiện ${value ?? 0}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          onPress={() => onChange(n)}
          disabled={disabled}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          accessibilityRole="button"
          accessibilityState={{ selected: (value ?? 0) >= n }}
          accessibilityLabel={`${n} sao`}
        >
          <Ionicons name={(value ?? 0) >= n ? 'star' : 'star-outline'} size={30} color={STAR} />
        </Pressable>
      ))}
    </View>
  );
}

export function BookReviews({ bookId }: { bookId: string }) {
  const { colors, type } = useTheme();
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
    <View style={{ gap: space.md }}>
      <SectionHeader title="Đánh giá của bạn đọc" />
      {stats && stats.totalReviews > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text style={{ fontFamily: fontFamily.serif, fontSize: 40, lineHeight: 44, color: colors.textPrimary }}>{stats.averageRating.toFixed(1)}</Text>
          <View style={{ gap: 2 }}>
            <Stars value={stats.averageRating} size={16} />
            <Text style={type.caption}>{stats.totalReviews} đánh giá</Text>
          </View>
        </View>
      ) : !error ? (
        <Text style={type.caption}>Chưa có đánh giá nào cho cuốn sách này.</Text>
      ) : null}
      {error ? <InlineAlert message={error} actionLabel="Thử lại" onAction={() => void load()} /> : null}

      {editing ? (
        <Card>
          <Text style={type.bodyStrong}>Bạn chấm cuốn này mấy sao?</Text>
          <StarPicker value={rating} onChange={setRating} disabled={saving} />
          <TextField
            label="Nhận xét"
            value={comment}
            onChangeText={setComment}
            placeholder="Cảm nhận của bạn (không bắt buộc)"
            multiline
            maxLength={MAX_REVIEW_COMMENT}
            editable={!saving}
            hint={`${comment.trim().length}/${MAX_REVIEW_COMMENT} ký tự`}
            error={formError}
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label="Hủy" variant="secondary" size="md" onPress={() => setEditing(false)} disabled={saving} /></View>
            <View style={{ flex: 1 }}><Button label="Lưu đánh giá" size="md" loading={saving} onPress={handleSave} /></View>
          </View>
        </Card>
      ) : mode === 'edit' && mine ? (
        <Card>
          <Text style={type.bodyStrong}>Đánh giá của bạn</Text>
          <Stars value={mine.rating} size={16} />
          {mine.comment ? <Text style={type.body}>{mine.comment}</Text> : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}><Button label="Xóa" icon="trash-outline" variant="secondary" size="md" onPress={handleDelete} disabled={saving} /></View>
            <View style={{ flex: 1 }}><Button label="Sửa đánh giá" icon="create-outline" size="md" onPress={startEditing} /></View>
          </View>
        </Card>
      ) : mode === 'write' ? (
        <Button label="Viết đánh giá" icon="create-outline" variant="secondary" onPress={startEditing} />
      ) : mode === 'not-eligible' ? (
        <Text style={type.caption}>Bạn có thể đánh giá sau khi đã mượn và trả cuốn sách này.</Text>
      ) : null}

      {reviews.map((review) => (
        <View key={review.id} style={{ gap: space.xs, padding: space.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
            <Text style={type.bodyStrong} numberOfLines={1}>{review.reviewer_name}</Text>
            <Stars value={review.rating} size={13} />
          </View>
          {review.comment ? <Text style={type.body}>{review.comment}</Text> : null}
          <Text style={type.caption}>{new Date(review.created_at).toLocaleDateString('vi-VN')}</Text>
        </View>
      ))}
      {page && page.meta.page < page.meta.totalPages ? (
        <Button label="Xem thêm đánh giá" variant="ghost" loading={loadingMore} onPress={loadMore} />
      ) : null}
    </View>
  );
}
