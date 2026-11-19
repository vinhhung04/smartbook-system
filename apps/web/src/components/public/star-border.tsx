import type { ReactNode } from 'react';
import { cn } from '@/components/ui/utils';

/**
 * Two soft lights travelling along a pill's top and bottom edges (keyframes `star-border-*` in styles/index.css).
 * Idea from React Bits `StarBorder` (github.com/DavidHDev/react-bits, MIT + Commons Clause), reduced to CSS.
 * Wrap a rounded-full control; the lights stop under reduced motion.
 */
export function StarBorder({ children, color = '#fff3c4', className }: { children: ReactNode; color?: string; className?: string }) {
  const light = { background: `radial-gradient(circle, ${color}, transparent 12%)` };
  return (
    <span className={cn('relative inline-flex overflow-hidden rounded-full p-[2px]', className)}>
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-[11px] right-[-250%] h-1/2 w-[300%] rounded-full opacity-80 [animation:star-border-bottom_5s_linear_infinite_alternate] motion-reduce:hidden" style={light} />
      <span aria-hidden="true" className="pointer-events-none absolute -top-[10px] left-[-250%] h-1/2 w-[300%] rounded-full opacity-80 [animation:star-border-top_5s_linear_infinite_alternate] motion-reduce:hidden" style={light} />
      <span className="relative z-10 inline-flex">{children}</span>
    </span>
  );
}
