import { AlertTriangle, BadgeCheck, CheckCircle2, Circle, ImageIcon, PencilLine, ScanText } from "lucide-react";
import type { LookupBookByIsbnResponse } from "@/services/ai";
import { CoverPreview } from "./field";
import type { EditableBookForm, ReviewSignalData } from "./types";
import { fieldLabel, normalizeIsbnInput, winningSourceName } from "./utils";

// Mirrors the backend's critical/high-value fields (isbn_coverage.FIELD_TIERS); supporting fields are not flagged here.
const HIGH_VALUE_TIER: Record<string, string> = {
  title: "critical", authors: "critical", publisher: "high", publishedDate: "high", description: "high", pageCount: "high",
};

/**
 * The book being imported, at a glance: cover, identity, where the data came
 * from, and the four core fields. The core-field count is a completeness check,
 * not an accuracy score, and it says nothing about pending review items.
 */
export function BookProfileAside({
  lookup,
  form,
  signals,
  reviewIssueCount,
  onThumbnailChange,
  onFocusField,
}: {
  lookup: LookupBookByIsbnResponse;
  form: EditableBookForm;
  signals: ReviewSignalData[];
  reviewIssueCount: number;
  onThumbnailChange: (value: string) => void;
  onFocusField: (fieldId: string) => void;
}) {
  const completeCount = signals.filter((signal) => signal.complete).length;
  const quality = Math.min(100, Math.max(0, Math.round((lookup.metadataQualityScore || 0) * 100)));
  const source = winningSourceName(lookup);
  const processingSeconds = lookup.processingTimeMs != null ? (lookup.processingTimeMs / 1000).toFixed(1) : null;
  const fromPhotos = lookup.reason === "OCR_WITHOUT_PROVIDER_RECORD" || lookup.reason === "OCR_LOOKUP_MISMATCH";
  const gapLabels = lookup.found && lookup.needsEnrichment
    ? [...(lookup.missingFields || []), ...(lookup.lowConfidenceFields || [])]
        .filter((field, index, all) => all.indexOf(field) === index)
        .filter((field) => lookup.fieldStatus?.[field] && ["critical", "high"].includes(HIGH_VALUE_TIER[field] || ""))
        .map(fieldLabel)
    : [];
  const byline = [form.authorsText, form.publisher, form.publishedDate].filter((part) => part.trim()).join(" · ");
  const isbn = normalizeIsbnInput(form.isbn || form.isbn13 || form.isbn10);

  return (
    <section aria-labelledby="book-profile-title" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-4 sm:grid-cols-[96px_minmax(0,1fr)]">
        <div className="aspect-[2/3] w-full overflow-hidden rounded-md border border-border/70 bg-muted shadow-[0_8px_20px_-10px_rgba(15,23,42,0.35)] dark:shadow-[0_8px_20px_-10px_rgba(0,0,0,0.7)]">
          <CoverPreview key={form.thumbnail} src={form.thumbnail} alt={form.title ? `Bìa sách ${form.title}` : "Ảnh bìa sách"} />
        </div>

        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            {lookup.found ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Có metadata từ nguồn tra cứu
              </span>
            ) : fromPhotos ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-sky-700 dark:text-sky-300">
                <ScanText className="h-3.5 w-3.5" aria-hidden="true" /> Chỉ có dữ liệu đọc từ ảnh
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                <PencilLine className="h-3.5 w-3.5" aria-hidden="true" /> Nhập tay
              </span>
            )}
            {isbn ? <span className="font-mono tabular-nums text-muted-foreground">ISBN {isbn}</span> : null}
          </p>
          <h2
            id="book-profile-title"
            className={`mt-1 text-balance font-[family-name:var(--font-display)] text-[20px] font-medium leading-snug sm:text-[22px] ${form.title.trim() ? "text-foreground" : "text-muted-foreground"}`}
          >
            {form.title.trim() || "Chưa có tên sách"}
          </h2>
          {form.subtitle.trim() ? <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{form.subtitle}</p> : null}
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{byline || "Tác giả, nhà xuất bản và năm sẽ hiện ở đây."}</p>

          {(lookup.found || source || processingSeconds) ? (
            <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
              {lookup.found ? (
                <div className="flex gap-1.5" title="Điểm hệ thống tra cứu tự chấm cho độ đầy đủ/nhất quán của metadata — không phải xác suất dữ liệu đúng.">
                  <dt className="text-muted-foreground">Điểm chất lượng nguồn</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{quality}/100</dd>
                </div>
              ) : null}
              {source ? (
                <div className="flex gap-1.5"><dt className="text-muted-foreground">Nguồn chính</dt><dd className="font-medium text-foreground">{source}</dd></div>
              ) : null}
              {processingSeconds ? (
                <div className="flex gap-1.5"><dt className="text-muted-foreground">Tra cứu</dt><dd className="tabular-nums text-foreground">{processingSeconds}s</dd></div>
              ) : null}
            </dl>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[12px] text-muted-foreground">
            Trường cốt lõi <span className="font-semibold tabular-nums text-foreground">{completeCount}/{signals.length}</span>
            {reviewIssueCount ? <> · <span className="text-amber-800 dark:text-amber-300">{reviewIssueCount} mục kiểm duyệt chưa xong</span></> : null}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {signals.map((signal) => (
              <li key={signal.fieldId}>
                <button
                  type="button"
                  onClick={() => onFocusField(signal.fieldId)}
                  title={signal.detail}
                  className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
                    signal.complete ? "border-border text-foreground hover:bg-muted" : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                  }`}
                >
                  {signal.complete
                    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    : <Circle className="h-3.5 w-3.5" aria-hidden="true" />}
                  {signal.label}
                  <span className="sr-only">{signal.complete ? " — đã có" : ` — ${signal.detail}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="w-full lg:max-w-[280px]">
          <label htmlFor="thumbnail" className="mb-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" /> URL ảnh bìa
          </label>
          <input
            id="thumbnail"
            value={form.thumbnail}
            onChange={(event) => onThumbnailChange(event.target.value)}
            placeholder="https://…"
            className="h-9 w-full rounded-lg border border-border bg-input-background px-3 text-[13px] text-foreground outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
          />
        </div>
      </div>

      {gapLabels.length > 0 ? (
        <p className="mt-3 flex items-start gap-2 text-[12px] leading-5 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Nguồn thiếu hoặc chưa chắc: {gapLabels.join(", ")}</span>
        </p>
      ) : null}
    </section>
  );
}
