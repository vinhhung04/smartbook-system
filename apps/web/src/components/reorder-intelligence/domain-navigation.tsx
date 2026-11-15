import { useRef, type ComponentType, type KeyboardEvent } from 'react';
import { cn } from '@/components/ui/utils';
import { panelId, tabId, type DomainId } from './meta';

export interface DomainTab {
  id: DomainId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Headline figure; null while it is not known (loading, error, no model). */
  value: number | string | null;
  /** What the figure counts, or why there is none. */
  caption: string;
  /** The figure is something that needs attention now. */
  alert?: boolean;
  busy?: boolean;
}

/**
 * WAI-ARIA tabs: one tab stop, arrow keys / Home / End move between domains and
 * activate them (automatic activation - every panel's data is already loaded).
 */
export function DomainNavigation({ tabs, active, onChange }: {
  tabs: DomainTab[];
  active: DomainId;
  onChange: (id: DomainId) => void;
}) {
  const refs = useRef<Partial<Record<DomainId, HTMLButtonElement | null>>>({});

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index === 0 ? last : index - 1)
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    const id = tabs[next].id;
    onChange(id);
    refs.current[id]?.focus();
  };

  // A compact row: the workspaces below hold wide tables, so the domains sit above
  // them rather than in a side rail. Captions show once there is room (@container/page).
  return (
    <div
      role="tablist"
      aria-label="Lĩnh vực phân tích"
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(node) => { refs.current[tab.id] = node; }}
            id={tabId(tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              '@4xl/page:min-w-[200px] @4xl/page:flex-1 @4xl/page:items-start @4xl/page:rounded-xl @4xl/page:px-3.5 @4xl/page:py-2.5',
              selected ? 'border-primary/30 bg-primary/[0.08] text-primary' : 'border-border bg-card text-foreground hover:bg-muted/60',
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0 @4xl/page:mt-0.5', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className={cn('whitespace-nowrap text-[13px]', selected ? 'font-semibold' : 'font-medium')}>{tab.label}</span>
                <span className={cn(
                  'min-w-6 rounded-full px-1.5 text-center text-[12px] tabular-nums',
                  tab.value === null ? 'text-muted-foreground' : tab.alert ? 'bg-red-50 font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-400' : selected ? 'text-primary' : 'text-muted-foreground',
                  tab.busy && 'opacity-60',
                )}>
                  {tab.value ?? '–'}
                </span>
              </span>
              <span className="hidden text-[12px] leading-snug text-muted-foreground @4xl/page:block">{tab.caption}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
