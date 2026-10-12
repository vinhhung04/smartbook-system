import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/components/ui/utils';

export interface StageTab<K extends string> {
  key: K;
  label: string;
  count: number;
  /** Highlights a non-empty tab that needs staff action (amber dot). */
  attention?: boolean;
  /** Draws a divider before this tab, separating finished states from the working stages. */
  separated?: boolean;
  /** Consecutive step tabs are joined by arrows so the working stages read as a sequence. */
  step?: boolean;
}

/**
 * Clickable counts that double as the list filter, same look as the receiving pipeline on the
 * goods-receipt page.
 */
export function StageTabs<K extends string>({
  tabs,
  value,
  onChange,
  loading,
  label,
}: {
  tabs: StageTab<K>[];
  value: K;
  onChange: (key: K) => void;
  loading?: boolean;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-stretch gap-1 overflow-x-auto p-2">
      {tabs.map((tab, index) => {
        const active = tab.key === value;
        const arrow = tab.step && tabs[index - 1]?.step && !tab.separated;
        return (
          <Fragment key={tab.key}>
            {tab.separated && <span className="mx-1 w-px shrink-0 self-stretch bg-border" aria-hidden="true" />}
            {arrow && <ChevronRight className="h-3 w-3 shrink-0 self-center text-muted-foreground/40" aria-hidden="true" />}
            <button
              type="button"
              onClick={() => onChange(tab.key)}
              aria-pressed={active}
              className={cn(
                'flex min-w-[96px] flex-1 shrink-0 flex-col items-start rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/15 dark:text-blue-300'
                  : 'border-transparent hover:border-border hover:bg-muted/50',
              )}
            >
              <span className={cn('text-[18px] font-semibold leading-tight tabular-nums', !active && (tab.count ? 'text-foreground' : 'text-muted-foreground/60'))}>
                {loading ? '–' : tab.count.toLocaleString('vi-VN')}
              </span>
              <span className={cn('flex items-center gap-1.5 whitespace-nowrap text-[11px]', active ? 'font-medium' : 'text-muted-foreground')}>
                {tab.attention && tab.count > 0 && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="cần xử lý" />}
                {tab.label}
              </span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
