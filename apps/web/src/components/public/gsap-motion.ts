import { createContext, useContext, useEffect, type RefObject } from 'react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from '@/lib/gsap';

// The public site adds ScrollTrigger on top of the shared core (lib/gsap).
gsap.registerPlugin(ScrollTrigger);

export { EASE_OUT, MOTION_OK, gsap, ScrollTrigger, useGSAP };

/**
 * Which engine runs <Reveal>. The rest of the public site keeps Motion's
 * whileInView; the homepage switches it to GSAP so a section is never driven
 * by both libraries at once.
 */
export type RevealEngine = 'motion' | 'gsap';
export const RevealEngineContext = createContext<RevealEngine>('motion');
export const useRevealEngine = () => useContext(RevealEngineContext);

/**
 * Sections on the homepage load at different times (catalog, branches,
 * recommendations), which moves everything below them. Re-measure the
 * ScrollTriggers once the content under `ref` stops changing size.
 */
export function useScrollTriggerRefresh(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    let timer = 0;
    let lastHeight = element.offsetHeight;
    const observer = new ResizeObserver(() => {
      const height = element.offsetHeight;
      if (height === lastHeight) return;
      lastHeight = height;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => ScrollTrigger.refresh(), 200);
    });
    observer.observe(element);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [ref]);
}
