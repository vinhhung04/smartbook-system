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

  return (
    <div
      role="tablist"
      aria-label="Lĩnh vực phân tích"
      className={cn('grid grid-cols-2 gap-2', tabs.length > 2 ? 'lg:grid-cols-4' : 'sm:grid-cols-2 lg:max-w-2xl')}
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
              'group relative flex min-h-[76px] cursor-pointer flex-col justify-between gap-2 rounded-xl border px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              selected
                ? 'border-primary/45 bg-card shadow-sm ring-1 ring-primary/15 dark:shadow-none'
                : 'border-border bg-card/60 hover:border-foreground/15 hover:bg-card',
            )}
          >
            <span className={cn('absolute inset-x-3.5 bottom-0 h-0.5 rounded-full transition-colors', selected ? 'bg-primary' : 'bg-transparent')} aria-hidden="true" />
            <span className="flex items-start gap-2">
              <Icon className={cn('mt-px h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
              <span className={cn('text-[13px] font-semibold leading-tight', selected ? 'text-foreground' : 'text-foreground/80')}>{tab.label}</span>
            </span>
            <span className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-2">
              <span className={cn(
                'text-[20px] font-semibold leading-none tabular-nums',
                tab.value === null ? 'text-muted-foreground/60' : tab.alert ? 'text-red-600 dark:text-red-400' : 'text-foreground',
                tab.busy && 'animate-pulse',
              )}>
                {tab.value ?? '—'}
              </span>
              <span className="min-w-0 text-[11.5px] leading-snug text-muted-foreground sm:truncate">{tab.caption}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
