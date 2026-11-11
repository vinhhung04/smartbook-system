import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { motion } from 'motion/react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { PublicBook } from '@/services/public-catalog';
import { cn } from '@/components/ui/utils';
import { BookCardSkeleton, PublicBookCard } from './public-book-card';
import type { AvailabilityAlerts } from './use-availability-alerts';
import { useRevealEngine } from './gsap-motion';
import { GsapReveal } from './gsap-reveal';

interface SectionHeadingProps {
  id: string;
  title: string;
  /** Short label above the title (what kind of list this is). */
  eyebrow?: string;
  /** What the ranking is based on, in plain words — shown under the title. */
  basis?: ReactNode;
  seeAllTo?: string;
  /** Extra controls on the right (e.g. carousel arrows). */
  actions?: ReactNode;
  tone?: 'default' | 'inverse';
}

export function SectionHeading({ id, title, eyebrow, basis, seeAllTo, actions, tone = 'default' }: SectionHeadingProps) {
  const inverse = tone === 'inverse';
  return (
    <div data-reveal-heading className="mb-8 flex flex-col items-start gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-2xl">
        <h2 id={id} className={cn('text-balance font-display text-[30px] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[40px]', inverse ? 'text-white' : 'text-foreground')}>{title}</h2>
        {/* What the list is (the old label above the title) leads the explanation instead. */}
        {eyebrow || basis ? (
          <p className={cn('mt-3 text-pretty text-[14.5px] leading-relaxed', inverse ? 'text-indigo-100/80' : 'text-muted-foreground')}>
            {eyebrow ? <span className={cn('font-semibold', inverse ? 'text-white' : 'text-foreground')}>{eyebrow}. </span> : null}
            {basis}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {seeAllTo ? (
          <Link
            to={seeAllTo}
            className={cn(
              'group/see inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
              inverse ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100 dark:bg-indigo-500/15 dark:text-indigo-200 dark:hover:bg-indigo-500/25',
            )}
          >
            Xem tất cả <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover/see:translate-x-0.5" aria-hidden="true" />
          </Link>
        ) : null}
        {actions}
      </div>
    </div>
  );
}

/** Scroll-snap row with arrow buttons that disable at either end (desktop). */
function useCarousel() {
  const trackRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const update = () => {
      const max = track.scrollWidth - track.clientWidth;
      setEdges({ start: track.scrollLeft <= 2, end: track.scrollLeft >= max - 2 });
    };
    const frame = requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    observer.observe(track);
    track.addEventListener('scroll', update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      track.removeEventListener('scroll', update);
    };
  }, []);

  const scrollBy = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: reduce ? 'auto' : 'smooth' });
  };

  return { trackRef, edges, scrollBy };
}

export function CarouselArrows({ label, edges, onScroll, tone = 'default' }: { label: string; edges: { start: boolean; end: boolean }; onScroll: (direction: 1 | -1) => void; tone?: 'default' | 'inverse' }) {
  const button = cn(
    'inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:pointer-events-none disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
    tone === 'inverse' ? 'border-white/25 text-white hover:bg-white/10' : 'border-border bg-card text-foreground hover:border-indigo-300',
  );
  return (
    <div className="hidden items-center gap-1.5 md:flex">
      <button type="button" className={button} onClick={() => onScroll(-1)} disabled={edges.start} aria-label={`${label}: xem các cuốn trước`}>
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <button type="button" className={button} onClick={() => onScroll(1)} disabled={edges.end} aria-label={`${label}: xem các cuốn tiếp theo`}>
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  // On the homepage GSAP owns section entrances (see gsap-motion.tsx).
  const engine = useRevealEngine();
  if (engine === 'gsap') return <GsapReveal className={className}>{children}</GsapReveal>;
  return (
    <motion.div
      className={className}
      // Eases in once when scrolled to (off under reduced motion via MotionConfig).
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

interface BookRowProps {
  id: string;
  title: string;
  eyebrow?: string;
  basis?: ReactNode;
  books: PublicBook[];
  seeAllTo?: string;
  onReserve?: (book: PublicBook) => void;
  alerts?: AvailabilityAlerts;
}

/** A horizontally scrolling shelf of books (swipe on phones, arrows on desktop). */
export function BookRow({ id, title, eyebrow, basis, books, seeAllTo, onReserve, alerts }: BookRowProps) {
  const { trackRef, edges, scrollBy } = useCarousel();
  if (books.length === 0) return null;
  return (
    <Reveal>
      <section aria-labelledby={id}>
        <SectionHeading
          id={id}
          title={title}
          eyebrow={eyebrow}
          basis={basis}
          seeAllTo={seeAllTo}
          actions={books.length > 6 ? <CarouselArrows label={title} edges={edges} onScroll={scrollBy} /> : null}
        />
        {/* Vertical padding leaves room for the 3D hover lift inside the scroll box. */}
        <ul
          ref={trackRef}
          className="-mx-4 -my-4 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 py-4 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:gap-5 lg:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {books.map((book) => (
            <li key={book.id} data-reveal-item className="w-[42%] shrink-0 snap-start sm:w-[28%] md:w-[22%] lg:w-[calc((100%-6.25rem)/6)]">
              <PublicBookCard book={book} onReserve={onReserve} alerts={alerts} />
            </li>
          ))}
        </ul>
      </section>
    </Reveal>
  );
}

export function BookRowSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6 h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6 lg:gap-5">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className={index >= 2 ? 'hidden sm:block' : undefined}>
            <BookCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
