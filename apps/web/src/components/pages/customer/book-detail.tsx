import { useEffect, useState, useCallback } from 'react';
import { NavLink, useParams } from 'react-router';
import { motion } from 'motion/react';
import { customerCatalogService, CustomerCatalogBook } from '@/services/customer-catalog';
import { getApiErrorMessage } from '@/services/api';
import { customerBorrowService } from '@/services/customer-borrow';
import { toast } from 'sonner';
import { EmptyState } from '@/components/ui/empty-state';
import { BookOpen, ChevronRight, Heart, MessageSquare, ShoppingCart, Sparkles, Star, Trash2 } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { ReserveModal } from './_shared/reserve-modal';

interface BookReview {
  id: string;
  customer_id: string;
  book_id: string;
  rating: number;
  comment: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  customers: { id: string; customer_code: string; full_name: string };
}

interface ReviewStats {
  averageRating: number;
  totalReviews: number;
}

function StarRating({ value, onChange, size = 20, readonly = false }: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
  readonly?: boolean;
}) {
  const [hover, setHover] = useState(0);
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          aria-label={`${star} sao`}
          className={`transition-colors ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'}`}
        >
          <Star
            size={size}
            className={`transition-colors ${
              star <= (hover || value)
                ? 'fill-amber-400 text-amber-400'
                : 'fill-transparent text-slate-300 dark:text-slate-600'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

function ReviewSection({ bookId }: { bookId: string }) {
  const [reviews, setReviews] = useState<BookReview[]>([]);
  const [stats, setStats] = useState<ReviewStats>({ averageRating: 0, totalReviews: 0 });
  const [myReview, setMyReview] = useState<BookReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadReviews = useCallback(async (p = 1) => {
    try {
      setLoading(true);
      const [reviewsRes, myRes] = await Promise.all([
        customerBorrowService.getBookReviews(bookId, { page: p, pageSize: 10 }),
        customerBorrowService.getMyReviewForBook(bookId).catch(() => ({ data: null })),
      ]);
      setReviews(reviewsRes.data || []);
      setStats(reviewsRes.stats || { averageRating: 0, totalReviews: 0 });
      setPage(reviewsRes.meta?.page || 1);
      setTotalPages(reviewsRes.meta?.totalPages || 1);
      if (myRes.data) {
        setMyReview(myRes.data);
        setRating(myRes.data.rating);
        setComment(myRes.data.comment || '');
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, [bookId]);

  useEffect(() => { void loadReviews(); }, [loadReviews]);

  const handleSubmit = async () => {
    if (rating < 1) { toast.error('Vui lòng chọn điểm đánh giá'); return; }
    try {
      setSubmitting(true);
      await customerBorrowService.submitReview({ book_id: bookId, rating, comment: comment.trim() || undefined });
      toast.success(myReview ? 'Đã cập nhật đánh giá!' : 'Đã gửi đánh giá!');
      await loadReviews(page);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Gửi đánh giá thất bại'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      setDeleting(true);
      await customerBorrowService.deleteMyReview(bookId);
      toast.success('Đã xóa đánh giá');
      setMyReview(null);
      setRating(0);
      setComment('');
      await loadReviews(1);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Xóa đánh giá thất bại'));
    } finally {
      setDeleting(false);
    }
  };

  const ratingDistribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((r) => r.rating === star).length,
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.3 }}
      className="space-y-5"
    >
      {/* Summary Bar */}
      <div className="rounded-xl border border-black/5 bg-card p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-4.5 h-4.5 text-amber-600" />
          <h2 className="text-[15px] font-semibold text-foreground">Đánh giá & nhận xét</h2>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 animate-pulse">
            <div className="h-12 w-12 bg-muted rounded-xl" />
            <div className="space-y-2 flex-1">
              <div className="h-4 bg-muted rounded w-1/3" />
              <div className="h-3 bg-muted rounded w-1/4" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-start gap-6">
            {/* Score */}
            <div className="text-center shrink-0">
              <div className="text-[36px] font-bold text-foreground leading-none">
                {stats.averageRating > 0 ? stats.averageRating.toFixed(1) : '—'}
              </div>
              <StarRating value={Math.round(stats.averageRating)} readonly size={16} />
              <p className="text-[12px] text-muted-foreground mt-1">
                {stats.totalReviews} đánh giá
              </p>
            </div>

            {/* Distribution bars */}
            <div className="flex-1 w-full space-y-1.5">
              {ratingDistribution.map((row) => (
                <div key={row.star} className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-4 text-right">{row.star}</span>
                  <Star size={12} className="fill-amber-400 text-amber-400 shrink-0" />
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-400 transition-all"
                      style={{ width: stats.totalReviews > 0 ? `${(row.count / stats.totalReviews) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className="text-[11px] text-muted-foreground w-5">{row.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Write Review */}
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/40 to-violet-50/30 p-5">
        <h3 className="text-[13px] font-semibold text-foreground mb-3">
          {myReview ? 'Cập nhật đánh giá của bạn' : 'Viết đánh giá'}
        </h3>
        <div className="space-y-3">
          <div>
            <p className="text-[12px] text-muted-foreground mb-1.5">Điểm của bạn</p>
            <StarRating value={rating} onChange={setRating} size={24} />
          </div>
          <textarea
            placeholder="Chia sẻ cảm nhận của bạn về cuốn sách này... (không bắt buộc)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-input bg-card px-4 py-3 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-primary/10 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleSubmit()}
              disabled={submitting || rating < 1}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Đang gửi...' : myReview ? 'Cập nhật đánh giá' : 'Gửi đánh giá'}
            </button>
            {myReview && (
              <button
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-600 text-[13px] font-medium hover:bg-rose-100 disabled:opacity-50 transition-colors dark:border-rose-800/40 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-900/40"
              >
                <Trash2 size={14} />
                {deleting ? 'Đang xóa...' : 'Xóa'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Reviews List */}
      <div className="space-y-3">
        {reviews.length === 0 && !loading ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/50 py-8 text-center">
            <MessageSquare className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-[13px] text-muted-foreground">Chưa có đánh giá nào. Hãy là người đầu tiên chia sẻ cảm nhận!</p>
          </div>
        ) : (
          reviews.map((review) => (
            <div key={review.id} className="rounded-xl border border-black/5 bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-950/40 flex items-center justify-center shrink-0">
                    <span className="text-[13px] font-semibold text-indigo-600 dark:text-indigo-400">
                      {review.customers?.full_name?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{review.customers?.full_name || 'Bạn đọc ẩn danh'}</p>
                    <StarRating value={review.rating} readonly size={13} />
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {new Date(review.created_at).toLocaleDateString('vi-VN')}
                </span>
              </div>
              {review.comment && (
                <p className="mt-2.5 text-[13px] text-muted-foreground leading-relaxed">{review.comment}</p>
              )}
            </div>
          ))
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 pt-2">
            <button
              disabled={page <= 1}
              onClick={() => void loadReviews(page - 1)}
              className="px-3 py-1.5 rounded-lg border text-[12px] disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Trang trước
            </button>
            <span className="text-[12px] text-muted-foreground">
              Trang {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => void loadReviews(page + 1)}
              className="px-3 py-1.5 rounded-lg border text-[12px] disabled:opacity-40 hover:bg-muted transition-colors"
            >
              Trang sau
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

const DESCRIPTION_PREVIEW_CHARS = 480;

export function CustomerBookDetailPage() {
  const { id } = useParams();
  const [book, setBook] = useState<CustomerCatalogBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReserveModal, setShowReserveModal] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [rating, setRating] = useState<ReviewStats | null>(null);
  const [inWishlist, setInWishlist] = useState(false);
  const [wishlistBusy, setWishlistBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await customerCatalogService.getBookById(id);
      setBook(data);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Không tải được chi tiết sách'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Rating summary and wishlist state are nice-to-have: failing to load them must not break the page.
  useEffect(() => {
    if (!id) return;
    customerBorrowService.getBookRatingStats([id])
      .then((res) => setRating(res.data?.[id] || null))
      .catch(() => {});
    customerBorrowService.getMyWishlist()
      .then((res) => setInWishlist(Array.isArray(res?.data) && res.data.some((item: { book_id: string }) => item.book_id === id)))
      .catch(() => {});
  }, [id]);

  const toggleWishlist = async () => {
    if (!id) return;
    try {
      setWishlistBusy(true);
      if (inWishlist) {
        await customerBorrowService.removeFromWishlist(id);
        setInWishlist(false);
        toast.success('Đã xóa khỏi danh sách yêu thích');
      } else {
        await customerBorrowService.addToWishlist(id);
        setInWishlist(true);
        toast.success('Đã thêm vào danh sách yêu thích');
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Không thể cập nhật danh sách yêu thích'));
    } finally {
      setWishlistBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6 lg:p-8" aria-busy="true">
        <div className="grid animate-pulse gap-8 md:grid-cols-[260px_1fr]">
          <div className="aspect-[3/4] rounded-2xl bg-muted" />
          <div className="space-y-3">
            <div className="h-4 w-1/4 rounded bg-muted" />
            <div className="h-8 w-3/4 rounded bg-muted" />
            <div className="h-4 w-1/2 rounded bg-muted" />
            <div className="h-24 rounded-xl bg-muted" />
          </div>
        </div>
      </div>
    );
  }
  if (error) return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <EmptyState variant="error" title="Không tải được sách" description={error}
        action={<button onClick={() => void load()} className="font-medium text-primary hover:underline">Thử lại</button>} />
    </div>
  );
  if (!book) return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <EmptyState variant="no-data" title="Không tìm thấy sách" description="Sách này có thể không còn trong danh mục."
        action={<NavLink to="/customer/books" className="font-medium text-primary hover:underline">Quay lại danh mục</NavLink>} />
    </div>
  );

  const availableStock = Number(book.available_quantity ?? book.quantity ?? 0);
  const isAvailable = availableStock > 0;
  const isReservable = Boolean(book.reservable && isAvailable);
  const description = (book.description || '').trim();
  const longDescription = description.length > DESCRIPTION_PREVIEW_CHARS;
  const shownDescription = longDescription && !descriptionExpanded ? `${description.slice(0, DESCRIPTION_PREVIEW_CHARS).trimEnd()}…` : description;
  const details = [
    { label: 'Tác giả', value: book.author },
    { label: 'Nhà xuất bản', value: book.publisher },
    { label: 'Năm xuất bản', value: book.publish_year ? String(book.publish_year) : '' },
    { label: 'Thể loại', value: book.category },
    { label: 'Ngôn ngữ', value: book.language || 'vi' },
    { label: 'ISBN', value: book.isbn, mono: true },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6 lg:p-8">
      <NavLink to="/customer/books" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
        Quay lại danh mục
      </NavLink>

      <div className="grid gap-6 md:grid-cols-[260px_1fr] md:gap-10">
        {/* Cover */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto w-full max-w-[260px] md:sticky md:top-20 md:self-start">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-md">
            {book.cover_image_url ? (
              <img src={book.cover_image_url} alt={`Bìa sách ${book.title}`} className="aspect-[3/4] w-full object-cover" />
            ) : (
              <div className="flex aspect-[3/4] items-center justify-center bg-gradient-to-br from-indigo-100 via-blue-50 to-cyan-50 dark:from-indigo-950/40 dark:via-card dark:to-cyan-950/30">
                <div className="p-6 text-center">
                  <BookOpen className="mx-auto mb-3 h-12 w-12 text-indigo-300 dark:text-indigo-700" aria-hidden="true" />
                  <p className="text-[12px] text-indigo-400 dark:text-indigo-500">{book.category || 'Sách'}</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Title, availability, actions */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.3 }} className="min-w-0">
          {book.category ? (
            <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">{book.category}</span>
          ) : null}
          <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-tight text-foreground sm:text-[30px]">{book.title}</h1>
          {book.subtitle ? <p className="mt-1 text-[15px] text-muted-foreground">{book.subtitle}</p> : null}
          <p className="mt-3 text-[14px] text-foreground">
            {book.author || 'Không rõ tác giả'}
            {book.publisher || book.publish_year ? (
              <span className="text-muted-foreground"> · {[book.publisher, book.publish_year].filter(Boolean).join(', ')}</span>
            ) : null}
          </p>

          <div className="mt-2 flex items-center gap-1.5 text-[13px]">
            {rating && rating.totalReviews > 0 ? (
              <>
                <Star size={15} className="fill-amber-400 text-amber-400" aria-hidden="true" />
                <span className="font-semibold text-foreground">{rating.averageRating}</span>
                <a href="#danh-gia" className="text-muted-foreground hover:underline">({rating.totalReviews} đánh giá)</a>
              </>
            ) : (
              <a href="#danh-gia" className="text-muted-foreground hover:underline">Chưa có đánh giá — hãy là người đầu tiên</a>
            )}
          </div>

          <div className={cn(
            'mt-5 rounded-2xl border p-4 sm:p-5',
            isAvailable
              ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/40 dark:bg-emerald-950/20'
              : 'border-rose-200 bg-rose-50/60 dark:border-rose-900/40 dark:bg-rose-950/20',
          )}>
            <p className={cn('flex items-center gap-2 text-[14px] font-semibold', isAvailable ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400')}>
              <span className={cn('h-2.5 w-2.5 rounded-full', isAvailable ? 'bg-emerald-500' : 'bg-rose-500')} aria-hidden="true" />
              {isAvailable ? `Còn ${availableStock} cuốn sẵn sàng` : 'Hiện đã hết sách'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setShowReserveModal(true)}
                disabled={!isReservable}
                data-testid="reserve-book-button"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShoppingCart className="h-4 w-4" aria-hidden="true" />
                Đặt trước
              </button>
              <button
                onClick={() => void toggleWishlist()}
                disabled={wishlistBusy}
                aria-pressed={inWishlist}
                className={cn(
                  'inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[14px] font-medium transition-colors disabled:opacity-60',
                  inWishlist
                    ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-950/30 dark:text-rose-400'
                    : 'border-border bg-card text-foreground hover:bg-muted',
                )}
              >
                <Heart className={cn('h-4 w-4', inWishlist && 'fill-current')} aria-hidden="true" />
                {inWishlist ? 'Đã yêu thích' : 'Yêu thích'}
              </button>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
              {isAvailable
                ? 'Sách được giữ cho bạn trong thời gian giới hạn — hãy đến thư viện nhận sách trước khi hết hạn.'
                : 'Bạn có thể thêm vào yêu thích để theo dõi và được báo khi sách có hàng.'}
            </p>
          </div>

          <section className="mt-8" aria-labelledby="gioi-thieu">
            <h2 id="gioi-thieu" className="text-[16px] font-semibold">Giới thiệu</h2>
            {description ? (
              <>
                <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-foreground/80">{shownDescription}</p>
                {longDescription ? (
                  <button type="button" onClick={() => setDescriptionExpanded((open) => !open)} aria-expanded={descriptionExpanded} className="mt-1 text-[13px] font-medium text-primary hover:underline">
                    {descriptionExpanded ? 'Thu gọn' : 'Xem thêm'}
                  </button>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-[13px] italic text-muted-foreground">Chưa có mô tả cho sách này.</p>
            )}
          </section>

          {book.summary_vi ? (
            <section className="mt-5 rounded-xl border border-cyan-200/60 bg-cyan-50/50 p-4 dark:border-cyan-900/30 dark:bg-cyan-950/20">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-cyan-800 dark:text-cyan-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Tóm tắt do AI tạo
              </h2>
              <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-cyan-900 dark:text-cyan-200">{book.summary_vi}</p>
            </section>
          ) : null}

          <section className="mt-8" aria-labelledby="thong-tin-sach">
            <h2 id="thong-tin-sach" className="text-[16px] font-semibold">Thông tin sách</h2>
            <dl className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              {details.map((item) => (
                <div key={item.label} className="flex items-baseline justify-between gap-3 border-b border-border py-2.5 text-[13px]">
                  <dt className="text-muted-foreground">{item.label}</dt>
                  <dd className={cn('text-right font-medium', item.value ? 'text-foreground' : 'text-muted-foreground/60', item.mono && 'font-mono')}>{item.value || '—'}</dd>
                </div>
              ))}
            </dl>
          </section>
        </motion.div>
      </div>

      <div id="danh-gia" className="scroll-mt-20">
        {id && <ReviewSection bookId={id} />}
      </div>

      <ReserveModal
        book={showReserveModal ? book : null}
        onClose={() => setShowReserveModal(false)}
        onSuccess={() => setShowReserveModal(false)}
      />
    </div>
  );
}
