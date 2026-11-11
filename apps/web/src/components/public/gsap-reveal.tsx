import { useRef, type ReactNode } from 'react';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from './gsap-motion';

/** Only the first few items of a list are staggered; the rest are off-screen in carousels anyway. */
const MAX_STAGGERED = 8;

/**
 * Scroll reveal for one section. Inside it, `data-reveal-heading` rises first,
 * then `data-reveal-item` children follow in a short stagger; a section with
 * neither rises as one block. Plays once. Opacity (not visibility) keeps the
 * content focusable: tabbing into it scrolls it into view, which plays it.
 */
export function GsapReveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const root = ref.current;
    if (!root) return undefined;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      const headings = gsap.utils.toArray<HTMLElement>('[data-reveal-heading]', root);
      const items = gsap.utils.toArray<HTMLElement>('[data-reveal-item]', root).slice(0, MAX_STAGGERED);
      const tl = gsap.timeline({
        defaults: { ease: EASE_OUT, clearProps: 'opacity,transform' },
        scrollTrigger: { trigger: root, start: 'top 86%', once: true },
      });
      if (headings.length === 0 && items.length === 0) {
        tl.from(root, { opacity: 0, y: 32, duration: 0.9 });
        return;
      }
      if (headings.length) tl.from(headings, { opacity: 0, y: 22, duration: 0.8 });
      if (items.length) tl.from(items, { opacity: 0, y: 26, duration: 0.7, stagger: 0.06 }, headings.length ? '<0.12' : 0);
    });
    return () => mm.revert();
  }, { scope: ref });

  return <div ref={ref} className={className}>{children}</div>;
}
