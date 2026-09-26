import { AlertTriangle, BadgeCheck, CheckCircle2, ChevronRight, Circle, PencilLine } from "lucide-react";
import type { LookupBookByIsbnResponse } from "@/services/ai";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CoverPreview } from "./field";
import type { EditableBookForm, ReviewSignalData } from "./types";
import { fieldLabel, winningSourceName } from "./utils";

// Mirrors the backend's critical/high-value fields (isbn_coverage.FIELD_TIERS); supporting fields are not flagged here.
const HIGH_VALUE_TIER: Record<string, string> = {
  title: "critical", authors: "critical", publisher: "high", publishedDate: "high", description: "high", pageCount: "high",
};

export function BookProfileAside({
  lookup,
  form,
  signals,
  onThumbnailChange,
  onFocusField,
}: {
  lookup: LookupBookByIsbnResponse;
  form: EditableBookForm;
  signals: ReviewSignalData[];
  onThumbnailChange: (value: string) => void;
  onFocusField: (fieldId: string) => void;
}) {
  const completeCount = signals.filter((signal) => signal.complete).length;
  const allReady = completeCount === signals.length;
  const quality = Math.min(100, Math.max(0, Math.round((lookup.metadataQualityScore || 0) * 100)));
  const source = winningSourceName(lookup);
  const processingSeconds = lookup.processingTimeMs != null ? (lookup.processingTimeMs / 1000).toFixed(1) : null;
  const gapLabels = lookup.found && lookup.needsEnrichment
    ? [...(lookup.missingFields || []), ...(lookup.lowConfidenceFields || [])]
        .filter((field, index, all) => all.indexOf(field) === index)
        .filter((field) => lookup.fieldStatus?.[field] && ["critical", "high"].includes(HIGH_VALUE_TIER[field] || ""))
        .map(fieldLabel)
    : [];
  const byline = [form.authorsText, form.publisher, form.publishedDate].filter((part) => part.trim()).join(" · ");

  return (
    <aside aria-labelledby="book-profile-title" className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:-mx-2 lg:self-start lg:overflow-x-hidden lg:overflow-y-auto lg:px-2 lg:pb-24 lg:[scrollbar-width:thin]">
      <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-4 gap-y-4 sm:grid-cols-[140px_minmax(0,1fr)] lg:grid-cols-1">
        <div className="lg:w-[152px]">
          <div className="aspect-[2/3] w-full overflow-hidden rounded-md border border-border/70 bg-muted shadow-[0_10px_24px_-10px_rgba(15,23,42,0.35)] dark:shadow-[0_10px_24px_-10px_rgba(0,0,0,0.7)]">
            <CoverPreview key={form.thumbnail} src={form.thumbnail} alt={form.title ? `Bìa sách ${form.title}` : "Ảnh bìa sách"} />
          </div>
        </div>

        <div className="min-w-0">
          {lookup.found ? (
            <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Đã tìm thấy metadata
            </p>
          ) : (
            <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-warning">
              <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
              Nhập tay
            </p>
          )}
          <h2
            id="book-profile-title"
            className={`mt-1 text-balance text-[19px] font-semibold leading-snug tracking-tight ${form.title.trim() ? "text-foreground" : "text-muted-foreground"}`}
          >
            {form.title.trim() || "Chưa có tên sách"}
          </h2>
          {form.subtitle.trim() ? <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{form.subtitle}</p> : null}
          <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{byline || "Tác giả, nhà xuất bản và năm sẽ hiện ở đây."}</p>

          {lookup.found ? (
            <div className="mt-4">
              <div className="flex items-baseline justify-between text-[12px]">
                <span className="text-muted-foreground">Độ tin cậy metadata</span>
                <span className="font-semibold tabular-nums text-foreground">{quality}%</span>
              </div>
              <div
                className="mt-1.5 h-1 overflow-hidden rounded-full bg-cyan-500/15"
                role="meter"
                aria-label="Độ tin cậy metadata"
                aria-valuenow={quality}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-full rounded-full bg-cyan-500 transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${quality}%` }} />
              </div>
            </div>
          ) : null}

          {(source || processingSeconds) ? (
            <dl className="mt-3 space-y-1 text-[12px]">
              {source ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Nguồn xác nhận</dt>
                  <dd className="truncate font-medium text-foreground">{source}</dd>
                </div>
              ) : null}
              {processingSeconds ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Thời gian tra cứu</dt>
                  <dd className="font-medium tabular-nums text-foreground">{processingSeconds}s</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>

        <div className="col-span-2 lg:col-span-1">
          <Label htmlFor="thumbnail" className="mb-1.5 block text-[12px] font-medium text-muted-foreground">URL ảnh bìa</Label>
          <Input
            id="thumbnail"
            value={form.thumbnail}
            onChange={(event) => onThumbnailChange(event.target.value)}
            placeholder="https://…"
            className="h-9 border-border/80 bg-muted/[0.12] text-[13px] shadow-none focus-visible:bg-card"
          />
        </div>

        <div className="col-span-2 border-t border-border pt-4 lg:col-span-1">
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-foreground">Trường cốt lõi</h3>
            <span className={`text-[12px] font-semibold tabular-nums ${allReady ? "text-success" : "text-warning"}`}>
              {completeCount}/{signals.length}
            </span>
          </div>
          <ul className="mt-2 -mx-2">
            {signals.map((signal) => (
              <li key={signal.fieldId}>
                <button
                  type="button"
                  onClick={() => onFocusField(signal.fieldId)}
                  className="group flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  {signal.complete ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-foreground">
                      {signal.label}
                      <span className="sr-only">{signal.complete ? " — đã đủ" : " — cần bổ sung"}</span>
                    </span>
                    {signal.complete ? null : <span className="mt-0.5 block text-[12px] leading-4 text-muted-foreground">{signal.detail}</span>}
                  </span>
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>

          {gapLabels.length > 0 ? (
            <p className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Nguồn thiếu hoặc chưa chắc: {gapLabels.join(", ")}</span>
            </p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
