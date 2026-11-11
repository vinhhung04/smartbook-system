import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import { cn } from '@/components/ui/utils';

/**
 * Shared frame for every dashboard block. The skeleton renders the same frame and header,
 * so nothing moves when data lands. `relative` keeps absolutely positioned children (the
 * sr-only table captions) inside the panel; without it they escape <main>'s scroll box and
 * stretch the whole document, which then scrolls the app shell off screen.
 */
export function Panel({ titleId, className, children }: { titleId: string; className?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={titleId} className={cn('relative flex min-w-0 flex-col rounded-xl border border-border bg-card', className)}>
      {children}
    </section>
  );
}

interface PanelHeaderProps {
  id: string;
  title: string;
  /** h2 for top-level blocks, h3 inside a titled group. */
  level?: 2 | 3;
  description?: ReactNode;
  aside?: ReactNode;
}

export function PanelHeader({ id, title, level = 2, description, aside }: PanelHeaderProps) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 pt-4">
      <div className="min-w-0">
        <Heading id={id} className="text-[15px] font-semibold leading-6 text-foreground">{title}</Heading>
        {description ? <div className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{description}</div> : null}
      </div>
      {aside ? <div className="flex shrink-0 items-center gap-3 pt-0.5">{aside}</div> : null}
    </div>
  );
}

export function PanelBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex-1 px-5 pb-5 pt-3', className)}>{children}</div>;
}

export function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className="group inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
    </NavLink>
  );
}

/** A failed block keeps its frame; the rest of the dashboard stays usable. */
export function BlockError({ what, onRetry, className }: { what: string; onRetry: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-border px-4 py-3 text-[13px]', className)}>
      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-foreground">Không tải được {what}.</span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-md px-1 font-medium text-primary hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Thử lại
      </button>
    </div>
  );
}

/** Quiet one-line state for a block whose data is genuinely empty. */
export function BlockEmpty({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('rounded-lg border border-dashed border-border px-4 py-3 text-[13px] text-muted-foreground', className)}>{children}</p>
  );
}

/** Heading for a group of panels; more air above than below. */
export function GroupHeading({ id, title, description }: { id: string; title: string; description: string }) {
  return (
    <div className="pt-4">
      <h2 id={id} className="text-[17px] font-semibold leading-6 text-foreground">{title}</h2>
      <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

/** Flat placeholder at the real size of the value it stands in for. */
export function Bone({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn('block animate-pulse rounded bg-muted motion-reduce:animate-none', className)} />;
}
