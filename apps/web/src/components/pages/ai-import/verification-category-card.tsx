import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

/**
 * One review category in the review rail. Pending categories carry an amber
 * "needs action" mark (icon + words), clear ones a green check, so the state
 * reads without color. `id` lets the save bar and the profile jump here.
 */
export function VerificationCategoryCard({
  id,
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
  id?: string;
  icon: LucideIcon;
  title: string;
  description: string;
  pending: boolean;
  badge?: ReactNode;
  /** false = a flat, quiet single-line row with no chevron (nothing to review, ever). */
  expandable: boolean;
  open?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();
  const contentId = id ? `${id}-content` : undefined;
  const mark = pending
    ? <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-amber-800 dark:text-amber-300"><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />Cần xử lý</span>
    : <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Ổn</span>;

  const head = (
    <>
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${pending ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13.5px] font-semibold text-foreground">{title}</span>
          {mark}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{description}</span>
      </span>
    </>
  );

  if (!expandable) {
    return (
      <div id={id} className="scroll-mt-24 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 px-3.5 py-3">{head}</div>
        <p className="border-t border-border px-3.5 py-2 text-[12px] text-muted-foreground">{children}</p>
      </div>
    );
  }

  return (
    <div id={id} className={`scroll-mt-24 overflow-hidden rounded-xl border bg-card ${pending ? "border-amber-200 dark:border-amber-500/25" : "border-border"}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        {head}
        {badge}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={contentId}
            initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}
          >
            <div className="border-t border-border px-3.5 py-4">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
