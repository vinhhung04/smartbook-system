import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";

/**
 * Pieces shared by the four warehouse-operation screens (my tasks, my purchase requests,
 * staff tasks, my exception reports). They follow the dashboard's panel language
 * (dashboard/panel.tsx): 1px borders, no resting shadow, sentence-case 12px labels.
 */

export interface QueueTab<T extends string> {
  key: T;
  label: string;
  /** Omit when the API cannot give a real count for this view. */
  count?: number;
}

/**
 * Underline tabs that switch which slice of one list is shown. Arrow keys move between
 * tabs (WAI-ARIA tabs pattern); the list they control carries `id={panelId}`.
 */
export function QueueTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  panelId,
  loading,
  className,
}: {
  label: string;
  tabs: Array<QueueTab<T>>;
  value: T;
  onChange: (value: T) => void;
  panelId: string;
  loading?: boolean;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
        : event.key === "Home" ? 0
          : event.key === "End" ? last
            : null;
    if (next === null) return;
    event.preventDefault();
    refs.current[next]?.focus();
    onChange(tabs[next].key);
  };

  return (
    <div className={cn("overflow-x-auto border-b border-border [scrollbar-width:none]", className)}>
      <div role="tablist" aria-label={label} className="flex w-max min-w-full gap-1 px-3 sm:px-4">
        {tabs.map((tab, index) => {
          const active = tab.key === value;
          return (
            <button
              key={tab.key}
              ref={(node) => { refs.current[index] = node; }}
              type="button"
              role="tab"
              id={`${panelId}-tab-${tab.key}`}
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(tab.key)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "relative flex h-11 shrink-0 items-center gap-2 rounded-t-md px-2.5 text-[13px] transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
                "after:absolute after:inset-x-1.5 after:-bottom-px after:h-0.5 after:rounded-full after:transition-colors motion-reduce:after:transition-none",
                active ? "font-semibold text-foreground after:bg-primary" : "font-medium text-muted-foreground hover:text-foreground after:bg-transparent",
              )}
            >
              {tab.label}
              {tab.count !== undefined ? (
                <span
                  className={cn(
                    "min-w-5 rounded-md px-1.5 py-px text-center text-[12px] font-medium tabular-nums",
                    active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {loading ? "–" : tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "Hiển thị 11–20 trong 43 yêu cầu" plus numbered paging; real buttons so keyboards reach them. */
export function ListFooter({
  page,
  pageSize,
  total,
  noun,
  onPageChange,
  note,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  onPageChange: (page: number) => void;
  note?: ReactNode;
}) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const pageButton = "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-[13px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className="flex flex-col gap-2 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <p className="text-[12px] text-muted-foreground">
        Hiển thị <span className="tabular-nums text-foreground">{first}–{last}</span> trong <span className="tabular-nums text-foreground">{total}</span> {noun}
        {note ? <span className="block sm:inline"> · {note}</span> : null}
      </p>
      {totalPages > 1 ? (
        <nav aria-label="Phân trang" className="flex items-center gap-1">
          <button type="button" className={cn(pageButton, "hover:bg-muted")} onClick={() => onPageChange(page - 1)} disabled={page === 1} aria-label="Trang trước">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          {getPaginationRange(page, totalPages).map((item) => typeof item === "number" ? (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-current={item === page ? "page" : undefined}
              aria-label={`Trang ${item}`}
              className={cn(pageButton, item === page ? "border border-border bg-card font-semibold text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {item}
            </button>
          ) : (
            <span key={item} className="px-1 text-[13px] text-muted-foreground" aria-hidden="true">…</span>
          ))}
          <button type="button" className={cn(pageButton, "hover:bg-muted")} onClick={() => onPageChange(page + 1)} disabled={page === totalPages} aria-label="Trang sau">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </nav>
      ) : null}
    </div>
  );
}

/** A request/task/report number people read out and paste elsewhere: mono, with a copy button. */
export function RefCode({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Không sao chép được, hãy chọn và sao chép thủ công");
    }
  };
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <span className="truncate font-mono text-[12px] text-muted-foreground" title={value}>{value}</span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? `Đã sao chép ${value}` : `Sao chép ${value}`}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
      </button>
    </span>
  );
}

/** Label above the control, then a hint or the field's error (announced and linked by id). */
export function Field({
  id,
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-foreground">
        {label}
        {required ? <span className="text-red-600 dark:text-red-400" aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-[12px] text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] leading-5 text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Group of form fields with a heading; more space above than below. */
export function FormGroup({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-4 p-0">
          <span className="block text-[14px] font-semibold text-foreground">{title}</span>
          {description ? <span className="mt-0.5 block text-[12px] font-normal text-muted-foreground">{description}</span> : null}
        </legend>
        <div className="space-y-4">{children}</div>
      </fieldset>
    </div>
  );
}

/** List skeleton at the real row pitch, so nothing jumps when rows arrive. */
export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4 last:border-b-0 sm:px-5">
          <div className="flex-1 space-y-2">
            <span className="block h-4 w-2/3 max-w-[280px] animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <span className="block h-3 w-1/2 max-w-[200px] animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
          <span className="hidden h-8 w-24 animate-pulse rounded-md bg-muted motion-reduce:animate-none sm:block" />
        </div>
      ))}
    </div>
  );
}

/**
 * Slide-over that holds a create form beside the list it adds to: the list stays in
 * context on desktop, and on a phone the sheet takes the full width. Radix handles
 * focus trap, Escape and returning focus to the button that opened it.
 */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  footer,
  children,
  onEscapeKeyDown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  footer: ReactNode;
  children: ReactNode;
  /** Lets a field inside (an open autocomplete) keep Escape for itself. */
  onEscapeKeyDown?: (event: globalThis.KeyboardEvent) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" onEscapeKeyDown={onEscapeKeyDown} className="w-full gap-0 p-0 motion-reduce:animate-none sm:max-w-lg">
        <SheetHeader className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle className="text-[16px]">{title}</SheetTitle>
          {description ? <SheetDescription className="text-[13px]">{description}</SheetDescription> : null}
        </SheetHeader>
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">{children}</div>
          <div className="flex items-center justify-end gap-2 border-t border-border bg-card px-4 py-3 sm:px-5">{footer}</div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A short set of mutually exclusive choices shown all at once (WAI-ARIA radio group):
 * one tab stop, arrow keys move and select, the checked chip is the only filled one.
 */
export function ChoiceChips<T extends string>({
  labelledBy,
  options,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  labelledBy: string;
  options: Array<{ value: T; label: string }>;
  value: T | "";
  onChange: (value: T) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const checkedIndex = options.findIndex((option) => option.value === value);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !back) return;
    event.preventDefault();
    const next = (index + (forward ? 1 : -1) + options.length) % options.length;
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} aria-invalid={invalid || undefined} aria-describedby={describedBy} className="flex flex-wrap gap-2">
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (checkedIndex === -1 && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              checked
                ? "border-primary bg-primary/10 text-primary dark:bg-primary/15"
                : cn("bg-card text-muted-foreground hover:bg-muted hover:text-foreground", invalid ? "border-destructive/60" : "border-border"),
            )}
          >
            {checked ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
