import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Follows the end of the conversation only while the reader is already near
// it (the pattern of Vercel's ai-chatbot use-scroll-to-bottom): streaming
// tokens and charts that finish laying out keep the view pinned, but someone
// who scrolled up to reread an earlier answer is left where they are.

const NEAR_BOTTOM_PX = 64;

/** `follow`: whether there is a conversation to follow at all (an empty-state
 * screen is read from the top). */
export function useStickToBottom(follow: boolean) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stuckRef = useRef(true);
  const followRef = useRef(follow);
  const [atBottom, setAtBottom] = useState(true);

  useLayoutEffect(() => {
    followRef.current = follow;
  }, [follow]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      stuckRef.current = near;
      setAtBottom(near);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Content growth (tokens, a chart mounting) never fires a scroll event, so
  // watch the content box and re-pin while stuck. Instant, not smooth: a smooth
  // scroll per token would queue animations and stutter on long answers.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (stuckRef.current && followRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    stuckRef.current = true;
    setAtBottom(true);
    el?.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  return { scrollRef, contentRef, atBottom, scrollToBottom };
}
