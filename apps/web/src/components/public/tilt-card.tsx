import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/components/ui/utils';

/**
 * Card that tilts toward the pointer in 3D with a soft glare (styles/book-3d.css
 * .tilt-card). Mouse/trackpad only and off under reduced motion; values are
 * written as CSS variables inside requestAnimationFrame, never through React state.
 */
export function TiltCard({ children, className, max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    if (!window.matchMedia('(pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        element.classList.add('is-tilting');
        element.style.setProperty('--tilt-ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
        element.style.setProperty('--tilt-rx', `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
        element.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`);
        element.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`);
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      element.classList.remove('is-tilting');
      element.style.setProperty('--tilt-ry', '0deg');
      element.style.setProperty('--tilt-rx', '0deg');
    };

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
    };
  }, [max]);

  return <div ref={ref} className={cn('tilt-card', className)}>{children}</div>;
}
