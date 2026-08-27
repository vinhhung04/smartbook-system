import type { ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const TONE_CLASSES: Record<"indigo" | "violet" | "amber", { edge: string; chip: string; icon: string }> = {
  indigo: { edge: "bg-indigo-500", chip: "bg-indigo-50 dark:bg-indigo-500/10", icon: "text-indigo-600 dark:text-indigo-400" },
  violet: { edge: "bg-violet-500", chip: "bg-violet-50 dark:bg-violet-500/10", icon: "text-violet-600 dark:text-violet-400" },
  amber: { edge: "bg-amber-500", chip: "bg-amber-50 dark:bg-amber-500/10", icon: "text-amber-600 dark:text-amber-400" },
};

/**
 * One of the three always-visible "Kiểm duyệt catalog" checks. The colored left edge
 * is the same visual grammar as the AI-assisted fields in Hồ sơ catalog (book-info-tab.tsx)
 * — a colored edge means "this tells you what kind of thing you're looking at" — now
 * extended to the three verification categories (indigo/violet/amber) instead of
 * everything being the same amber accordion row.
 */
export function VerificationCategoryCard({
  tone,
  icon: Icon,
  title,
  description,
  pending,
  badge,
  expandable,
  open = false,
  onToggle,
  children,
}: {
  tone: "indigo" | "violet" | "amber";
  icon: LucideIcon;
  title: string;
  description: string;
  /** Colors the edge/icon chip and is typically what gates whether the card opens by default. */
  pending: boolean;
  badge?: ReactNode;
  /** false = a flat, quiet single-line row with no chevron (nothing to review, ever). */
  expandable: boolean;
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();
  const toneClasses = TONE_CLASSES[tone];
  const edgeClass = pending ? toneClasses.edge : "bg-border";
  const chipClass = pending ? toneClasses.chip : "bg-muted";
  const iconClass = pending ? toneClasses.icon : "text-muted-foreground";

  if (!expandable) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card">
        <div className={`absolute inset-y-0 left-0 w-[3px] ${edgeClass}`} aria-hidden="true" />
        <div className="flex items-center gap-3 px-4 py-3.5 pl-5">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${chipClass}`}>
            <Icon className={`h-4 w-4 ${iconClass}`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-foreground">{title}</p>
            <p className="text-[13px] text-muted-foreground">{children}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:shadow-none">
      <div className={`absolute inset-y-0 left-0 w-[3px] ${edgeClass}`} aria-hidden="true" />
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 pl-5 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
      >
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${chipClass}`}>
          <Icon className={`h-4 w-4 ${iconClass}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground">{title}</p>
          <p className="text-[13px] text-muted-foreground">{description}</p>
        </div>
        {badge}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}
          >
            <div className="border-t border-border/80 px-4 py-4 pl-5">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
