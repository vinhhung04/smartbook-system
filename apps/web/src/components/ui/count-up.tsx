import { useLayoutEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';

/**
 * A figure that counts up from 0 the first time it mounts, then just shows new values.
 * Idea from React Bits `CountUp` (github.com/DavidHDev/react-bits, MIT + Commons Clause), rewritten small on `motion`.
 */
export function CountUp({ to, format, className }: { to: number; format: (value: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const formatRef = useRef(format);
  const played = useRef(false);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    formatRef.current = format;
  });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const show = (value: number) => { node.textContent = formatRef.current(value); };
    if (reduce || played.current || !Number.isFinite(to) || to === 0) {
      show(to);
      return;
    }
    const decimals = Number.isInteger(to) ? 1 : 10;
    const controls = animate(0, to, {
      duration: 0.8,
      ease: 'easeOut',
      onUpdate: (value) => show(Math.round(value * decimals) / decimals),
      onComplete: () => {
        played.current = true;
        show(to);
      },
    });
    // A stopped run (unmount, StrictMode replay) must never leave a partial number behind.
    return () => {
      controls.stop();
      show(to);
    };
  }, [to, reduce]);

  return <span ref={ref} className={className}>{format(to)}</span>;
}
