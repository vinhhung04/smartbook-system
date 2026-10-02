import type { ReactNode } from 'react';
import { cn } from '@/components/ui/utils';

interface PageHeroProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Above the eyebrow, e.g. a breadcrumb. */
  top?: ReactNode;
  /** Below the description, e.g. a search field. */
  children?: ReactNode;
  /** Right-hand visual on wide screens (e.g. a fan of covers). */
  aside?: ReactNode;
  className?: string;
}

/**
 * Header band for the public inner pages: the homepage hero's atmosphere
 * (soft gradient, fading dot grid, one light) at a smaller scale, so every page
 * of the public site reads as the same product.
 */
export function PageHero({ eyebrow, title, description, top, children, aside, className }: PageHeroProps) {
  return (
    <section className={cn('relative overflow-x-clip border-b border-border bg-gradient-to-b from-indigo-50/80 via-background to-background dark:from-indigo-950/30', className)}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,rgba(79,70,229,0.12)_1px,transparent_0)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_65%_80%_at_30%_0%,black,transparent)] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(165,180,252,0.1)_1px,transparent_0)]" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-indigo-300/25 blur-3xl dark:bg-indigo-600/20" aria-hidden="true" />
      <div className="relative mx-auto flex max-w-7xl items-end justify-between gap-10 px-4 pb-10 pt-10 sm:px-6 lg:px-8 lg:pb-12 lg:pt-14">
        <div className="min-w-0 max-w-3xl flex-1">
          {top ? <div className="mb-4">{top}</div> : null}
          {eyebrow ? <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-indigo-700 dark:text-indigo-300">{eyebrow}</p> : null}
          <h1 className="text-balance font-serif text-[34px] font-semibold leading-[1.08] tracking-tight sm:text-[44px]">{title}</h1>
          {description ? <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{description}</p> : null}
          {children ? <div className="mt-6">{children}</div> : null}
        </div>
        {aside ? <div className="hidden shrink-0 lg:block">{aside}</div> : null}
      </div>
    </section>
  );
}
