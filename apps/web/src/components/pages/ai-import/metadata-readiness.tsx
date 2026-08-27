import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ReviewSignalData } from "./types";

export function ReviewSignal({
  label,
  detail,
  complete,
}: {
  label: string;
  detail: string;
  complete: boolean;
}) {
  const Icon = complete ? CheckCircle2 : AlertTriangle;
  return (
    <div className="flex min-h-[72px] items-start gap-2.5 rounded-lg border border-border/80 bg-card px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${complete ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">{label}<span className={`text-[10px] font-medium ${complete ? "text-success" : "text-warning"}`}>{complete ? "Sẵn sàng" : "Cần xem"}</span></div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export function MetadataReadiness({
  signals,
  onFocusField,
}: {
  signals: ReviewSignalData[];
  onFocusField: (fieldId: string) => void;
}) {
  const incomplete = signals.filter((signal) => !signal.complete);
  if (incomplete.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-success/25 bg-success/5 px-4 py-3.5 text-[13px] text-success">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">Metadata cốt lõi đã sẵn sàng để lưu.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-warning">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Cần bổ sung trước khi lưu
      </div>
      <div className="flex flex-wrap gap-1.5">
        {incomplete.map((signal) => (
          <button
            key={signal.label}
            type="button"
            onClick={() => onFocusField(signal.fieldId)}
            className="inline-flex cursor-pointer items-center rounded-full border border-warning/30 bg-card px-2.5 py-1 text-[12px] font-medium text-warning transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/30"
          >
            {signal.label}
          </button>
        ))}
      </div>
    </div>
  );
}
