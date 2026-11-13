import * as React from "react";
import { cn } from "./utils";
import { AnimatedCounter } from "../motion-utils";

type StatCardVariant = "default" | "success" | "warning" | "danger" | "info" | "primary";

interface StatCardProps {
  /** Display label */
  label: string;
  /** Main value to display */
  value: string | number;
  /** Optional description or subtitle */
  hint?: React.ReactNode;
  /** Optional trend indicator */
  change?: string;
  /** Trend direction */
  trend?: "up" | "down" | "neutral";
  /** Optional Lucide icon component */
  icon?: React.ComponentType<{ className?: string }>;
  /** Icon color (defaults to the variant color) */
  iconColor?: string;
  /** Card variant for automatic styling */
  variant?: StatCardVariant;
  /** Animate numeric value with a count-up effect */
  animateValue?: boolean;
  /** Custom className */
  className?: string;
}

const variantConfigs: Record<StatCardVariant, { iconColor: string }> = {
  default: { iconColor: "text-muted-foreground" },
  success: { iconColor: "text-emerald-600 dark:text-emerald-400" },
  warning: { iconColor: "text-amber-600 dark:text-amber-400" },
  danger: { iconColor: "text-rose-600 dark:text-rose-400" },
  info: { iconColor: "text-sky-600 dark:text-sky-400" },
  primary: { iconColor: "text-primary" },
};

export function StatCard({
  label,
  value,
  hint,
  change,
  trend,
  icon: Icon,
  iconColor,
  variant = "default",
  animateValue = false,
  className,
}: StatCardProps) {
  const config = variantConfigs[variant];

  // Public-site figure: a plain bordered card, label first, the number set in Lora.
  return (
    <div className={cn("flex flex-col gap-2 rounded-2xl border border-border bg-card p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn("size-4 shrink-0", iconColor || config.iconColor)} aria-hidden="true" />}
      </div>

      <div className="flex items-end gap-2">
        {animateValue && typeof value === "number" ? (
          <AnimatedCounter value={value} className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground" />
        ) : (
          <span className="font-serif text-[28px] font-semibold leading-none tabular-nums text-foreground">
            {typeof value === "number" ? value.toLocaleString() : value}
          </span>
        )}
        {change && (
          <span
            className={cn(
              "mb-[2px] rounded-full px-2 py-0.5 text-[11px] font-medium",
              trend === "up" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400",
              trend === "down" && "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
              (trend === "neutral" || !trend) && "bg-muted text-muted-foreground",
            )}
          >
            {change}
          </span>
        )}
      </div>

      {hint && <p className="text-[12px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}
