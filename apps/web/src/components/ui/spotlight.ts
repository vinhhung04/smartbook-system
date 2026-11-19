import type { PointerEvent } from 'react';

/**
 * A soft primary glow that follows the pointer while it is over the element.
 * Idea from React Bits `SpotlightCard` (github.com/DavidHDev/react-bits, MIT + Commons Clause), reduced to one CSS layer.
 * The element needs `onPointerMove={spotlightMove}`; the glow sits under its content and above its background.
 */
export const SPOTLIGHT_CLASS = [
  'relative isolate',
  'before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:opacity-0 before:transition-opacity before:duration-300',
  'before:bg-[radial-gradient(220px_circle_at_var(--spot-x,50%)_var(--spot-y,50%),color-mix(in_oklab,var(--primary)_14%,transparent),transparent_70%)]',
  'hover:before:opacity-100 motion-reduce:before:hidden',
].join(' ');

export function spotlightMove(event: PointerEvent<HTMLElement>) {
  const target = event.currentTarget;
  const box = target.getBoundingClientRect();
  target.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
  target.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
}
