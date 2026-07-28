import * as React from "react";
import { cn } from "./utils";

interface SectionCardProps {
  /** Card title */
  title?: string;
  /** Card subtitle / description */
  subtitle?: string;
  /** Content */
  children: React.ReactNode;
  /** Actions in the header (right side) */
  actions?: React.ReactNode;
  /** Optional icon in header */
  icon?: React.ComponentType<{ className?: string }>;
  /** Custom header className */
  headerClassName?: string;
  /** Custom className */
  className?: string;
  /** No padding in content area */
  noPadding?: boolean;
}

export function SectionCard({
  title,
  subtitle,
  children,
  actions,
  icon: Icon,
  headerClassName,
  className,
  noPadding,
}: SectionCardProps) {
  const hasHeader = title || actions;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none transition-shadow duration-200 hover:shadow-[0_2px_4px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.06)] dark:hover:shadow-none",
        className,
      )}
    >
      {/* Card Header */}
      {hasHeader && (
        <div
          className={cn(
            "flex items-center justify-between gap-4 px-5 py-4",
            headerClassName,
          )}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <div className="flex shrink-0 w-7 h-7 rounded-lg bg-muted items-center justify-center">
                <Icon className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
              )}
              {subtitle && (
                <p className="text-[12px] text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
      )}

      {/* Card Content */}
      <div className={cn(!noPadding && "px-5 pb-5", hasHeader && "pt-0")}>
        {children}
      </div>
    </div>
  );
}
