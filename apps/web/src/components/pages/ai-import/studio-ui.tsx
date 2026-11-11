import type { ComponentType, ReactNode } from "react";
import { Check, Loader2, ScanText } from "lucide-react";
import type { OcrAvailability } from "@/lib/book-ocr";

// Shared building blocks of the cataloging studio. Indigo (primary) marks the
// action you are on, violet is reserved for AI suggestions, and every status
// pairs an icon with words so nothing depends on color alone.

export type StepState = "todo" | "active" | "done";
export interface StudioStep {
  label: string;
  hint: string;
  state: StepState;
}

export type SessionTone = "idle" | "busy" | "review" | "ready";

const SESSION_TONE: Record<SessionTone, string> = {
  idle: "border-border bg-muted/60 text-muted-foreground",
  busy: "border-primary/25 bg-primary/10 text-primary",
  review: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  ready: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
};

const OCR_STATUS: Record<OcrAvailability, { label: string; dot: string }> = {
  LOADING: { label: "Đang kiểm tra AI OCR", dot: "bg-muted-foreground/50" },
  AVAILABLE: { label: "AI OCR sẵn sàng", dot: "bg-emerald-500" },
  DISABLED: { label: "AI OCR đang tắt", dot: "bg-muted-foreground/50" },
  UNAVAILABLE: { label: "AI OCR không phản hồi", dot: "bg-amber-500" },
};

export function StudioHeader({ session, steps, ocrAvailability }: {
  session: { label: string; tone: SessionTone };
  steps: StudioStep[];
  ocrAvailability: OcrAvailability;
}) {
  return (
    <header data-reveal className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="text-[12px] font-medium text-primary">Cataloging studio</p>
          <h1 className="font-[family-name:var(--font-display)] text-[26px] font-medium leading-tight tracking-[-0.01em] text-foreground sm:text-[30px]">
            Nhập sách bằng AI
          </h1>
          <p className="max-w-[70ch] text-[13.5px] leading-relaxed text-muted-foreground">
            Tra ISBN hoặc chụp sách, đối chiếu các nguồn, rồi duyệt từng trường. AI chỉ đề xuất — sách chỉ được lưu khi bạn bấm Lưu.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2" aria-live="polite">
          <span className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium ${SESSION_TONE[session.tone]}`}>
            {session.tone === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            <span className="sr-only">Trạng thái phiên nhập: </span>{session.label}
          </span>
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[12px] text-muted-foreground">
            <ScanText className="h-3.5 w-3.5" aria-hidden="true" />
            <span className={`h-1.5 w-1.5 rounded-full ${OCR_STATUS[ocrAvailability].dot}`} aria-hidden="true" />
            {OCR_STATUS[ocrAvailability].label}
          </span>
        </div>
      </div>

      <ol aria-label="Các bước nhập sách" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((step, index) => (
          <li
            key={step.label}
            aria-current={step.state === "active" ? "step" : undefined}
            className={`relative flex min-w-0 items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors duration-200 ${
              step.state === "active" ? "border-primary/40 bg-card shadow-sm ring-1 ring-primary/10"
                : step.state === "done" ? "border-border bg-card/70" : "border-dashed border-border bg-transparent"
            }`}
          >
            <span className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
              step.state === "done" ? "bg-emerald-500 text-white" : step.state === "active" ? "bg-primary text-primary-foreground" : "border border-border text-muted-foreground"
            }`}>
              {step.state === "done" ? <Check className="h-3 w-3" aria-hidden="true" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-[13px] font-semibold leading-tight ${step.state === "todo" ? "text-muted-foreground" : "text-foreground"}`}>{step.label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{step.hint}</span>
              <span className="sr-only">{step.state === "done" ? " — đã xong" : step.state === "active" ? " — đang thực hiện" : " — chưa tới"}</span>
            </span>
          </li>
        ))}
      </ol>
    </header>
  );
}

/** A titled region of the studio; `step` ties it to the workflow strip above. */
export function StudioSection({ id, step, title, description, actions, children, className = "" }: {
  id: string;
  step?: number;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={`rounded-2xl border border-border bg-card ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          {step ? (
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[12px] font-semibold text-primary" aria-hidden="true">{step}</span>
          ) : null}
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-[15px] font-semibold text-foreground">{title}</h2>
            {description ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="px-4 py-4 sm:px-5 sm:py-5">{children}</div>
    </section>
  );
}

/** Icon + words status label (the shapes differ per state, so it is not color-only). */
export function StateLabel({ icon: Icon, tone, children, spin = false }: {
  icon: ComponentType<{ className?: string }>;
  tone: "neutral" | "busy" | "ok" | "warn" | "error" | "ai";
  children: ReactNode;
  spin?: boolean;
}) {
  const color = {
    neutral: "text-muted-foreground",
    busy: "text-primary",
    ok: "text-emerald-700 dark:text-emerald-400",
    warn: "text-amber-700 dark:text-amber-400",
    error: "text-red-700 dark:text-red-400",
    ai: "text-violet-700 dark:text-violet-300",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${color}`}>
      <Icon className={`h-3.5 w-3.5 shrink-0 ${spin ? "animate-spin" : ""}`} aria-hidden="true" />
      {children}
    </span>
  );
}

