import type { ComponentType, ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/components/ui/utils';
import type { Urgency } from '@/lib/reorder-intelligence';
import { URGENCY_META } from './meta';

// Building blocks shared by the four decision-center workspaces. Status always
// pairs a shape (icon) with words, so nothing depends on color alone; red is
// kept for states that need action now.

export function Panel({ className, children, ...props }: React.ComponentProps<'section'>) {
  return (
    <section className={cn('rounded-2xl border border-border bg-card', className)} {...props}>
      {children}
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-[12px] font-semibold text-muted-foreground', className)}>{children}</p>;
}

// Hairline-divided summary strip: 1px gaps over a border-colored panel; the last
// figure spans the leftover cell on 2- and 3-column layouts.
export const SUMMARY_GRID = 'grid grid-cols-2 gap-px overflow-hidden bg-border sm:grid-cols-3 xl:grid-cols-5 [&>*]:bg-card [&>*:last-child]:col-span-2 xl:[&>*:last-child]:col-span-1';

/** One figure in a summary strip: label, value, and the scope the value covers. */
export function Figure({ label, value, unit, hint, tone = 'default' }: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: 'default' | 'critical' | 'warning' | 'muted';
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-[13px] leading-snug text-muted-foreground">{unit ? `${label}, ${unit}` : label}</p>
      <p className={cn(
        'mt-1 font-display text-[26px] font-semibold leading-none tracking-[-0.01em] tabular-nums',
        tone === 'critical' && 'text-red-700 dark:text-red-400',
        tone === 'warning' && 'text-amber-700 dark:text-amber-300',
        tone === 'muted' && 'text-muted-foreground',
        tone === 'default' && 'text-foreground',
      )}>
        {value}
      </p>
      {hint ? <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}


export function UrgencyChip({ urgency, className }: { urgency: Urgency; className?: string }) {
  const meta = URGENCY_META[urgency];
  const Icon = meta.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium', meta.chip, className)}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {meta.short}
    </span>
  );
}

/** Thin horizontal meter; `label` is what a screen reader hears instead of the bar. */
export function Meter({ value, className, fill, label }: { value: number; className?: string; fill: string; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span
      className={cn('inline-flex h-1.5 overflow-hidden rounded-full bg-muted', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className={cn('h-full rounded-full', fill)} style={{ width: `${pct}%` }} />
    </span>
  );
}

/** Pill-row filter (urgency, funding, band, action): a labelled group of toggle buttons. */
export function FilterPills<T extends string>({ label, value, onChange, options, className }: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; count?: number; icon?: ComponentType<{ className?: string }>; title?: string }>;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              active
                ? 'border-primary/30 bg-primary/[0.08] font-semibold text-primary'
                : 'border-border bg-card text-foreground hover:bg-muted/60',
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
            <span className="whitespace-nowrap">{option.label}</span>
            {option.count !== undefined ? (
              <span className={cn('rounded px-1 text-[12px] tabular-nums', active ? 'text-primary' : 'text-muted-foreground')}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function LoadingRows({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-2 p-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4">
          <Skeleton className="h-4 w-4 rounded" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-3.5 w-20 sm:block" />
          <Skeleton className="h-7 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Error, empty and "not available yet" states share one calm layout; only errors offer a retry. */
export function StateMessage({ icon: Icon, title, children, tone = 'neutral', onRetry }: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children?: ReactNode;
  tone?: 'neutral' | 'error' | 'notice';
  onRetry?: () => void;
}) {
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className="flex flex-col items-start gap-3 px-5 py-8 sm:flex-row sm:px-6">
      <Icon className={cn(
        'mt-0.5 h-5 w-5 shrink-0',
        tone === 'error' && 'text-red-700 dark:text-red-400',
        tone === 'notice' && 'text-amber-700 dark:text-amber-300',
        tone === 'neutral' && 'text-muted-foreground',
      )} aria-hidden="true" />
      <div className="min-w-0 max-w-[68ch] space-y-1.5">
        <p className="font-display text-[17px] font-semibold tracking-tight text-foreground">{title}</p>
        {children ? <div className="space-y-2 text-[13px] leading-relaxed text-muted-foreground">{children}</div> : null}
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry} className="mt-2">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Thử lại
          </Button>
        ) : null}
      </div>
    </div>
  );
}

