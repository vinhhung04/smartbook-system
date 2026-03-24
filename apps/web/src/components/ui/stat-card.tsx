import * as React from "react";
import { motion } from "motion/react";
import { cn } from "./utils";

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
  /** Icon container background color */
  iconBg?: string;
  /** Icon color */
  iconColor?: string;
  /** Card accent color (top border gradient) */
  accentBorder?: string;
  /** Card variant for automatic styling */
  variant?: StatCardVariant;
  /** Custom className */
  className?: string;
}

const variantConfigs: Record<
  StatCardVariant,
  { iconBg: string; iconColor: string; accentBorder: string; tintFrom: string; tintTo: string }
> = {
  default: {
    iconBg: "bg-indigo-100",
    iconColor: "text-indigo-600",
    accentBorder: "from-indigo-500 to-blue-500",
    tintFrom: "from-indigo-50/60",
    tintTo: "to-indigo-50/20",
  },
  success: {
    iconBg: "bg-emerald-100",
    iconColor: "text-emerald-600",
    accentBorder: "from-emerald-500 to-teal-500",
    tintFrom: "from-emerald-50/60",
    tintTo: "to-emerald-50/20",
  },
  warning: {
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
    accentBorder: "from-amber-500 to-orange-500",
    tintFrom: "from-amber-50/60",
    tintTo: "to-amber-50/20",
  },
  danger: {
    iconBg: "bg-rose-100",
    iconColor: "text-rose-600",
    accentBorder: "from-rose-500 to-red-500",
    tintFrom: "from-rose-50/60",
    tintTo: "to-rose-50/20",
  },
  info: {
    iconBg: "bg-sky-100",
    iconColor: "text-sky-600",
    accentBorder: "from-sky-500 to-cyan-500",
    tintFrom: "from-sky-50/60",
    tintTo: "to-sky-50/20",
  },
  primary: {
    iconBg: "bg-indigo-100",
    iconColor: "text-indigo-600",
    accentBorder: "from-violet-500 to-purple-500",
    tintFrom: "from-violet-50/60",
    tintTo: "to-violet-50/20",
  },
};

export function StatCard({
  label,
  value,
  hint,
  change,
  trend,
  icon: Icon,
  iconBg,
  iconColor,
  accentBorder,
  variant = "default",
  className,
}: StatCardProps) {
  const config = variantConfigs[variant];

  return (
    <motion.div
      whileHover={{ y: -2, boxShadow: "0 8px 24px -4px rgba(0,0,0,0.08)" }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className={cn(
        "relative overflow-hidden rounded-xl border border-black/5 bg-card p-5 flex flex-col gap-3 cursor-default",
        className,
      )}
    >
      {/* Accent top border */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-[3px] rounded-t-xl bg-gradient-to-r",
          accentBorder || config.accentBorder,
        )}
      />

      {/* Tinted background */}
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-br opacity-60 pointer-events-none",
          config.tintFrom,
          config.tintTo,
        )}
      />

      {/* Header row: label + icon */}
      <div className="flex items-center justify-between relative">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", iconBg || config.iconBg)}>
            <Icon className={cn("w-[18px] h-[18px]", iconColor || config.iconColor)} />
          </div>
        )}
      </div>

      {/* Value + trend */}
      <div className="flex items-end gap-2 relative">
        <span className="text-[30px] font-bold tracking-tight text-foreground" style={{ lineHeight: 1 }}>
          {typeof value === "number" ? value.toLocaleString() : value}
        </span>
        {change && (
          <span
            className={cn(
              "mb-[4px] rounded-full px-2 py-0.5 text-[11px] font-medium",
              trend === "up" && "bg-emerald-50 text-emerald-700",
              trend === "down" && "bg-red-50 text-red-600",
              trend === "neutral" && "bg-slate-50 text-slate-500",
              !trend && "bg-slate-50 text-slate-500",
            )}
          >
            {change}
          </span>
        )}
      </div>

      {/* Hint text */}
      {hint && (
        <p className="text-[12px] text-muted-foreground leading-relaxed">{hint}</p>
      )}
    </motion.div>
  );
}
