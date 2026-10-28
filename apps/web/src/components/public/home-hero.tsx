import { useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { PublicBook, PublicHome } from '@/services/public-catalog';
import { cn } from '@/components/ui/utils';
import { AvailabilityStamp } from './availability-stamp';
import { Book3D } from './book-3d';
import { HeroSearch } from './hero-search';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from './gsap-motion';

const numberFormat = new Intl.NumberFormat('vi-VN');

/**
 * Where each book stands on the display table: the lead book front and
 * centre, two behind it, two further back at the edges (hidden on phones).
 * Back books sit higher because the table recedes; left ones turn their
 * spine to you, right ones their page edges.
 */
const SLOTS: Array<{ left: string; width: string; bottom: string; ry: number; z: number; layer: number; phone: boolean }> = [
  { left: '35.5%', width: '29%', bottom: '14%', ry: -12, z: 30, layer: 30, phone: true },
  { left: '15%', width: '22%', bottom: '21%', ry: 26, z: -20, layer: 20, phone: true },
  { left: '63%', width: '22%', bottom: '21%', ry: -30, z: -20, layer: 20, phone: true },
  { left: '1%', width: '17%', bottom: '27%', ry: 34, z: -60, layer: 10, phone: false },
  { left: '82%', width: '17%', bottom: '27%', ry: -36, z: -60, layer: 10, phone: false },
];

/** The hero's signature: real books the library holds, set out on a lit display table. */
function HeroShowcase({ books, onShelf, loading }: { books: PublicBook[]; onShelf: boolean; loading: boolean }) {
  const scope = useRef<HTMLDivElement>(null);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const featured = books.find((book) => book.id === featuredId) ?? books[0];
  const hasBooks = books.length > 0;

  // The table leans toward the pointer (mouse/trackpad only). quickTo reuses
  // one tween per axis instead of creating a tween on every pointermove.
  useGSAP(() => {
    const panel = scope.current?.querySelector<HTMLElement>('[data-hero="stage"]');
    const table = scope.current?.querySelector<HTMLElement>('[data-hero="table"]');
    if (!panel || !table) return undefined;
    const mm = gsap.matchMedia();
    mm.add(`${MOTION_OK} and (pointer: fine)`, () => {
      gsap.set(table, { transformPerspective: 1400 });
      const turnY = gsap.quickTo(table, 'rotationY', { duration: 0.9, ease: 'power3' });
      const turnX = gsap.quickTo(table, 'rotationX', { duration: 0.9, ease: 'power3' });
      const onMove = (event: PointerEvent) => {
        const rect = panel.getBoundingClientRect();
        turnY(((event.clientX - rect.left) / rect.width - 0.5) * 9);
        turnX(-((event.clientY - rect.top) / rect.height - 0.5) * 5);
      };
      const onLeave = () => { turnY(0); turnX(0); };
      panel.addEventListener('pointermove', onMove);
      panel.addEventListener('pointerleave', onLeave);
      return () => {
        panel.removeEventListener('pointermove', onMove);
        panel.removeEventListener('pointerleave', onLeave);
      };
    });
    return () => mm.revert();
  }, { scope });

  // Books are set down on the table one after another, once, when the catalog arrives.
  useGSAP(() => {
    if (!hasBooks) return undefined;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.from('[data-hero-book]', {
        opacity: 0,
        y: -70,
        rotationZ: (index: number) => (index % 2 ? -6 : 6),
        duration: 1.1,
        ease: EASE_OUT,
        stagger: 0.09,
        delay: 0.3,
        clearProps: 'opacity,transform',
      });
    });
    return () => mm.revert();
  }, { scope, dependencies: [hasBooks] });

  if (!loading && !hasBooks) return null;

  return (
    <figure ref={scope} className="relative">
      <div
        data-hero="stage"
        className="relative aspect-[16/10] overflow-hidden rounded-[28px] bg-[#1d1a4a] ring-1 ring-black/5 lg:aspect-[5/4] dark:bg-[#15133a] dark:ring-white/10"
      >
        {/* One warm light from above, falling on the table. */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_60%_at_50%_8%,rgba(255,232,190,0.24),transparent_72%)]" aria-hidden="true" />
        {/* Table top: a lighter plane with a lit front edge. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%] bg-[#363181] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_24px_40px_-24px_rgba(255,232,190,0.18)] dark:bg-[#29256a]" aria-hidden="true" />
        <div data-hero="table" className="absolute inset-0">
          {loading ? (
            <div className="absolute bottom-[14%] left-[35.5%] aspect-[2/3] w-[29%] animate-pulse rounded-[4px] bg-white/10" aria-hidden="true" />
          ) : (
            <ul aria-label={onShelf ? 'Sách đang có trên kệ' : 'Một số đầu sách trong thư viện'}>
              {books.map((book, index) => {
                const slot = SLOTS[index];
                return (
                  <li
                    key={book.id}
                    data-hero-book
                    className={cn('absolute', !slot.phone && 'hidden sm:block')}
                    style={{ left: slot.left, width: slot.width, bottom: slot.bottom, zIndex: slot.layer }}
                    onPointerEnter={() => setFeaturedId(book.id)}
                    onFocus={() => setFeaturedId(book.id)}
                  >
                    <Link
                      to={`/books/${book.id}`}
                      className="block rounded-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 focus-visible:ring-offset-4 focus-visible:ring-offset-[#1d1a4a]"
                      title={book.title}
                    >
                      <Book3D
                        title={book.title}
                        author={book.author}
                        imageUrl={book.cover_image_url}
                        pose="showcase"
                        eager
                        style={{ '--show-ry': `${slot.ry}deg`, '--show-z': `${slot.z}px` } as CSSProperties}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <figcaption className="mt-4 flex min-h-[3.25rem] flex-wrap items-start justify-between gap-x-6 gap-y-2">
        {featured ? (
          <>
            <span key={featured.id} className="min-w-0 animate-in fade-in duration-300 motion-reduce:animate-none">
              <Link to={`/books/${featured.id}`} className="block truncate font-display text-[19px] font-semibold leading-tight tracking-[-0.01em] hover:underline">
                {featured.title}
              </Link>
              <span className="mt-0.5 block truncate text-[13.5px] text-muted-foreground">{featured.author || 'Chưa rõ tác giả'}</span>
            </span>
            <AvailabilityStamp book={featured} className="mt-1 shrink-0" />
          </>
        ) : (
          <span className="h-10 w-2/3 animate-pulse rounded bg-muted" aria-hidden="true" />
        )}
      </figcaption>
    </figure>
  );
}

interface HomeHeroProps {
  home: PublicHome | null;
  books: PublicBook[];
  onShelf: boolean;
}

/**
 * First screen: what SmartBook is and the search, on the left; the books on
 * the right. One GSAP timeline brings it in on load: the display table, the
 * headline line by line, then the words, the search and the links. Everything
 * is already in place for reduced motion, and the search works mid-animation.
 */
export function HomeHero({ home, books, onShelf }: HomeHeroProps) {
  const heroRef = useRef<HTMLElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.timeline({ defaults: { ease: EASE_OUT, duration: 1 } })
        .fromTo('[data-hero="stage"]',
          { opacity: 0, clipPath: 'inset(10% 6% 0% 6% round 28px)' },
          { opacity: 1, clipPath: 'inset(0% 0% 0% 0% round 28px)', duration: 1.3, ease: 'power3.out', clearProps: 'clipPath,opacity' }, 0)
        .from('[data-hero="line"]', { opacity: 0, y: '0.4em', rotationX: -40, transformOrigin: '50% 100%', transformPerspective: 700, stagger: 0.1, clearProps: 'transform' }, 0.15)
        .from('[data-hero="lede"]', { opacity: 0, y: 16, duration: 0.9 }, '-=0.75')
        .from('[data-hero="search"]', { opacity: 0, y: 18, duration: 0.9, clearProps: 'transform' }, '<0.08');
    });
    return () => mm.revert();
  }, { scope: heroRef });

  // The links carry live counts, so they join once the catalog answers.
  const hasHome = Boolean(home);
  useGSAP(() => {
    if (!hasHome) return undefined;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.from('[data-hero="cta"]', { opacity: 0, y: 10, duration: 0.8, ease: EASE_OUT, stagger: 0.07, delay: 0.45, clearProps: 'opacity,transform' });
    });
    return () => mm.revert();
  }, { scope: heroRef, dependencies: [hasHome] });

  return (
    <section ref={heroRef} aria-labelledby="hero-title" className="relative overflow-x-clip">
      <div className="mx-auto grid max-w-7xl items-center gap-9 px-4 pb-14 pt-6 sm:px-6 sm:pt-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14 lg:px-8 lg:pb-24 lg:pt-14">
        <div className="min-w-0">
          <h1 id="hero-title" className="font-display text-[clamp(2.3rem,8.8vw,3.1rem)] font-semibold leading-[1.02] tracking-[-0.03em] text-foreground sm:text-[clamp(3.1rem,4.4vw,3.85rem)]">
            <span data-hero="line" className="block">Khám phá cuốn sách</span>
            <span data-hero="line" className="block">tiếp theo của bạn.</span>
          </h1>
          <p data-hero="lede" className="mt-5 max-w-[34rem] text-pretty text-[16px] leading-relaxed text-foreground/75 sm:text-[17px]">
            Tìm theo tên sách, tác giả, hoặc mô tả cuốn bạn muốn đọc để AI gợi ý. Xem ngay chi nhánh nào còn sách và đặt trước khi đến thư viện.
          </p>
          <div data-hero="search" className="mt-7">
            <HeroSearch categories={home?.categories ?? []} />
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 text-[14px]">
            {home ? (
              <>
                <Link data-hero="cta" to="/books?availability=available" className="group inline-flex items-center gap-2 font-semibold text-foreground hover:text-indigo-700 dark:hover:text-indigo-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" aria-hidden="true" />
                  {numberFormat.format(home.stats.available_titles)} đầu sách có sẵn hôm nay
                </Link>
                <Link data-hero="cta" to="/books" className="group inline-flex items-center gap-1.5 font-semibold text-indigo-700 dark:text-indigo-300">
                  Duyệt toàn bộ {numberFormat.format(home.stats.total_titles)} đầu sách
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              </>
            ) : (
              <span className="h-5 w-72 animate-pulse rounded bg-muted" aria-hidden="true" />
            )}
          </div>
        </div>
        <div className="min-w-0">
          <HeroShowcase books={books} onShelf={onShelf} loading={!home} />
        </div>
      </div>
    </section>
  );
}
