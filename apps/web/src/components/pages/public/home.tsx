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
import { BookRow, BookRowSkeleton, SectionHeading } from '@/components/public/book-row';
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
    <figure>
      <ul className="flex items-end gap-2 sm:gap-3" aria-label={onShelf ? 'Sách đang có trên kệ' : 'Một số đầu sách trong thư viện'}>
        {books.map((book, index) => (
          <motion.li
            key={book.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * index, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            style={{ flexGrow: weights[index % weights.length], flexBasis: 0 }}
            className="min-w-0"
          >
            <Link
              to={`/books/${book.id}`}
              className="block transition-transform duration-200 hover:-translate-y-2 focus-visible:-translate-y-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 motion-reduce:transform-none"
              title={book.title}
            >
              <BookCover title={book.title} author={book.author} imageUrl={book.cover_image_url} eager />
            </Link>
          </motion.li>
        ))}
      </ul>
      <div className="h-2.5 rounded-b-sm bg-gradient-to-b from-stone-300 to-stone-400 shadow-[0_6px_14px_-6px_rgba(0,0,0,0.35)] dark:from-stone-600 dark:to-stone-700" aria-hidden="true" />
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

function MostBorrowedList({ books, days }: { books: PublicBook[]; days: number }) {
  if (books.length === 0) return null;
  return (
    <section aria-labelledby="duoc-muon-nhieu">
      <SectionHeading id="duoc-muon-nhieu" title="Được mượn nhiều" basis={`Xếp theo số lượt mượn trong ${days} ngày qua.`} seeAllTo="/books?sort=popular" />
      <ol className="grid gap-x-10 sm:grid-cols-2">
        {books.map((book, index) => (
          <li key={book.id} className="border-b border-border">
            <Link to={`/books/${book.id}`} className="group flex items-center gap-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">
              <span className="w-7 shrink-0 text-right font-serif text-[22px] font-semibold tabular-nums text-muted-foreground/70">{index + 1}</span>
              <BookCover title={book.title} author={book.author} imageUrl={book.cover_image_url} className="w-10 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-foreground group-hover:underline">{book.title}</span>
                <span className="block truncate text-[12.5px] text-muted-foreground">{book.author || 'Chưa rõ tác giả'}</span>
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">{numberFormat.format(book.signals?.borrow_count || 0)} lượt</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CategoryTiles({ categories }: { categories: PublicHome['categories'] }) {
  if (categories.length === 0) return null;
  return (
    <section aria-labelledby="the-loai">
      <SectionHeading id="the-loai" title="Khám phá theo thể loại" seeAllTo="/categories" />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
        {categories.map((category) => (
          <li key={category.slug}>
            <Link to={`/categories/${category.slug}`} className="group flex h-full items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 dark:hover:border-indigo-500/40">
              <span className="relative flex h-14 w-14 shrink-0 items-end" aria-hidden="true">
                {category.covers.slice(0, 2).map((cover, index) => (
                  <img key={cover} src={cover} alt="" loading="lazy" decoding="async" className={`absolute bottom-0 h-14 w-10 rounded-[3px] object-cover shadow ${index === 0 ? 'left-0 -rotate-6' : 'left-4 rotate-3'}`} />
                ))}
                {category.covers.length === 0 ? <span className="h-14 w-10 rounded-[3px] bg-muted" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-foreground group-hover:underline">{category.name}</span>
                <span className="block text-[12px] text-muted-foreground">{numberFormat.format(category.book_count)} đầu sách</span>
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
      <SectionHeading id="danh-cho-ban" title="Dành riêng cho bạn" basis="Dựa trên sách bạn đã mượn, yêu thích và đánh giá." seeAllTo="/customer/recommendations" />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {result.recommendations.map((item) => (
          <li key={item.book_id}>
            <Link to={`/books/${item.book_id}`} className="group flex h-full gap-3 rounded-lg border border-border bg-card p-3 hover:border-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">
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

  return (
    <>
      <section className="border-b border-border bg-gradient-to-b from-indigo-50/70 to-background dark:from-indigo-950/20">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-12 sm:px-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14 lg:px-8 lg:pb-20 lg:pt-16">
          <div className="min-w-0">
            <p className="font-mono text-[11.5px] uppercase tracking-[0.1em] text-indigo-700 dark:text-indigo-300">
              Thư viện SmartBook{home ? ` · ${numberFormat.format(home.stats.total_titles)} đầu sách` : ''}
            </p>
            <h1 className="mt-4 max-w-[16ch] text-balance font-serif text-[40px] font-semibold leading-[1.05] tracking-tight text-foreground sm:text-[54px]">
              Khám phá cuốn sách tiếp theo của bạn.
            </h1>
            <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-muted-foreground">
              Tìm theo tên sách, tác giả hoặc thể loại. Xem ngay chi nhánh nào còn sách và đặt mượn trước khi đến thư viện.
            </p>
            <div className="mt-7"><SearchAutocomplete variant="hero" /></div>
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link to="/books" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
                Khám phá sách <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link to="/categories" className="text-[14px] font-medium text-foreground/80 hover:text-foreground hover:underline">Xem theo thể loại</Link>
              {home ? (
                <span className="font-mono text-[12px] text-muted-foreground">
                  {numberFormat.format(home.stats.total_titles)} đầu sách · {home.stats.category_count} thể loại
                </span>
              ) : null}
            </div>
          </div>
          <div className="min-w-0 lg:pl-4">
            {home ? <HeroShelf books={shelf.books} onShelf={shelf.onShelf} /> : <div className="aspect-[7/3] animate-pulse rounded-md bg-muted/60" aria-hidden="true" />}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-16 px-4 pt-14 sm:px-6 lg:px-8">
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
              title="Có sẵn để mượn ngay"
              basis={`${numberFormat.format(home.stats.available_titles)} đầu sách đang có bản trên kệ — đặt trước rồi đến chi nhánh nhận sách.`}
              books={home.available_now}
              seeAllTo="/books?availability=available"
              onReserve={requestReserve}
            />
            <BookRow
              id="dang-duoc-yeu-thich"
              title="Đang được yêu thích"
              basis={`Được mượn, đặt trước và thêm vào yêu thích nhiều trong ${home.windows?.recent_days ?? 90} ngày qua, ngoài các sách ở bảng “Được mượn nhiều”.`}
              books={home.trending}
              seeAllTo="/books?sort=popular"
              onReserve={requestReserve}
            />
            {isCustomer ? <ForYouRow /> : null}
            <BookRow id="sach-moi" title="Sách mới về" basis="Đầu sách được thêm vào thư viện gần đây nhất." books={home.new_arrivals} seeAllTo="/books?sort=newest" onReserve={requestReserve} />
            <DiscoveryBox />
            <CategoryTiles categories={home.categories} />
            <MostBorrowedList books={home.most_borrowed} days={home.windows?.borrow_days ?? 365} />
            <BookRow id="danh-gia-cao" title="Bạn đọc đánh giá cao" basis="Điểm trung bình từ ít nhất 2 đánh giá của bạn đọc." books={home.top_rated} seeAllTo="/books?sort=rating" onReserve={requestReserve} />
          </>
        )}

        <HowBorrowingWorks cta={isAuthenticated ? null : { to: buildLoginUrl('/', 'register'), label: 'Tạo tài khoản bạn đọc' }} />
      </div>

      <ReserveModal book={target} onClose={closeReserve} onSuccess={() => { closeReserve(); reload(); }} />
    </>
  );
}
