import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { publicCatalogService, type PublicBook } from '@/services/public-catalog';
import { bindingFor } from '@/lib/book-binding';
import { Book3D } from '@/components/public/book-3d';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from '@/lib/gsap';
import { AuthToneContext } from './auth-tone';

/** Same display-table geometry as the homepage hero, so the two read as one place. */
const SLOTS = [
  { left: '35.5%', width: '29%', bottom: '15%', ry: -12, z: 30, layer: 30 },
  { left: '13%', width: '22%', bottom: '22%', ry: 26, z: -20, layer: 20 },
  { left: '65%', width: '22%', bottom: '22%', ry: -30, z: -20, layer: 20 },
  { left: '-1%', width: '17%', bottom: '28%', ry: 34, z: -60, layer: 10 },
  { left: '84%', width: '17%', bottom: '28%', ry: -36, z: -60, layer: 10 },
];
/** Cloth colours for the fallback table: decoration only, no invented titles. */
const FALLBACK_SEEDS = ['van-hoc', 'lich-su', 'khoa-hoc', 'tho', 'du-ky'];

/**
 * Real covers from the public catalog, set on a lit table. Login never waits for
 * it: until (or unless) the catalog answers, plain cloth-bound books stand in.
 * Purely visual here, so it is hidden from assistive tech and not focusable.
 */
function CustomerAuthBookShowcase() {
  const scope = useRef<HTMLDivElement>(null);
  const [books, setBooks] = useState<PublicBook[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    publicCatalogService.getBooks({ availability: 'available', pageSize: 12 }, controller.signal)
      .then((page) => setBooks(page.data.filter((book) => book.cover_image_url).slice(0, SLOTS.length)))
      .catch(() => { if (!controller.signal.aborted) setBooks([]); });
    return () => controller.abort();
  }, []);

  const real = books && books.length >= 3 ? books : null;
  const settled = books !== null;

  // Books are set down once, when we know which books (or stand-ins) to show.
  useGSAP(() => {
    if (!settled) return undefined;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.from('[data-auth="book"]', {
        opacity: 0,
        y: -60,
        rotationY: (index: number) => (index % 2 ? -24 : 24),
        transformPerspective: 900,
        duration: 1,
        ease: EASE_OUT,
        stagger: 0.08,
        delay: 0.2,
        clearProps: 'opacity,transform',
      });
    });
    return () => mm.revert();
  }, { scope, dependencies: [settled] });

  return (
    <div ref={scope} className="relative -mx-10 -mb-10 mt-auto aspect-[16/9] xl:-mx-14 xl:-mb-14" aria-hidden="true">
      {/* Table top with a lit front edge, the same light as the homepage; it runs to the panel's edges. */}
      <div className="absolute inset-x-0 bottom-0 h-[34%] bg-[#363181] shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_0_24px_40px_-24px_rgba(255,232,190,0.18)] dark:bg-[#29256a]" />
      <div className="absolute inset-y-0 left-[8%] right-[8%]">
      {settled ? SLOTS.map((slot, index) => {
        const book = real?.[index];
        if (real && !book) return null;
        return (
          <div key={book?.id ?? FALLBACK_SEEDS[index]} data-auth="book" className="absolute" style={{ left: slot.left, width: slot.width, bottom: slot.bottom, zIndex: slot.layer }}>
            {book ? (
              <Book3D
                title={book.title}
                author={book.author}
                imageUrl={book.cover_image_url}
                pose="showcase"
                eager
                style={{ '--show-ry': `${slot.ry}deg`, '--show-z': `${slot.z}px` } as CSSProperties}
              />
            ) : (
              <span
                className="block aspect-[2/3] rounded-[2px_5px_5px_2px] shadow-[0_18px_30px_-16px_rgba(0,0,0,0.7)]"
                style={{
                  backgroundColor: bindingFor(FALLBACK_SEEDS[index]),
                  backgroundImage: 'linear-gradient(155deg, rgba(255,255,255,0.14), rgba(255,255,255,0) 45%, rgba(0,0,0,0.22))',
                  transform: `perspective(900px) rotateY(${slot.ry}deg)`,
                }}
              />
            )}
          </div>
        );
      }) : null}
      </div>
    </div>
  );
}

interface CustomerAuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  /** The reading-room panel with books (login); off for short task pages. */
  showcase?: boolean;
}

/**
 * Reader portal: an editorial reading room. The form sits on paper at the left;
 * at the right, an inset ink panel welcomes the reader with real books. The
 * form arrives first so typing can start at once; the panel follows.
 */
export function CustomerAuthShell({ title, subtitle, children, footer, showcase = true }: CustomerAuthShellProps) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.timeline({ defaults: { ease: EASE_OUT, duration: 0.8 } })
        .from('[data-auth="form-item"]', { opacity: 0, y: 14, stagger: 0.06, duration: 0.7, clearProps: 'opacity,transform' }, 0)
        .from('[data-auth="title-line"]', { opacity: 0, y: '0.35em', rotationX: -35, transformOrigin: '50% 100%', transformPerspective: 700, stagger: 0.08, clearProps: 'opacity,transform' }, 0.05)
        .fromTo('[data-auth="panel"]',
          { opacity: 0, clipPath: 'inset(8% 6% 0% 6% round 28px)' },
          { opacity: 1, clipPath: 'inset(0% 0% 0% 0% round 28px)', duration: 1.1, ease: 'power3.out', clearProps: 'clipPath,opacity' }, 0.1)
        .from('[data-auth="statement"]', { opacity: 0, y: '0.4em', rotationX: -35, transformOrigin: '50% 100%', transformPerspective: 700, stagger: 0.09, clearProps: 'opacity,transform' }, 0.3);
    });
    return () => mm.revert();
  }, { scope });

  return (
    <AuthToneContext.Provider value="customer">
      <div ref={scope} className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-4 lg:p-4">
        <main className="flex min-h-dvh flex-col px-5 py-6 sm:px-10 lg:min-h-0 lg:px-12">
          <div data-auth="form-item" className="mx-auto flex w-full max-w-[420px] items-center justify-between gap-4">
            <Link to="/" className="inline-flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60" aria-label="SmartBook — trang chủ">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-indigo-700 text-white dark:bg-indigo-500">
                <BookOpen className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="font-display text-[20px] font-semibold tracking-[-0.02em] text-foreground">SmartBook</span>
            </Link>
            <Link to="/" className="inline-flex min-h-10 items-center gap-1.5 rounded-md text-[13.5px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Về trang chủ
            </Link>
          </div>
          <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">
            <div>
              <h1 className="font-display text-[34px] font-semibold leading-[1.05] tracking-[-0.025em] text-foreground sm:text-[40px]">
                <span data-auth="title-line" className="block">{title}</span>
              </h1>
              <p data-auth="form-item" className="mt-3 text-pretty text-[15px] leading-relaxed text-muted-foreground">{subtitle}</p>
            </div>
            <div data-auth="form-item" className="mt-8">{children}</div>
            {footer ? <div data-auth="form-item" className="mt-8">{footer}</div> : null}
          </div>
        </main>

        <aside data-auth="panel" className="relative hidden min-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-[28px] bg-[#1d1a4a] p-10 text-white lg:flex xl:p-14 dark:bg-[#15133a] dark:ring-1 dark:ring-white/10">
          {/* One warm light from above, as on the homepage table. */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_100%,rgba(255,232,190,0.16),transparent_72%)]" aria-hidden="true" />
          <div className="relative max-w-[46rem]">
            <p className="font-display text-[clamp(2.5rem,3.3vw,3.4rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
              <span data-auth="statement" className="block">Thế giới sách của bạn,</span>
              <span data-auth="statement" className="block">bắt đầu từ đây.</span>
            </p>
            <p data-auth="statement" className="mt-5 max-w-[30rem] text-[15.5px] leading-relaxed text-indigo-100/85">
              Đặt trước sách ở chi nhánh gần bạn, theo dõi hạn trả và nhận gợi ý từ những cuốn bạn đã đọc.
            </p>
          </div>
          {showcase ? <CustomerAuthBookShowcase /> : null}
        </aside>
      </div>
    </AuthToneContext.Provider>
  );
}
