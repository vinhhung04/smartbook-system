import { AlertCircle, BookCheck, CheckCircle2, Info, Loader2, RotateCcw } from "lucide-react";

export interface SaveIssue {
  key: string;
  label: string;
  onGo: () => void;
}

/**
 * Persistent action bar of the import. `blockers` mirror exactly what handleSave
 * refuses (it re-checks them itself); `advisories` never block. Save is only
 * disabled where it was before (saving, unconfirmed catalog duplicate).
 */
export function StickyFooter({
  blockers,
  advisories,
  onReset,
  onSave,
  saving,
  saveDisabled,
}: {
  blockers: SaveIssue[];
  advisories: SaveIssue[];
  onReset: () => void;
  onSave: () => void;
  saving: boolean;
  saveDisabled: boolean;
}) {
  const headline = saving ? "Đang lưu sách vào catalog…"
    : blockers.length ? `Chưa thể lưu — còn ${blockers.length} việc bắt buộc`
    : advisories.length ? `Có thể lưu — ${advisories.length} điểm nên xem lại`
    : "Sẵn sàng lưu";
  const Icon = saving ? Loader2 : blockers.length ? AlertCircle : advisories.length ? Info : CheckCircle2;
  const firstIssue = saving ? null : blockers[0] ?? advisories[0] ?? null;
  const tone = blockers.length ? "text-red-700 dark:text-red-400" : advisories.length ? "text-amber-800 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400";

  return (
    <div className="sticky bottom-3 z-20 mt-5 sm:bottom-4">
      <div
        role="region"
        aria-label="Lưu sách"
        className="flex flex-col gap-2 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-[0_10px_30px_-8px_rgba(15,23,42,0.18)] backdrop-blur supports-[backdrop-filter]:bg-card/85 dark:shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1" aria-live="polite">
          {firstIssue ? (
            // Phones: one tap jumps to the first open issue (the chip list below is desktop-only).
            <button type="button" onClick={firstIssue.onGo} className={`flex min-h-8 cursor-pointer items-center gap-2 rounded-md text-left text-[13.5px] font-semibold focus-visible:outline-2 focus-visible:outline-ring sm:pointer-events-none ${tone}`}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {headline}
              <span className="text-[12px] font-medium underline underline-offset-2 sm:hidden">Xem</span>
            </button>
          ) : (
            <p className={`flex items-center gap-2 text-[13.5px] font-semibold ${saving ? "text-foreground" : tone}`}>
              <Icon className={`h-4 w-4 shrink-0 ${saving ? "animate-spin" : ""}`} aria-hidden="true" />
              {headline}
            </p>
          )}
        </div>
        <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
          <button
            type="button"
            onClick={onReset}
            disabled={saving}
            className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-card px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Đặt lại
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || saveDisabled}
            className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[13.5px] font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55 sm:flex-none"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <BookCheck className="h-4 w-4" aria-hidden="true" />}
            {saving ? "Đang lưu" : "Lưu sách"}
          </button>
        </div>
        </div>
          {blockers.length || advisories.length ? (
            <ul className="relative hidden flex-wrap gap-1.5 sm:flex">
              {blockers.map((issue) => (
                <li key={issue.key}>
                  <button type="button" onClick={issue.onGo} className="inline-flex min-h-8 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border border-red-200 bg-red-50 px-2.5 text-[12px] font-medium text-red-800 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                    <AlertCircle className="h-3 w-3" aria-hidden="true" /><span className="sr-only">Bắt buộc: </span>{issue.label}
                  </button>
                </li>
              ))}
              {advisories.map((issue) => (
                <li key={issue.key}>
                  <button type="button" onClick={issue.onGo} className="inline-flex min-h-8 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border border-border px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
                    <Info className="h-3 w-3" aria-hidden="true" /><span className="sr-only">Nên xem: </span>{issue.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
      </div>
    </div>
  );
}
