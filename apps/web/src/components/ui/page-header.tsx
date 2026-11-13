import * as React from "react";
import { cn } from "./utils";

interface PageHeaderProps {
  /** Page icon (Lucide component) */
  icon?: React.ComponentType<{ className?: string }>;
  /** Primary title */
  title: string;
  /** Subtitle / description (text, or a meta line with badges) */
  description?: React.ReactNode;
  /** Action buttons on the right */
  actions?: React.ReactNode;
  // The three props below styled the old colored icon tile. The public-site style has no tile,
  // so they are accepted but unused; they go away once every page has moved to the new header.
  /** @deprecated no longer rendered */
  iconBg?: string;
  /** @deprecated no longer rendered */
  iconColor?: string;
  /** @deprecated no longer rendered */
  iconSize?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Page title in the public website's voice: the Fraunces display face, a calm muted lede,
 * actions on the right. The icon stays as a small quiet mark beside the title, not a tile.
 */
export function PageHeader({ icon: Icon, title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2.5 text-balance font-display text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-foreground">
          {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="min-w-0">{title}</span>
        </h1>
        {description && (
          <div className="mt-1.5 max-w-2xl text-pretty text-[14px] leading-relaxed text-muted-foreground">{description}</div>
        )}
      </div>

      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
