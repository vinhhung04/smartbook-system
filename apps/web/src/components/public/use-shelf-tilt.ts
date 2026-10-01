import { useEffect, useRef } from 'react';

/**
 * Pointer parallax for the 3D hero shelf: writes --shelf-tilt-x/-y on the
 * element (read by styles/book-3d.css) from the cursor position. Mouse/trackpad
 * only, skipped when the visitor asks for reduced motion, and done with CSS
 * variables inside requestAnimationFrame so React never re-renders on move.
 */
export function useShelfTilt<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    if (!window.matchMedia('(pointer: fine)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    let frame = 0;
    const apply = (tiltX: number, tiltY: number) => {
      element.style.setProperty('--shelf-tilt-x', `${tiltX.toFixed(2)}deg`);
      element.style.setProperty('--shelf-tilt-y', `${tiltY.toFixed(2)}deg`);
    };
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => apply(-y * 10, x * 30));
    };
    const onLeave = () => {
      cancelAnimationFrame(frame);
      apply(0, 0);
    };

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return ref;
}
