import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight } from 'lucide-react';
import { publicCatalogService, type PublicBook, type PublicHome } from '@/services/public-catalog';
import { aiService, type AIRecommendationsResult } from '@/services/ai';
import { useAuthUser } from '@/hooks/useAuthUser';
import { usePageMeta } from '@/lib/page-meta';
import { buildLoginUrl } from '@/lib/return-url';
import { clearRecentlyViewed, readRecentlyViewed, type RecentlyViewedBook } from '@/lib/recently-viewed';
import { BookCover } from '@/components/public/book-cover';
import { Book3D } from '@/components/public/book-3d';
import { useShelfTilt } from '@/components/public/use-shelf-tilt';
import { BookRow, BookRowSkeleton, Reveal, SectionHeading } from '@/components/public/book-row';
import { CategoryShowcase, FeaturedTrending, TopTenBand } from '@/components/public/home-sections';
import { HowBorrowingWorks } from '@/components/public/how-borrowing-works';
import { DiscoveryBox } from '@/components/public/discovery-box';
import { SearchAutocomplete } from '@/components/public/search-autocomplete';
import { useReserveAction } from '@/components/public/use-reserve-action';
import { ReserveModal } from '@/components/pages/customer/_shared/reserve-modal';
import { EmptyState } from '@/components/ui/empty-state';

const numberFormat = new Intl.NumberFormat('vi-VN');

/** The hero's signature: a shelf of books the library actually holds. */
function HeroShelf({ books, onShelf }: { books: PublicBook[]; onShelf: boolean }) {
  if (books.length === 0) return null;
  // Covers are sized by width (aspect 2:3), so uneven flex weights give the
  // uneven heights of books standing on a shelf without ever overflowing it.
  const weights = [0.9, 1, 0.94, 0.84, 0.97];
  return (
    <figure className="relative">
      {/* Soft light on the wall behind the shelf. */}
      <div className="pointer-events-none absolute -inset-x-8 -top-10 bottom-0 bg-[radial-gradient(ellipse_at_50%_75%,rgba(79,70,229,0.16),transparent_65%)] dark:bg-[radial-gradient(ellipse_at_50%_75%,rgba(129,140,248,0.18),transparent_65%)]" aria-hidden="true" />
      <ul className="relative z-10 flex items-end gap-3 px-3 sm:gap-4" aria-label={onShelf ? 'Sách đang có trên kệ' : 'Một số đầu sách trong thư viện'}>
        {books.map((book, index) => (
          <motion.li
            key={book.id}
            // Books are slid onto the shelf one after another.
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 * index, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            style={{ flexGrow: weights[index % weights.length], flexBasis: 0 }}
            className="relative min-w-0 hover:z-20 focus-within:z-20"
          >
            <Link
              to={`/books/${book.id}`}
              className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
              title={book.title}
            >
              <Book3D title={book.title} author={book.author} imageUrl={book.cover_image_url} pose="shelf" eager />
            </Link>
          </motion.li>
        ))}
      </ul>
      {/* Plank: a lit top surface the books stand on, then the front edge. */}
      <div className="relative -mt-2 h-4 origin-top rounded-t-sm bg-gradient-to-b from-stone-200 to-stone-300 [transform:perspective(500px)_rotateX(48deg)] dark:from-stone-500 dark:to-stone-600" aria-hidden="true" />
      <div className="relative -mt-1 h-3 rounded-b-sm bg-gradient-to-b from-stone-400 to-stone-500 shadow-[0_14px_24px_-12px_rgba(15,23,42,0.55)] dark:from-stone-700 dark:to-stone-800" aria-hidden="true" />
      <figcaption className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
        {onShelf ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Đang có trên kệ, đặt trước được ngay
            </span>
            <Link to="/books?availability=available" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Xem tất cả</Link>
          </>
        ) : 'Một số đầu sách trong thư viện'}
      </figcaption>
    </figure>
  );
}

/** "Bạn đã xem gần đây" — read from this browser only, nothing is sent anywhere. */
function RecentlyViewedRow() {
  const [items, setItems] = useState<RecentlyViewedBook[]>(readRecentlyViewed);
  if (items.length < 2) return null;
  return (
    <section aria-labelledby="da-xem-gan-day">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id="da-xem-gan-day" className="font-serif text-[20px] font-semibold tracking-tight">Bạn đã xem gần đây</h2>
        <button type="button" onClick={() => { clearRecentlyViewed(); setItems([]); }} className="text-[12.5px] text-muted-foreground hover:text-foreground hover:underline">
          Xóa lịch sử xem
        </button>
      </div>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        {items.map((item) => (
          <li key={item.id} className="w-[min(15rem,70vw)] shrink-0">
            <Link to={`/books/${item.id}`} className="group flex items-center gap-3 rounded-lg border border-border bg-card p-2.5 hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">
              <BookCover title={item.title} author={item.author} imageUrl={item.cover_image_url} className="w-10 shrink-0 rounded-[3px]" />
              <span className="min-w-0">
                <span className="line-clamp-2 text-[13px] font-semibold leading-snug group-hover:underline">{item.title}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{item.author || 'Chưa rõ tác giả'}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Dành riêng cho bạn": Recommendation V2, signed-in readers only. */
function ForYouRow() {
  const [result, setResult] = useState<AIRecommendationsResult | null>(null);
  useEffect(() => {
    let active = true;
    aiService.getRecommendationsAI(6)
      .then((data) => { if (active) setResult(data); })
      .catch(() => { /* optional section: hide on failure */ });
    return () => { active = false; };
  }, []);
  if (!result?.personalized || result.recommendations.length === 0) return null;
  return (
    <section aria-labelledby="danh-cho-ban">
      <SectionHeading id="danh-cho-ban" eyebrow="Recommendation V2" title="Dành riêng cho bạn" basis="Dựa trên sách bạn đã mượn, yêu thích và đánh giá." seeAllTo="/customer/recommendations" />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {result.recommendations.map((item) => (
          <li key={item.book_id}>
            <Link to={`/books/${item.book_id}`} className="group flex h-full gap-3 rounded-2xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 motion-reduce:transform-none">
              <BookCover title={item.title} author={item.author} className="w-14 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold group-hover:underline">{item.title}</span>
                <span className="block truncate text-[12.5px] text-muted-foreground">{item.author}</span>
                <span className="mt-1 line-clamp-2 block text-[12.5px] text-foreground/80">{item.reason}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PublicHomePage() {
  usePageMeta({});
  const heroRef = useShelfTilt<HTMLElement>();
  const { isAuthenticated, isCustomer } = useAuthUser();
  const [home, setHome] = useState<PublicHome | null>(null);
  const [error, setError] = useState(false);
  const { target, requestReserve, closeReserve } = useReserveAction();

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => { setError(false); setReloadKey((key) => key + 1); };

  useEffect(() => {
    let active = true;
    publicCatalogService.getHome()
      .then((data) => { if (active) { setHome(data); setError(false); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [reloadKey]);

  // Real cover photos, books on the shelf first. The "Có sẵn" row right below
  // already lists what's reservable, so the hero doesn't repeat that row; the
  // caption only claims "on the shelf" when every book shown really is.
  const shelf = useMemo(() => {
    if (!home) return { books: [], onShelf: false };
    const seen = new Set<string>();
    const books = [...home.available_now, ...home.top_rated, ...home.most_borrowed, ...home.new_arrivals, ...home.trending]
      .filter((book) => book.cover_image_url && !seen.has(book.id) && seen.add(book.id))
      .slice(0, 5);
    return { books, onShelf: books.length > 0 && books.every((book) => book.reservable) };
  }, [home]);

  const days = home?.windows?.recent_days ?? 90;

  return (
    <>
      <section ref={heroRef} className="relative overflow-x-clip border-b border-border bg-gradient-to-b from-indigo-50/80 via-background to-background dark:from-indigo-950/30">
        {/* Atmosphere: faint dot grid fading out, two soft lights. Decorative only. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(79,70,229,0.13)_1px,transparent_0)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_70%_60%_at_50%_30%,black,transparent)] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(165,180,252,0.12)_1px,transparent_0)]" aria-hidden="true" />
        <div className="pointer-events-none absolute -left-32 top-10 h-80 w-80 rounded-full bg-indigo-300/30 blur-3xl dark:bg-indigo-600/20" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-20 top-40 h-72 w-72 rounded-full bg-cyan-200/40 blur-3xl dark:bg-cyan-500/10" aria-hidden="true" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14 lg:px-8 lg:pb-24 lg:pt-20">
          <div className="min-w-0">
            {home ? (
              <Link
                to="/books?availability=available"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-600/25 bg-card/80 py-1 pl-2 pr-3 text-[12.5px] font-medium text-foreground shadow-sm backdrop-blur hover:border-emerald-600/50"
              >
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60 motion-reduce:hidden" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {numberFormat.format(home.stats.available_titles)} đầu sách có sẵn hôm nay
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              </Link>
            ) : (
              <span className="inline-block h-7 w-56 animate-pulse rounded-full bg-muted" aria-hidden="true" />
            )}
            <h1 className="mt-6 max-w-[17ch] text-balance font-serif text-[42px] font-semibold leading-[1.04] tracking-tight text-foreground sm:text-[58px]">
              Khám phá cuốn sách{' '}
              <span className="whitespace-nowrap bg-gradient-to-r from-indigo-600 via-violet-600 to-indigo-500 bg-clip-text text-transparent dark:from-indigo-300 dark:via-violet-300 dark:to-cyan-300">tiếp theo</span>{' '}
              của bạn.
            </h1>
            <p className="mt-5 max-w-lg text-[16.5px] leading-relaxed text-muted-foreground">
              Tìm theo tên sách, tác giả hoặc thể loại. Xem ngay chi nhánh nào còn sách và đặt mượn trước khi đến thư viện.
            </p>
            <div className="mt-8"><SearchAutocomplete variant="hero" /></div>
            {home && home.categories.length ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[12.5px] text-muted-foreground">Phổ biến:</span>
                {home.categories.slice(0, 4).map((category) => (
                  <Link
                    key={category.slug}
                    to={`/categories/${category.slug}`}
                    className="rounded-full border border-border bg-card/80 px-3 py-1 text-[12.5px] font-medium text-foreground/85 backdrop-blur transition-colors hover:border-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-300"
                  >
                    {category.name}
                  </Link>
                ))}
              </div>
            ) : null}
            <Link to="/books" className="group mt-7 inline-flex items-center gap-1.5 text-[14px] font-semibold text-indigo-700 dark:text-indigo-300">
              Khám phá toàn bộ{home ? ` ${numberFormat.format(home.stats.total_titles)}` : ''} đầu sách
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
          </div>
          <div className="min-w-0 lg:pl-4">
            {home ? <HeroShelf books={shelf.books} onShelf={shelf.onShelf} /> : <div className="aspect-[7/3] animate-pulse rounded-md bg-muted/60" aria-hidden="true" />}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-20 px-4 pt-16 sm:px-6 sm:space-y-24 lg:px-8">
        {error ? (
          <EmptyState
            variant="error"
            title="Không tải được trang chủ"
            description="Máy chủ thư viện chưa phản hồi. Bạn vẫn có thể thử tải lại hoặc vào thẳng danh mục sách."
            action={<button type="button" onClick={reload} className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">Tải lại</button>}
          />
        ) : !home ? (
          <>
            <BookRowSkeleton />
            <BookRowSkeleton />
          </>
        ) : (
          <>
            <RecentlyViewedRow />
            <BookRow
              id="co-san"
              eyebrow="Mượn ngay hôm nay"
              title="Có sẵn để mượn ngay"
              basis={`${numberFormat.format(home.stats.available_titles)} đầu sách đang có bản trên kệ — đặt trước rồi đến chi nhánh nhận sách.`}
              books={home.available_now}
              seeAllTo="/books?availability=available"
              onReserve={requestReserve}
            />
            <FeaturedTrending books={home.trending} days={days} onReserve={requestReserve} />
            {isCustomer ? <Reveal><ForYouRow /></Reveal> : null}
            <BookRow id="sach-moi" eyebrow="Mới cập nhật" title="Sách mới về" basis="Đầu sách được thêm vào thư viện gần đây nhất." books={home.new_arrivals} seeAllTo="/books?sort=newest" onReserve={requestReserve} />
            <Reveal><DiscoveryBox /></Reveal>
            <CategoryShowcase categories={home.categories} />
          </>
        )}
      </div>

      {home ? <div className="mt-20 sm:mt-24"><TopTenBand books={home.most_borrowed} days={home.windows?.borrow_days ?? 365} /></div> : null}

      <div className="mx-auto max-w-7xl space-y-20 px-4 pt-20 sm:space-y-24 sm:px-6 sm:pt-24 lg:px-8">
        {home ? (
          <BookRow id="danh-gia-cao" eyebrow="Bạn đọc chấm điểm" title="Bạn đọc đánh giá cao" basis="Điểm trung bình từ ít nhất 2 đánh giá của bạn đọc." books={home.top_rated} seeAllTo="/books?sort=rating" onReserve={requestReserve} />
        ) : null}
        <Reveal>
          <HowBorrowingWorks
            variant="band"
            cta={isAuthenticated ? null : { to: buildLoginUrl('/', 'register'), label: 'Tạo tài khoản bạn đọc' }}
            secondary={isAuthenticated ? { to: '/customer', label: 'Đến Sách của tôi' } : { to: '/books', label: 'Duyệt danh mục' }}
          />
        </Reveal>
      </div>

      <ReserveModal book={target} onClose={closeReserve} onSuccess={() => { closeReserve(); reload(); }} />
    </>
  );
}
