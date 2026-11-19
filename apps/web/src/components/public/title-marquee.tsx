import { useEffect, useRef } from 'react';
import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, useVelocity, type MotionValue } from 'motion/react';
import { cn } from '@/components/ui/utils';

const COPIES = 4;
/** Longer titles (after cleaning) make the strip read as a wall of text; they are left out. */
const MAX_TITLE_LENGTH = 34;
/** Keeps `value` in [min, max): the strip loops by jumping back one copy. */
const wrap = (min: number, max: number, value: number) => ((((value - min) % (max - min)) + (max - min)) % (max - min)) + min;

/** "Đi Tìm Lẽ Sống (Tái Bản 2022)" -> "Đi Tìm Lẽ Sống"; series/format suffixes after " - " go too. */
function cleanTitle(title: string) {
  return title.replace(/\s*[([].*?[)\]]\s*/g, ' ').split(' - ')[0].replace(/\s+/g, ' ').trim();
}

/** `pxPerSecond`: a fixed reading speed, whatever the number of titles (negative = leftward). */
function Row({ items, pxPerSecond, scrollFactor, reduce, className }: { items: string[]; pxPerSecond: number; scrollFactor: MotionValue<number>; reduce: boolean; className?: string }) {
  const baseX = useMotionValue(0);
  const direction = useRef(1);
  const stripRef = useRef<HTMLDivElement>(null);
  const copyWidth = useRef(0);
  // Wrapping over exactly one copy's width makes the loop seamless.
  const x = useTransform(baseX, (value) => (copyWidth.current ? wrap(-copyWidth.current, 0, value) : 0));

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const observer = new ResizeObserver(() => { copyWidth.current = strip.scrollWidth / COPIES; });
    observer.observe(strip);
    return () => observer.disconnect();
  }, []);

  useAnimationFrame((_, delta) => {
    if (reduce) return;
    const factor = scrollFactor.get();
    // Scrolling up reverses the strips, scrolling fast speeds them up a little.
    if (factor < 0) direction.current = -1;
    else if (factor > 0) direction.current = 1;
    baseX.set(baseX.get() + direction.current * pxPerSecond * (delta / 1000) * (1 + Math.abs(factor)));
  });

  return (
    <div className="flex overflow-hidden whitespace-nowrap">
      <motion.div ref={stripRef} className={cn('flex shrink-0 items-center whitespace-nowrap', className)} style={{ x: reduce ? 0 : x }}>
        {Array.from({ length: COPIES }, (_, copy) => (
          <span key={copy} className="flex shrink-0 items-center">
            {items.map((title) => (
              <span key={title} className="flex items-center">
                {title}
                <span className="mx-[0.55em] text-[0.45em] text-amber-500 dark:text-amber-400">✦</span>
              </span>
            ))}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

/**
 * A ruled ticker of real titles: two lines drifting in opposite directions, pushed along by the page's scroll speed.
 * Idea from React Bits `ScrollVelocity` (github.com/DavidHDev/react-bits, MIT + Commons Clause), rewritten on `motion`.
 * Decorative (the same books are listed in the sections around it), so it is hidden from assistive tech.
 */
export function TitleMarquee({ titles, className }: { titles: string[]; className?: string }) {
  const reduce = Boolean(useReducedMotion());
  const { scrollY } = useScroll();
  const smoothVelocity = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 });
  const scrollFactor = useTransform(smoothVelocity, [-1000, 0, 1000], [-1.5, 0, 1.5], { clamp: false });

  const unique = [...new Set(titles.map(cleanTitle))].filter((title) => title && title.length <= MAX_TITLE_LENGTH);
  if (unique.length < 6) return null;
  const half = Math.ceil(unique.length / 2);

  return (
    <div
      aria-hidden="true"
      data-marquee
      className={cn(
        'select-none space-y-2 overflow-hidden border-y border-border py-6 font-display tracking-[-0.015em] sm:py-8',
        // Fade both ends so the lines drift in and out instead of being cut at the viewport edge.
        '[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]',
        className,
      )}
    >
      <Row items={unique.slice(0, half)} pxPerSecond={-40} scrollFactor={scrollFactor} reduce={reduce} className="font-semibold text-foreground/90" />
      <Row items={unique.slice(half)} pxPerSecond={40} scrollFactor={scrollFactor} reduce={reduce} className="font-medium italic text-muted-foreground/80" />
    </div>
  );
}
