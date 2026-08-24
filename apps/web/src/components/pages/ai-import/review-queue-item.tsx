import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, ChevronDown } from "lucide-react";

export function ReviewQueueItem({
  id,
  title,
  description,
  status,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  description: string;
  status: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <section className="border-b border-border last:border-b-0" aria-labelledby={`${id}-title`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-content`}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 py-3 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-title`} className="text-[14px] font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
        </div>
        {status}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={`${id}-content`}
            initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}
            className="pb-4"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

export function ReviewDisclosure({
  id,
  title,
  description,
  badge,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  description: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <section className="group overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-shadow hover:shadow-[0_4px_16px_rgba(15,23,42,0.05)] dark:shadow-none">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
        </div>
        {badge}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            id={id}
            initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}
            className="border-t border-border/80 bg-muted/[0.12] px-4 py-4"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
