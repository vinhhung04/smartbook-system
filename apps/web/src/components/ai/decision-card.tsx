import { useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronDown, Info, ShieldCheck } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/components/ui/utils";
import type { Tone } from "@/lib/ai-decision";

// Shared layout for AI decision-support surfaces:
//   Decision -> status/risk -> evidence -> impact -> details -> actions.
// The card frames every AI output as a *proposal* that a person accepts,
// adjusts or rejects — it never says the system decided anything.

export function AIRecommendationNotice({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Đề xuất dựa trên dữ liệu hiện có · Bạn là người quyết định cuối cùng
    </p>
  );
}

interface AIDecisionCardProps {
  /** Short category line above the title, e.g. "Đề xuất nhập bổ sung". */
  eyebrow: string;
  icon?: ReactNode;
  /** The decision being proposed, readable in a few seconds. */
  title: ReactNode;
  /** Key figures shown right under the title. */
  facts?: Array<{ label: string; value: ReactNode }>;
  /** Status / priority badges. */
  badges?: ReactNode;
  showNotice?: boolean;
  children?: ReactNode;
  /** Actions row — always last. */
  footer?: ReactNode;
  className?: string;
  "aria-label"?: string;
}

export function AIDecisionCard({
  eyebrow,
  icon,
  title,
  facts,
  badges,
  showNotice = true,
  children,
  footer,
  className,
  "aria-label": ariaLabel,
}: AIDecisionCardProps) {
  return (
    <section
      aria-label={ariaLabel}
      className={cn("@container rounded-xl border border-border bg-card text-foreground", className)}
    >
      <div className="space-y-3 p-4">
        <header className="space-y-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {icon}
            {eyebrow}
          </p>
          <h3 className="text-[15px] font-semibold leading-snug text-foreground">{title}</h3>
          {facts && facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-2 @md:grid-cols-4">
              {facts.map((fact) => (
                <div key={fact.label} className="rounded-lg border border-border bg-muted/40 px-2.5 py-2">
                  <dt className="text-[11px] text-muted-foreground">{fact.label}</dt>
                  <dd className="text-[15px] font-semibold leading-tight text-foreground">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
          {showNotice && <AIRecommendationNotice />}
        </header>
        {children}
      </div>
      {footer && <div className="border-t border-border px-4 py-3">{footer}</div>}
    </section>
  );
}

interface DecisionSectionProps {
  title: string;
  children: ReactNode;
  /** Render as a disclosure (collapsed by default) instead of always open. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Extra text next to the disclosure title, e.g. an item count. */
  meta?: string;
}

export function DecisionSection({ title, children, collapsible = false, defaultOpen = false, meta }: DecisionSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (!collapsible) {
    return (
      <div className="space-y-1.5 border-t border-border pt-3">
        <p className="text-[12px] font-semibold text-foreground">{title}</p>
        {children}
      </div>
    );
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t border-border pt-2">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md py-1 text-left text-[12px] font-semibold text-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50">
        <span>
          {title}
          {meta && <span className="ml-1.5 font-normal text-muted-foreground">{meta}</span>}
        </span>
        <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          {open ? "Thu gọn" : "Mở"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
  );
}

const EVIDENCE_ICON: Record<Tone, ReactNode> = {
  danger: <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />,
  warning: <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />,
  success: <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />,
  info: <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />,
  neutral: <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />,
};

/** Bulleted facts. Each tone also has its own icon shape, so meaning never relies on color alone. */
export function EvidenceList({ items }: { items: Array<{ text: ReactNode; tone?: Tone }> }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px] leading-snug text-foreground">
          {EVIDENCE_ICON[item.tone ?? "neutral"]}
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Amber review callout (warnings the backend attached to the proposal). */
export function DecisionWarnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div role="note" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5 text-[12px] leading-snug">
        <p className="font-semibold">Cần xem xét</p>
        {items.map((w, i) => <p key={i}>{w}</p>)}
      </div>
    </div>
  );
}
