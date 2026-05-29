import { AlertCircle, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { cn } from "./utils";

const PRIORITY_CONFIG: Record<string, { label: string; className: string; iconClass: string; Icon: typeof Minus }> = {
  LOW: {
    label: "Thấp",
    className: "bg-slate-50 text-slate-600 border-slate-200",
    iconClass: "text-slate-400",
    Icon: ArrowDown,
  },
  MEDIUM: {
    label: "Trung bình",
    className: "bg-blue-50 text-blue-700 border-blue-200",
    iconClass: "text-blue-400",
    Icon: Minus,
  },
  HIGH: {
    label: "Cao",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    iconClass: "text-amber-500",
    Icon: ArrowUp,
  },
  URGENT: {
    label: "Khẩn",
    className: "bg-red-50 text-red-700 border-red-200",
    iconClass: "text-red-500",
    Icon: AlertCircle,
  },
};

interface PriorityBadgeProps {
  priority: string;
  showIcon?: boolean;
  className?: string;
}

export function PriorityBadge({ priority, showIcon = true, className }: PriorityBadgeProps) {
  const config = PRIORITY_CONFIG[priority?.toUpperCase()] ?? PRIORITY_CONFIG.MEDIUM;
  const { Icon } = config;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-[3px] rounded-full text-[11px] border",
        config.className,
        className,
      )}
      style={{ fontWeight: 550 }}
    >
      {showIcon && <Icon className={cn("h-3 w-3", config.iconClass)} />}
      {config.label}
    </span>
  );
}
