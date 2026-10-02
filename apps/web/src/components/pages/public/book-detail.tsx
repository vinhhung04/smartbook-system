import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import axios from 'axios';
import { Bell, BellRing, Heart, MapPin, Sparkles, Star } from 'lucide-react';
import { toast } from 'sonner';
import { publicCatalogService, type PublicBookDetail } from '@/services/public-catalog';
import { customerBorrowService } from '@/services/customer-borrow';
import { getApiErrorMessage } from '@/services/api';
import { useAuthUser } from '@/hooks/useAuthUser';
import { usePageMeta } from '@/lib/page-meta';
import { buildLoginUrl } from '@/lib/return-url';
import { rememberViewed } from '@/lib/recently-viewed';
import { cn } from '@/components/ui/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { BackCover, SpinningBook } from '@/components/public/spinning-book';
import { AvailabilityStamp } from '@/components/public/availability-stamp';
import { BookRow } from '@/components/public/book-row';
import { useReserveAction } from '@/components/public/use-reserve-action';
import { ReserveModal } from '@/components/pages/customer/_shared/reserve-modal';
import { BookReviews } from './book-reviews';

const DESCRIPTION_PREVIEW_CHARS = 600;
const LANGUAGE_LABELS: Record<string, string> = { vi: 'Tiếng Việt', en: 'Tiếng Anh', fr: 'Tiếng Pháp', ja: 'Tiếng Nhật', zh: 'Tiếng Trung', ko: 'Tiếng Hàn' };

function DetailSkeleton() {
  return (
    <div className="mx-auto grid max-w-6xl animate-pulse gap-10 px-4 py-10 sm:px-6 md:grid-cols-[280px_1fr] lg:px-8" aria-busy="true" aria-label="Đang tải">
      <div className="mx-auto aspect-[2/3] w-full max-w-[280px] rounded-md bg-muted" />
      <div className="space-y-4">
        <div className="h-4 w-24 rounded bg-muted" />
        <div className="h-10 w-3/4 rounded bg-muted" />
        <div className="h-4 w-1/2 rounded bg-muted" />
        <div className="h-32 rounded-lg bg-muted" />
      </div>
    </div>
  );
}

export function PublicBookDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, isCustomer } = useAuthUser();
  const [book, setBook] = useState<PublicBookDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found' | 'error'>('loading');
  const [expanded, setExpanded] = useState(false);
  const [inWishlist, setInWishlist] = useState(false);
  const [wishlistBusy, setWishlistBusy] = useState(false);
  const [alertOn, setAlertOn] = useState(false);
  const [alertBusy, setAlertBusy] = useState(false);
  const { target, requestReserve, closeReserve } = useReserveAction();
  const resumedReserve = useRef(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const data = await publicCatalogService.getBook(id);
      setBook(data);
      setStatus('ready');
      rememberViewed(data);
    } catch (err) {
      setStatus(axios.isAxiosError(err) && err.response?.status === 404 ? 'not-found' : 'error');
    }
  }, [id]);

  useEffect(() => {
    resumedReserve.current = false;
    setExpanded(false);
    void load();
  }, [load]);

  useEffect(() => {
    if (!isCustomer || !id) return;
    customerBorrowService.getMyWishlist()
      .then((res) => setInWishlist(Array.isArray(res?.data) && res.data.some((item: { book_id: string }) => item.book_id === id)))
      .catch(() => {});
    customerBorrowService.getMyAvailabilityAlerts()
      .then((res) => setAlertOn(Array.isArray(res?.data) && res.data.some((item: { book_id: string; status: string }) => item.book_id === id && item.status === 'ACTIVE')))
      .catch(() => {});
  }, [id, isCustomer]);

  // Back from login with ?reserve=1: continue the reservation the reader started.
  useEffect(() => {
    if (status !== 'ready' || !book || resumedReserve.current || searchParams.get('reserve') !== '1') return;
    resumedReserve.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('reserve');
    setSearchParams(next, { replace: true });
    if (!isCustomer) return;
    if (book.reservable) requestReserve(book);
    else toast.info('Cuốn này vừa được mượn hết. Thêm vào yêu thích để theo dõi khi có sách.');
  }, [status, book, searchParams, setSearchParams, isCustomer, requestReserve]);

  usePageMeta({
    title: book ? `${book.title}${book.author ? ` — ${book.author}` : ''}` : undefined,
    description: book ? (book.summary_vi || book.description || `${book.title} tại thư viện SmartBook.`) : undefined,
    image: book?.cover_image_url,
    type: 'book',
  });

  const toggleWishlist = async () => {
    if (!isAuthenticated) {
      navigate(buildLoginUrl(`/books/${id}`));
      return;
    }
    if (!isCustomer) {
      toast.info('Danh sách yêu thích dành cho tài khoản bạn đọc.');
      return;
    }
    try {
      setWishlistBusy(true);
      if (inWishlist) {
        await customerBorrowService.removeFromWishlist(id);
        setInWishlist(false);
        toast.success('Đã bỏ khỏi yêu thích');
      } else {
        await customerBorrowService.addToWishlist(id);
        setInWishlist(true);
        toast.success('Đã thêm vào yêu thích');
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Chưa cập nhật được danh sách yêu thích'));
    } finally {
      setWishlistBusy(false);
    }
  };

  const toggleAlert = async () => {
    if (!isAuthenticated) {
      navigate(buildLoginUrl(`/books/${id}`));
      return;
    }
    if (!isCustomer) {
      toast.info('Thông báo khi có sách dành cho tài khoản bạn đọc.');
      return;
    }
    try {
      setAlertBusy(true);
      if (alertOn) {
        await customerBorrowService.unsubscribeAvailabilityAlert(id);
        setAlertOn(false);
        toast.success('Đã tắt thông báo cho cuốn này');
      } else {
        await customerBorrowService.subscribeAvailabilityAlert(id);
        setAlertOn(true);
        toast.success('Sẽ báo cho bạn khi sách có trở lại');
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Chưa cập nhật được thông báo'));
    } finally {
      setAlertBusy(false);
    }
  };

  if (status === 'loading' && !book) return <DetailSkeleton />;
  if (status === 'not-found') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState variant="no-data" title="Không tìm thấy sách" description="Sách này không có trong danh mục hoặc đã ngừng cho mượn."
          action={<Link to="/books" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Quay lại danh mục</Link>} />
      </div>
    );
  }
  if (status === 'error' || !book) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState variant="error" title="Không tải được thông tin sách" description="Máy chủ thư viện chưa phản hồi."
          action={<button type="button" onClick={() => void load()} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Thử lại</button>} />
      </div>
    );
  }

  // Rendered twice (panel + phone bar); only the panel copy carries the test id.
  const primaryAction = (inBar = false) => book.reservable ? (
    <button
      type="button"
      onClick={() => requestReserve(book)}
      data-testid={inBar ? undefined : 'reserve-book-button'}
      className="inline-flex h-11 shrink-0 items-center rounded-full bg-indigo-700 px-6 text-[14.5px] font-semibold text-white hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 dark:bg-indigo-500 dark:hover:bg-indigo-400"
    >
      Đặt mượn
    </button>
  ) : (
    <button
      type="button"
      onClick={() => void toggleAlert()}
      disabled={alertBusy}
      aria-pressed={isCustomer ? alertOn : undefined}
      className={cn(
        'inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-5 text-[14.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 disabled:opacity-60',
        alertOn ? 'border border-indigo-300 text-indigo-700 dark:border-indigo-500/40 dark:text-indigo-300' : 'bg-indigo-700 text-white hover:bg-indigo-800 dark:bg-indigo-500 dark:hover:bg-indigo-400',
      )}
    >
      {alertOn ? <BellRing className="h-4 w-4" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
      {alertOn ? 'Đã bật thông báo' : 'Báo khi có sách'}
    </button>
  );

  const description = (book.description || '').trim();
  const isLong = description.length > DESCRIPTION_PREVIEW_CHARS;
  const shownDescription = isLong && !expanded ? `${description.slice(0, DESCRIPTION_PREVIEW_CHARS).trimEnd()}…` : description;
  const rating = book.signals && book.signals.rating_count > 0 ? book.signals : null;
  const details: Array<{ label: string; value: ReactNode; mono?: boolean }> = [
    { label: 'Tác giả', value: book.authors.length ? book.authors.join(', ') : null },
    { label: 'Nhà xuất bản', value: book.publisher },
    { label: 'Năm xuất bản', value: book.publish_year },
    { label: 'Lần xuất bản', value: book.edition },
    { label: 'Số trang', value: book.page_count },
    { label: 'Ngôn ngữ', value: book.language ? LANGUAGE_LABELS[book.language] || book.language.toUpperCase() : null },
    { label: 'ISBN', value: book.isbn, mono: true },
    {
      label: 'Thể loại',
      value: book.categories.length ? (
        <span className="flex flex-wrap justify-end gap-x-2">
          {book.categories.map((category) => (
            <Link key={category.slug} to={`/categories/${category.slug}`} className="text-indigo-700 hover:underline dark:text-indigo-300">{category.name}</Link>
          ))}
        </span>
      ) : null,
    },
  ];

  return (
    <div className="relative overflow-x-clip">
      {/* Same atmosphere as the homepage hero, fading out below the fold. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-gradient-to-b from-indigo-50/80 to-transparent dark:from-indigo-950/30" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(circle_at_1px_1px,rgba(79,70,229,0.12)_1px,transparent_0)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_60%_70%_at_25%_10%,black,transparent)] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(165,180,252,0.1)_1px,transparent_0)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-24 top-10 h-80 w-80 rounded-full bg-indigo-300/25 blur-3xl dark:bg-indigo-600/20" aria-hidden="true" />
      <div className="relative mx-auto max-w-6xl space-y-16 px-4 pb-24 pt-6 sm:px-6 md:pb-6 lg:px-8">
        <nav aria-label="Đường dẫn" className="text-[13px] text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1">
            <li><Link to="/" className="hover:text-foreground hover:underline">Trang chủ</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link to="/books" className="hover:text-foreground hover:underline">Khám phá</Link></li>
            {book.category_slug ? (
              <>
                <li aria-hidden="true">/</li>
                <li><Link to={`/categories/${book.category_slug}`} className="hover:text-foreground hover:underline">{book.category}</Link></li>
              </>
            ) : null}
          </ol>
        </nav>

        <article className="grid gap-8 md:grid-cols-[280px_1fr] md:gap-12">
          <div className="mx-auto w-full max-w-[160px] sm:max-w-[210px] md:sticky md:top-24 md:max-w-none md:self-start">
            <SpinningBook
              title={book.title}
              author={book.author}
              imageUrl={book.cover_image_url}
              eager
              back={(
                <BackCover
                  title={book.title}
                  author={book.author}
                  facts={[
                    ...(rating ? [{ label: 'Đánh giá', value: `★ ${rating.rating_avg.toFixed(1)} · ${rating.rating_count}` }] : []),
                    ...(book.isbn ? [{ label: 'ISBN', value: book.isbn }] : []),
                    ...(book.page_count ? [{ label: 'Số trang', value: String(book.page_count) }] : []),
                    { label: 'Tình trạng', value: book.available_quantity > 0 ? `Còn ${book.available_quantity}` : 'Đã mượn hết' },
                  ]}
                />
              )}
            />
          </div>

          <div className="min-w-0">
            {book.category_slug ? (
              <Link to={`/categories/${book.category_slug}`} className="mb-3 inline-block font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-indigo-700 hover:underline dark:text-indigo-300">
                {book.category}
              </Link>
            ) : null}
            <h1 className="text-balance font-serif text-[32px] font-semibold leading-[1.08] tracking-tight sm:text-[46px]">{book.title}</h1>
            {book.subtitle ? <p className="mt-2 text-[16px] text-muted-foreground">{book.subtitle}</p> : null}
            <p className="mt-3 text-[15px]">
              {book.authors.length ? book.authors.map((author, index) => (
                <span key={author}>
                  {index > 0 ? ', ' : ''}
                  <Link to={`/books?author=${encodeURIComponent(author)}`} className="font-medium hover:underline">{author}</Link>
                </span>
              )) : <span className="text-muted-foreground">Chưa rõ tác giả</span>}
            </p>
            <a href="#danh-gia" className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground hover:underline">
              {rating ? (
                <>
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden="true" />
                  <span className="font-semibold text-foreground">{rating.rating_avg.toFixed(1)}</span> · {rating.rating_count} đánh giá
                </>
              ) : 'Chưa có đánh giá'}
            </a>

            <section aria-labelledby="tinh-trang" className="mt-7 rounded-2xl border border-border bg-card/90 p-5 shadow-[0_14px_36px_-24px_rgba(15,23,42,0.4)] backdrop-blur sm:p-6">
              <h2 id="tinh-trang" className="sr-only">Tình trạng sách</h2>
              <AvailabilityStamp book={book} className="text-[11.5px]" />
              {book.pickup_branches.length > 0 ? (
                <ul className="mt-3 space-y-1.5" aria-label="Chi nhánh còn sách">
                  {book.pickup_branches.map((branch) => (
                    <li key={branch.warehouse_id} className="flex items-center gap-2 text-[13.5px]">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <Link to={`/branches/${branch.warehouse_id}`} className="flex-1 hover:text-indigo-700 hover:underline dark:hover:text-indigo-300">{branch.warehouse_name}</Link>
                      <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{branch.available_quantity} cuốn</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[13.5px] text-muted-foreground">
                  {book.availability_status === 'INCOMING' ? 'Sách đang được nhập kho và sẽ sớm lên kệ.' : 'Tất cả bản đang được mượn.'} Bật thông báo để biết ngay khi có bản trả về.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                {primaryAction()}
                <button
                  type="button"
                  onClick={() => void toggleWishlist()}
                  disabled={wishlistBusy}
                  aria-pressed={isCustomer ? inWishlist : undefined}
                  className={cn(
                    'inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-colors disabled:opacity-60',
                    inWishlist ? 'border-rose-300 text-rose-700 dark:border-rose-500/40 dark:text-rose-400' : 'border-border hover:bg-muted',
                  )}
                >
                  <Heart className={cn('h-4 w-4', inWishlist && 'fill-current')} aria-hidden="true" />
                  {inWishlist ? 'Đã yêu thích' : 'Yêu thích'}
                </button>
              </div>
              {!isAuthenticated ? (
                <p className="mt-3 text-[12.5px] text-muted-foreground">
                  {book.reservable ? 'Cần đăng nhập để đặt mượn.' : 'Cần đăng nhập để nhận thông báo.'} Sau khi đăng nhập, bạn sẽ quay lại đúng cuốn sách này.
                </p>
              ) : null}
            </section>

            <section aria-labelledby="gioi-thieu" className="mt-8">
              <h2 id="gioi-thieu" className="font-serif text-[22px] font-semibold tracking-tight">Giới thiệu</h2>
              {description ? (
                <>
                  <p className="mt-2 whitespace-pre-line text-[14.5px] leading-[1.7] text-foreground/85">{shownDescription}</p>
                  {isLong ? (
                    <button type="button" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded} className="mt-1 text-[13px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
                      {expanded ? 'Thu gọn' : 'Đọc thêm'}
                    </button>
                  ) : null}
                </>
              ) : <p className="mt-2 text-[13.5px] text-muted-foreground">Sách này chưa có phần giới thiệu.</p>}
            </section>

            {book.summary_vi ? (
              <section aria-labelledby="tom-tat-ai" className="mt-5 rounded-2xl border border-indigo-200/70 bg-indigo-50/50 p-5 dark:border-indigo-500/20 dark:bg-indigo-950/20">
                <h2 id="tom-tat-ai" className="flex items-center gap-1.5 text-[13px] font-semibold">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" /> Tóm tắt do AI tạo
                </h2>
                <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-foreground/85">{book.summary_vi}</p>
                <p className="mt-2 text-[11.5px] text-muted-foreground">Tóm tắt tự động từ thông tin sách, có thể chưa chính xác hoàn toàn.</p>
              </section>
            ) : null}

            <section aria-labelledby="thong-tin" className="mt-8">
              <h2 id="thong-tin" className="font-serif text-[22px] font-semibold tracking-tight">Thông tin sách</h2>
              <dl className="mt-2 grid gap-x-10 sm:grid-cols-2">
                {details.filter((item) => item.value !== null && item.value !== undefined && item.value !== '').map((item) => (
                  <div key={item.label} className="flex items-baseline justify-between gap-4 border-b border-border py-2.5 text-[13.5px]">
                    <dt className="shrink-0 whitespace-nowrap text-muted-foreground">{item.label}</dt>
                    <dd className={cn('min-w-0 text-right font-medium [overflow-wrap:anywhere]', item.mono && 'font-mono text-[12.5px]')}>{item.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </article>

        <BookReviews bookId={book.id} />

        <BookRow id="cung-the-loai" eyebrow="Gợi ý thêm" title="Cùng thể loại" books={book.related} seeAllTo={book.category_slug ? `/categories/${book.category_slug}` : undefined} />

        {/* Phones: the action stays reachable while reading the description and reviews. */}
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold">{book.title}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {book.reservable ? `Còn ${book.available_quantity} cuốn` : book.availability_status === 'INCOMING' ? 'Đang nhập kho' : 'Đã được mượn hết'}
              </p>
            </div>
            {primaryAction(true)}
          </div>
        </div>

        <ReserveModal book={target} onClose={closeReserve} onSuccess={() => { closeReserve(); void load(); }} />
      </div>
    </div>
  );
}
