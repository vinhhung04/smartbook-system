import * as React from "react";
import { cn } from "./utils";
import {
  BookOpen,
  FileQuestion,
  SearchX,
  ShieldOff,
  AlertTriangle,
  Inbox,
  LucideIcon,
} from "lucide-react";

type EmptyStateVariant = "no-data" | "no-results" | "no-permission" | "error" | "inbox";

interface EmptyStateProps {
  /** Title message */
  title?: string;
  /** Detailed description */
  description?: string;
  /** Custom icon (overrides variant default) */
  icon?: LucideIcon;
  /** Variant for preset styling */
  variant?: EmptyStateVariant;
  /** Action button */
  action?: React.ReactNode;
  /** Optional extra content below description */
  footer?: React.ReactNode;
  className?: string;
}

const variantDefaults: Record<
  EmptyStateVariant,
  { icon: LucideIcon; title: string; description: string }
> = {
  "no-data": {
    icon: Inbox,
    title: "No data here yet",
    description: "Get started by creating your first item.",
  },
  "no-results": {
    icon: SearchX,
    title: "No results found",
    description: "Try adjusting your search or filters.",
  },
  "no-permission": {
    icon: ShieldOff,
    title: "Access denied",
    description: "You don't have permission to view this content.",
  },
  error: {
    icon: AlertTriangle,
    title: "Something went wrong",
    description: "An error occurred while loading this data.",
  },
  inbox: {
    icon: Inbox,
    title: "Your inbox is empty",
    description: "No notifications or messages at the moment.",
  },
};

export function EmptyState({
  title,
  description,
  icon: CustomIcon,
  variant = "no-data",
  action,
  footer,
  className,
}: EmptyStateProps) {
  const defaults = variantDefaults[variant];
  const Icon = CustomIcon || defaults.icon;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-12 px-4 text-center",
        className,
      )}
    >
      {/* Icon container */}
      <div className="relative">
        <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center border border-black/5">
          <Icon className="w-6 h-6 text-muted-foreground/60" />
        </div>
      </div>

      {/* Text content */}
      <div className="space-y-1 max-w-xs">
        <p className="text-[14px] font-semibold text-foreground">{title || defaults.title}</p>
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {description || defaults.description}
        </p>
      </div>

      {/* Action button */}
      {action && <div className="mt-1">{action}</div>}

      {/* Footer */}
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

/** Convenience wrapper for empty table rows */
export function EmptyTableRow({
  colSpan,
  message = "No data available",
}: {
  colSpan: number;
  message?: string;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center">
        <EmptyState
          variant="no-data"
          title={message}
          className="py-0"
        />
      </td>
    </tr>
  );
}
