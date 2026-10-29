import { useRef, useSyncExternalStore, type ComponentType } from 'react';
import { AlertTriangle, Clock3, OctagonAlert } from 'lucide-react';
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from '@/lib/gsap';
import type { Urgency } from '@/lib/reorder-intelligence';

// Non-component exports of the decision center (kept apart from the .tsx files for fast refresh).

export const URGENCY_META: Record<Urgency, {
  label: string;
  short: string;
  icon: ComponentType<{ className?: string }>;
  text: string;
  chip: string;
  hint: string;
}> = {
  OUT: {
    label: 'Đã hết hàng',
    short: 'Hết hàng',
    icon: OctagonAlert,
    text: 'text-red-700 dark:text-red-400',
    chip: 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
    hint: 'Không còn bản nào sẵn sàng cho mượn — nên xem xét trước tiên.',
  },
  BEFORE_RESTOCK: {
    label: 'Sẽ hết trước khi hàng về',
    short: 'Hết trước khi hàng về',
    icon: AlertTriangle,
    text: 'text-amber-800 dark:text-amber-300',
    chip: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
    hint: 'Dự kiến hết trước khi một đơn đặt hôm nay kịp về (theo thời gian chờ hàng của từng sách) — có thể thiếu hàng tạm thời.',
  },
  LATER: {
    label: 'Còn thời gian',
    short: 'Còn thời gian',
    icon: Clock3,
    text: 'text-muted-foreground',
    chip: 'border-border bg-muted/50 text-muted-foreground',
    hint: 'Còn hàng lâu hơn thời gian chờ hàng của sách, hoặc chưa xác định được — có thể lên kế hoạch.',
  },
};

/**
 * Data views render either their table or their phone list, never both, so ids
 * (aria-controls / aria-describedby) stay unique and inputs are not duplicated.
 */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      // `resize` as well: some embedded/emulated viewports change size without a `change` event.
      media.addEventListener('change', onChange);
      window.addEventListener('resize', onChange);
      return () => {
        media.removeEventListener('change', onChange);
        window.removeEventListener('resize', onChange);
      };
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}

export const WIDE_QUERY = '(min-width: 768px)';

/** Short fade-up for content that appears on demand (row details, the selection bar). */
export function useRevealOnMount<T extends HTMLElement>(y = 6) {
  const ref = useRef<T>(null);
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      if (ref.current) gsap.from(ref.current, { autoAlpha: 0, y, duration: 0.28, ease: EASE_OUT });
    });
    return () => mm.revert();
  }, { scope: ref });
  return ref;
}

export type DomainId = 'reorder' | 'weeding' | 'late-return' | 'no-show';
export const panelId = (id: DomainId) => `decision-panel-${id}`;
export const tabId = (id: DomainId) => `decision-tab-${id}`;
