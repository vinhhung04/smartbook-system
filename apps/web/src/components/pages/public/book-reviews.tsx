import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { publicCatalogService, type PublicReviewPage } from '@/services/public-catalog';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { useAuthUser } from '@/hooks/useAuthUser';
import { buildLoginUrl } from '@/lib/return-url';

function StarRating({ value, onChange, size = 18, label }: { value: number; onChange?: (value: number) => void; size?: number; label?: string }) {
  const [hover, setHover] = useState(0);
  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-0.5" role="img" aria-label={label || `${value} trên 5 sao`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <Star key={star} size={size} aria-hidden="true" className={star <= value ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-muted-foreground/40'} />
        ))}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5" role="radiogroup" aria-label="Chọn số sao">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} sao`}
          onClick={() => onChange(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          className="rounded-sm p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
        >
          <Star size={size} aria-hidden="true" className={star <= (hover || value) ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-muted-foreground/40'} />
        </button>
      ))}
    </span>
  );
}

/** Signed-in readers write or update their own review; the list itself is public. */
function ReviewForm({ bookId, onSaved }: { bookId: string; onSaved: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [hasReview, setHasReview] = useState(false);
  const [busy, setBusy] = useState(false);
  // false = no returned loan of this book yet (server rule); null = unknown, let the POST decide.
  const [canReview, setCanReview] = useState<boolean | null>(null);

  useEffect(() => {
    customerBorrowService.getMyReviewForBook(bookId)
      .then((res) => {
        setCanReview(typeof res?.can_review === 'boolean' ? res.can_review : null);
        if (res?.data) {
          setHasReview(true);
          setRating(res.data.rating);
          setComment(res.data.comment || '');
        }
      })
      .catch(() => {});
  }, [bookId]);

  const save = async () => {
    if (rating < 1) { toast.error('Chọn số sao trước khi gửi.'); return; }
    try {
      setBusy(true);
      await customerBorrowService.submitReview({ book_id: bookId, rating, comment: comment.trim() || undefined });
      toast.success(hasReview ? 'Đã cập nhật đánh giá' : 'Đã gửi đánh giá');
      setHasReview(true);
      onSaved();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Chưa gửi được đánh giá'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      setBusy(true);
      await customerBorrowService.deleteMyReview(bookId);
      toast.success('Đã xóa đánh giá');
      setHasReview(false);
      setRating(0);
      setComment('');
      onSaved();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Chưa xóa được đánh giá'));
    } finally {
      setBusy(false);
    }
  };

  if (canReview === false && !hasReview) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 text-[13.5px] text-muted-foreground sm:p-6" data-testid="review-not-eligible">
        Bạn có thể đánh giá cuốn sách này sau khi đã mượn và trả sách.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h3 className="text-[14px] font-semibold">{hasReview ? 'Đánh giá của bạn' : 'Viết đánh giá'}</h3>
      <div className="mt-2"><StarRating value={rating} onChange={setRating} size={24} /></div>
      <label className="mt-3 block">
        <span className="sr-only">Nhận xét</span>
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Cuốn sách này thế nào với bạn? (không bắt buộc)"
          className="w-full resize-none rounded-md border border-border bg-card px-3 py-2.5 text-[13.5px] outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={busy || rating < 1} className="h-9 rounded-full bg-indigo-700 px-4 text-[13px] font-semibold text-white hover:bg-indigo-800 disabled:opacity-50 dark:bg-indigo-500">
          {busy ? 'Đang lưu…' : hasReview ? 'Cập nhật đánh giá' : 'Gửi đánh giá'}
        </button>
        {hasReview ? (
          <button type="button" onClick={() => void remove()} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950/30">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Xóa
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function BookReviews({ bookId }: { bookId: string }) {
  const { isAuthenticated, isCustomer } = useAuthUser();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PublicReviewPage | null>(null);
  const [error, setError] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);
  const load = (nextPage: number) => {
    setError(false);
    setPage(nextPage);
    setReloadKey((key) => key + 1);
  };

  useEffect(() => {
    let active = true;
    publicCatalogService.getReviews(bookId, page)
      .then((result) => { if (active) { setData(result); setError(false); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [bookId, page, reloadKey]);

  const stats = data?.stats;

  return (
    <section id="danh-gia" aria-labelledby="danh-gia-heading" className="scroll-mt-24">
      <p className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-indigo-700 dark:text-indigo-300">Đánh giá</p>
      <h2 id="danh-gia-heading" className="font-serif text-[26px] font-semibold leading-[1.1] tracking-tight sm:text-[32px]">Đánh giá của bạn đọc</h2>

      <div className="mt-5 grid gap-8 lg:grid-cols-[260px_1fr]">
        <div className="space-y-5">
          {stats ? (
            <div>
              <p className="font-serif text-[44px] font-semibold leading-none">{stats.totalReviews ? stats.averageRating.toFixed(1) : '—'}</p>
              <div className="mt-2"><StarRating value={Math.round(stats.averageRating)} label={`Điểm trung bình ${stats.averageRating} trên 5`} /></div>
              <p className="mt-1 text-[13px] text-muted-foreground">{stats.totalReviews} đánh giá</p>
              <dl className="mt-4 space-y-1.5">
                {([5, 4, 3, 2, 1] as const).map((star) => {
                  const count = stats.distribution[star] || 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-[12px]">
                      <dt className="w-8 text-muted-foreground">{star} sao</dt>
                      <dd className="flex flex-1 items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-amber-400" style={{ width: stats.totalReviews ? `${(count / stats.totalReviews) * 100}%` : '0%' }} />
                        </span>
                        <span className="w-6 text-right tabular-nums text-muted-foreground">{count}</span>
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ) : !error ? <div className="h-40 animate-pulse rounded-md bg-muted/60" aria-hidden="true" /> : null}

          {isCustomer ? null : !isAuthenticated ? (
            <p className="text-[13px] text-muted-foreground">
              <Link to={buildLoginUrl(`/books/${bookId}#danh-gia`)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Đăng nhập</Link> để viết đánh giá.
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          {isCustomer ? <ReviewForm bookId={bookId} onSaved={() => load(1)} /> : null}

          {error ? (
            <p className="text-[13px] text-muted-foreground">
              Chưa tải được đánh giá. <button type="button" onClick={() => load(page)} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Thử lại</button>
            </p>
          ) : data && data.data.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-[13.5px] text-muted-foreground">
              Chưa có đánh giá nào cho cuốn sách này.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {data?.data.map((review) => (
                <li key={review.id} className="py-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13.5px] font-semibold">{review.reviewer_name}</p>
                    <time dateTime={review.created_at} className="text-[12px] text-muted-foreground">{new Date(review.created_at).toLocaleDateString('vi-VN')}</time>
                  </div>
                  <div className="mt-1"><StarRating value={review.rating} size={13} /></div>
                  {review.comment ? <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/85">{review.comment}</p> : null}
                </li>
              ))}
            </ul>
          )}

          {data && data.meta.totalPages > 1 ? (
            <div className="flex items-center justify-center gap-3 pt-2 text-[13px]">
              <button type="button" disabled={page <= 1} onClick={() => load(page - 1)} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">Trang trước</button>
              <span className="text-muted-foreground">Trang {page} / {data.meta.totalPages}</span>
              <button type="button" disabled={page >= data.meta.totalPages} onClick={() => load(page + 1)} className="rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-40">Trang sau</button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
