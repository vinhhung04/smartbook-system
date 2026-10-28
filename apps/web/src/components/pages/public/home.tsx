import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { publicCatalogService, type PublicBook, type PublicBranch, type PublicHome } from '@/services/public-catalog';
import { aiService, type AIRecommendationsResult } from '@/services/ai';
import { useAuthUser } from '@/hooks/useAuthUser';
import { usePageMeta } from '@/lib/page-meta';
import { buildLoginUrl } from '@/lib/return-url';
import { clearRecentlyViewed, readRecentlyViewed, type RecentlyViewedBook } from '@/lib/recently-viewed';
import { BookCover } from '@/components/public/book-cover';
import { BookRow, BookRowSkeleton, Reveal, SectionHeading } from '@/components/public/book-row';
import { CategoryShowcase, FeaturedTrending, HomeBranches, RankingBand } from '@/components/public/home-sections';
import { ReaderSummary } from '@/components/public/reader-summary';
import { CoverFlow } from '@/components/public/cover-flow';
import { TiltCard } from '@/components/public/tilt-card';
import { HowBorrowingWorks } from '@/components/public/how-borrowing-works';
import { HomeHero } from '@/components/public/home-hero';
import { RevealEngineContext, useScrollTriggerRefresh } from '@/components/public/gsap-motion';
import { useReserveAction } from '@/components/public/use-reserve-action';
import { useAvailabilityAlerts } from '@/components/public/use-availability-alerts';
import { ReserveModal } from '@/components/pages/customer/_shared/reserve-modal';
import { EmptyState } from '@/components/ui/empty-state';

const numberFormat = new Intl.NumberFormat('vi-VN');
// Same threshold as inventory-service's top_rated list (TOP_RATED_MIN_REVIEWS).
const TOP_RATED_MIN_REVIEWS = 2;

/** "Bạn đã xem gần đây" — read from this browser only, nothing is sent anywhere. */
function RecentlyViewedRow() {
  const [items, setItems] = useState<RecentlyViewedBook[]>(readRecentlyViewed);
  if (items.length < 2) return null;
  return (
    <section aria-labelledby="da-xem-gan-day">
      <div className="mb-4 flex items-end justify-between gap-4">
        <h2 id="da-xem-gan-day" className="font-display text-[22px] font-semibold tracking-[-0.01em]">Bạn đã xem gần đây</h2>
        <button type="button" onClick={() => { clearRecentlyViewed(); setItems([]); }} className="text-[12.5px] text-muted-foreground hover:text-foreground hover:underline">
          Xóa lịch sử xem
        </button>
      </div>
      <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
        {items.map((item) => (
          <li key={item.id} className="w-[min(15rem,70vw)] shrink-0">
            <Link to={`/books/${item.id}`} className="group flex items-center gap-3 rounded-xl bg-card p-2.5 ring-1 ring-border transition-colors hover:ring-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">
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
      <SectionHeading id="danh-cho-ban" title="Dành riêng cho bạn" basis="Dựa trên sách bạn đã mượn, yêu thích và đánh giá." seeAllTo="/customer/recommendations" />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {result.recommendations.map((item) => (
          <li key={item.book_id} data-reveal-item>
            <TiltCard className="h-full rounded-2xl">
            <Link to={`/books/${item.book_id}`} className="group flex h-full gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-colors hover:ring-indigo-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50">
              <BookCover title={item.title} author={item.author} className="w-14 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold group-hover:underline">{item.title}</span>
                <span className="block truncate text-[12.5px] text-muted-foreground">{item.author}</span>
                <span className="mt-1 line-clamp-2 block text-[12.5px] text-foreground/80">{item.reason}</span>
              </span>
            </Link>
            </TiltCard>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PublicHomePage() {
  usePageMeta({});
  const pageRef = useRef<HTMLDivElement>(null);
  useScrollTriggerRefresh(pageRef);
  const { user, isAuthenticated, isCustomer } = useAuthUser();
  const [home, setHome] = useState<PublicHome | null>(null);
  const [error, setError] = useState(false);
  const { target, requestReserve, closeReserve } = useReserveAction();
  const alerts = useAvailabilityAlerts();
  const [branches, setBranches] = useState<PublicBranch[]>([]);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => { setError(false); setReloadKey((key) => key + 1); };

  useEffect(() => {
    let active = true;
    publicCatalogService.getHome()
      .then((data) => { if (active) { setHome(data); setError(false); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [reloadKey]);

  // Branch section + branch names in "Sách của tôi"; optional, so a failure just hides them.
  useEffect(() => {
    let active = true;
    publicCatalogService.getBranches()
      .then((data) => { if (active) setBranches(data); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

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
    <RevealEngineContext.Provider value="gsap">
      <div ref={pageRef}>
      <HomeHero home={home} books={shelf.books} onShelf={shelf.onShelf} />

      <div className="mx-auto max-w-7xl space-y-24 px-4 pt-6 sm:px-6 sm:space-y-32 lg:px-8">
        {isCustomer ? <ReaderSummary name={user?.full_name} branches={branches} /> : null}
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
              basis={`${numberFormat.format(home.stats.available_titles)} đầu sách đang có bản trên kệ. Đặt trước rồi đến chi nhánh nhận sách.`}
              books={home.available_now}
              seeAllTo="/books?availability=available"
              onReserve={requestReserve}
            />
            <FeaturedTrending books={home.trending} days={days} onReserve={requestReserve} alerts={alerts} />
            {isCustomer ? <Reveal><ForYouRow /></Reveal> : null}
            <CoverFlow id="sach-moi" title="Sách mới về" basis="Đầu sách được thêm vào thư viện gần đây nhất. Lướt hoặc bấm vào một cuốn để đưa ra giữa." books={home.new_arrivals} seeAllTo="/books?sort=newest" onReserve={requestReserve} />
            <CategoryShowcase categories={home.categories} />
          </>
        )}
      </div>

      {home ? (
        <div className="mt-24 sm:mt-32">
          <RankingBand mostBorrowed={home.most_borrowed} topRated={home.top_rated} borrowDays={home.windows?.borrow_days ?? 365} minReviews={TOP_RATED_MIN_REVIEWS} alerts={alerts} />
        </div>
      ) : null}

      <div className="mx-auto max-w-7xl space-y-24 px-4 pt-24 sm:space-y-32 sm:px-6 sm:pt-32 lg:px-8">
        <HomeBranches branches={branches} />
        <HowBorrowingWorks
          variant="band"
          cta={isAuthenticated ? null : { to: buildLoginUrl('/', 'register'), label: 'Tạo tài khoản bạn đọc' }}
          secondary={isAuthenticated ? { to: '/customer', label: 'Đến Sách của tôi' } : { to: '/books', label: 'Duyệt danh mục' }}
        />
      </div>

      </div>
      <ReserveModal book={target} onClose={closeReserve} onSuccess={() => { closeReserve(); reload(); }} />
    </RevealEngineContext.Provider>
  );
}
