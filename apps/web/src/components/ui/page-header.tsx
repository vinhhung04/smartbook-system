import * as React from "react";
import { cn } from "./utils";

interface PageHeaderProps {
  /** Page icon (Lucide component) */
  icon?: React.ComponentType<{ className?: string }>;
  /** Primary title */
  title: string;
  /** Subtitle / description */
  description?: string;
  /** Breadcrumb trail */
  breadcrumbs?: Array<{ label: string; href?: string }>;
  /** Action buttons on the right */
  actions?: React.ReactNode;
  /** Icon background color classes */
  iconBg?: string;
  /** Icon foreground color classes */
  iconColor?: string;
  /** Icon container size */
  iconSize?: "sm" | "md" | "lg";
  className?: string;
}

const iconSizeClasses = {
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-12 h-12",
};

const iconInnerSizeClasses = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
};

export function PageHeader({
  icon: Icon,
  title,
  description,
  breadcrumbs,
  actions,
  iconBg = "bg-indigo-100",
  iconColor = "text-indigo-600",
  iconSize = "md",
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="flex items-start gap-3">
        {Icon && (
          <div
            className={cn(
              "flex shrink-0 items-center justify-center rounded-xl border border-black/5",
              iconSizeClasses[iconSize],
              iconBg,
            )}
          >
            <Icon className={cn(iconInnerSizeClasses[iconSize], iconColor)} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          {/* Breadcrumbs */}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav className="flex items-center gap-1.5 text-[12px] text-muted-foreground mb-1">
              {breadcrumbs.map((crumb, i) => (
                <React.Fragment key={i}>
                  {i > 0 && <span className="text-slate-300">/</span>}
                  {crumb.href ? (
                    <a href={crumb.href} className="hover:text-foreground transition-colors">
                      {crumb.label}
                    </a>
                  ) : (
                    <span className={i === breadcrumbs.length - 1 ? "text-foreground font-medium" : ""}>
                      {crumb.label}
                    </span>
                  )}
                </React.Fragment>
              ))}
            </nav>
          )}
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description && (
            <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
          )}
        </div>
      </div>

      {/* Right-side actions */}
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
