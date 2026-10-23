import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { PublicBook } from '@/services/public-catalog';
import { AvailabilityStamp } from './availability-stamp';
import { Book3D } from './book-3d';
import { CarouselArrows, Reveal, SectionHeading } from './book-row';

interface CoverFlowProps {
  id: string;
  title: string;
  eyebrow?: string;
  basis?: ReactNode;
  books: PublicBook[];
  seeAllTo?: string;
  onReserve?: (book: PublicBook) => void;
}

const MAX_ANGLE = 55;
const DEPTH_PX = 70;
/** Below this many books a loop would show the same cover on both sides of the centre. */
const MIN_LOOP_BOOKS = 3;
/** Quiet time after the last scroll event before an edge copy is swapped for the middle one. */
const SETTLE_MS = 140;

/**
 * Cover Flow: the centred book faces you; the others turn toward the centre in
 * 3D (left ones show their spine, right ones their page edges) and step back.
 * It is a normal scroll-snap list underneath, so swipe, trackpad and wheel work,
 * plus arrow buttons and ←/→ keys. Angles are written as CSS variables on scroll.
 *
 * It loops: the list is rendered three times and starts on the middle copy, so
 * there are always books on both sides. Once scrolling settles on an outer
 * copy, the track jumps (instantly, to the identical spot) back into the middle
 * one. Only the middle copy is exposed to screen readers and Tab.
 */
export function CoverFlow({ id, title, eyebrow, basis, books, seeAllTo, onReserve }: CoverFlowProps) {
  const trackRef = useRef<HTMLUListElement>(null);
  const count = books.length;
  const loop = count >= MIN_LOOP_BOOKS;
  const copies = loop ? 3 : 1;
  const items = loop ? [...books, ...books, ...books] : books;
  // Physical index into `items`; books[active % count] is the centred book.
  const [active, setActive] = useState(loop ? count : 0);

  // Start centred on the first book of the middle copy (before the first paint).
  useLayoutEffect(() => {
    const track = trackRef.current;
    const first = track?.children[loop ? count : 0] as HTMLElement | undefined;
    if (!track || !first) return;
    // The scroll event this fires lets the layout pass below pick the active book.
    track.scrollLeft = first.offsetLeft + first.offsetWidth / 2 - track.clientWidth / 2;
  }, [count, loop]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;

    const layout = () => {
      const center = track.scrollLeft + track.clientWidth / 2;
      let nearest = 0;
      let nearestDistance = Infinity;
      Array.from(track.children).forEach((child, index) => {
        const item = child as HTMLElement;
        const offset = (item.offsetLeft + item.offsetWidth / 2 - center) / item.offsetWidth;
        const distance = Math.abs(offset);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = index;
        }
        const clamped = Math.max(-1, Math.min(1, offset));
        item.style.setProperty('--flow-ry', `${(-clamped * MAX_ANGLE).toFixed(1)}deg`);
        item.style.setProperty('--flow-z', `${(-Math.min(distance, 2.5) * DEPTH_PX).toFixed(0)}px`);
        item.style.opacity = String(Math.max(0.35, 1 - Math.min(distance, 4) * 0.16));
        item.style.zIndex = String(100 - Math.round(distance * 10));
        // Pull side books in toward the centre so they overlap like a real cover flow.
        item.style.transform = reduce ? '' : `translateX(${(-Math.sign(offset) * Math.min(distance, 3) * 22).toFixed(1)}%)`;
      });
      setActive((previous) => (previous === nearest ? previous : nearest));
    };

    // Back into the middle copy once the reader stops on an outer one. Snap is
    // paused for the jump and the 3D transforms are updated right away: snap
    // positions follow the transformed covers, so stale ones would re-snap the
    // track off-centre.
    let timer = 0;
    const recentre = () => {
      const children = track.children;
      const middleStart = (children[count] as HTMLElement).offsetLeft;
      const copyWidth = middleStart - (children[0] as HTMLElement).offsetLeft;
      const center = track.scrollLeft + track.clientWidth / 2;
      const shift = center < middleStart ? copyWidth : center >= middleStart + copyWidth ? -copyWidth : 0;
      if (!shift) return;
      track.style.scrollSnapType = 'none';
      track.scrollLeft += shift;
      layout();
      track.style.scrollSnapType = '';
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    };
    const onScroll = () => {
      schedule();
      if (!loop) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(recentre, SETTLE_MS);
    };
    schedule();
    track.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      track.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [count, loop]);

  const scrollToIndex = useCallback((index: number) => {
    const track = trackRef.current;
    const item = track?.children[index] as HTMLElement | undefined;
    if (!track || !item) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    track.scrollTo({ left: item.offsetLeft + item.offsetWidth / 2 - track.clientWidth / 2, behavior: reduce ? 'auto' : 'smooth' });
  }, []);

  const step = (direction: 1 | -1) => scrollToIndex(Math.max(0, Math.min(items.length - 1, active + direction)));

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    }
  };

  if (count === 0) return null;
  const current = books[active % count];

  return (
    <Reveal>
      <section aria-labelledby={id}>
        <SectionHeading
          id={id}
          eyebrow={eyebrow}
          title={title}
          basis={basis}
          seeAllTo={seeAllTo}
          actions={
            <CarouselArrows
              label={title}
              edges={loop ? { start: false, end: false } : { start: active <= 0, end: active >= count - 1 }}
              onScroll={step}
            />
          }
        />
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-transparent via-indigo-50/50 to-indigo-100/60 dark:via-indigo-950/20 dark:to-indigo-950/40">
          <ul
            ref={trackRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            aria-label={`${title} — dùng phím mũi tên để lướt`}
            className="flex snap-x snap-mandatory items-end overflow-x-auto px-[calc(50%-5rem)] pb-16 pt-10 outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500/40 sm:px-[calc(50%-6rem)] lg:px-[calc(50%-6.5rem)] [&::-webkit-scrollbar]:hidden"
          >
            {items.map((book, index) => {
              // Outer copies of the loop are visual only.
              const clone = copies > 1 && Math.floor(index / count) !== 1;
              return (
              <li key={`${Math.floor(index / count)}-${book.id}`} aria-hidden={clone || undefined} className="cover-flow__item relative w-40 shrink-0 snap-center sm:w-48 lg:w-52" style={{ '--flow-ry': '0deg' } as CSSProperties}>
                <Link
                  to={`/books/${book.id}`}
                  tabIndex={clone ? -1 : undefined}
                  onClick={(event) => {
                    // A side book first comes to the centre; the centred one opens.
                    if (index !== active) {
                      event.preventDefault();
                      scrollToIndex(index);
                    }
                  }}
                  aria-current={index === active ? 'true' : undefined}
                  aria-label={index === active ? `Mở ${book.title}` : `Đưa ${book.title} ra giữa`}
                  className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60"
                >
                  <div className="cover-flow__reflect">
                    <Book3D title={book.title} author={book.author} imageUrl={book.cover_image_url} pose="flow" />
                  </div>
                </Link>
              </li>
              );
            })}
          </ul>
        </div>

        <div className="mx-auto mt-6 flex max-w-xl flex-col items-center text-center" aria-live="polite">
          <h3 className="font-serif text-[22px] font-semibold leading-tight tracking-tight sm:text-[26px]">
            <Link to={`/books/${current.id}`} className="hover:underline">{current.title}</Link>
          </h3>
          <p className="mt-1 text-[14px] text-muted-foreground">{current.author || 'Chưa rõ tác giả'}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <AvailabilityStamp book={current} />
            {current.reservable && onReserve ? (
              <button type="button" onClick={() => onReserve(current)} className="inline-flex h-9 items-center rounded-full bg-indigo-700 px-4 text-[13px] font-semibold text-white hover:bg-indigo-800 dark:bg-indigo-500">
                Đặt trước
              </button>
            ) : null}
            <Link to={`/books/${current.id}`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
              Xem chi tiết <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          <p className="mt-3 font-mono text-[11.5px] text-muted-foreground">{(active % count) + 1} / {count}</p>
        </div>
      </section>
    </Reveal>
  );
}
