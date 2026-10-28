import { createContext, useContext, useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

// Registered once for the whole public site.
gsap.registerPlugin(useGSAP, ScrollTrigger);

export { gsap, ScrollTrigger, useGSAP };

/** Every GSAP scene runs only inside this query; reduced motion gets the final layout, untouched. */
export const MOTION_OK = '(prefers-reduced-motion: no-preference)';
/** Long exponential settle: fast start, soft landing. Shared so the page moves with one voice. */
export const EASE_OUT = 'expo.out';

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
