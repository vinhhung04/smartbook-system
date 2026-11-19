import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cn } from '@/components/ui/utils';

/** Letters; NFC keeps a Vietnamese letter and its tone mark in one code point. */
const letters = (word: string) => Array.from(word.normalize('NFC'));

/**
 * Cycles through `words`: the old word blurs out, the new one sharpens in letter by letter.
 * Idea from React Bits `RotatingText` / `BlurText` (github.com/DavidHDev/react-bits, MIT + Commons Clause), rewritten small on `motion`.
 * Decorative: give the parent heading an aria-label with the full sentence. Reduced motion shows the first word only.
 */
export function RotatingWords({ words, interval = 2600, className }: { words: string[]; interval?: number; className?: string }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduce || words.length < 2) return undefined;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((current) => (current + 1) % words.length);
    }, interval);
    return () => window.clearInterval(timer);
  }, [reduce, words.length, interval]);

  const word = words[reduce ? 0 : index] ?? '';

  return (
    // Vertical padding keeps tone marks and descenders inside the clip.
    <motion.span layout={!reduce} className={cn('relative inline-flex overflow-hidden py-[0.14em] -my-[0.14em] align-bottom', className)} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={word} className="inline-flex whitespace-pre">
          {letters(word).map((letter, position) => (
            <motion.span
              key={position}
              className="inline-block"
              initial={{ y: '0.25em', opacity: 0, filter: 'blur(6px)' }}
              animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
              exit={{ y: '-0.2em', opacity: 0, filter: 'blur(6px)', transition: { duration: 0.18, delay: position * 0.012 } }}
              transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1], delay: position * 0.03 }}
            >
              {letter}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  );
}
