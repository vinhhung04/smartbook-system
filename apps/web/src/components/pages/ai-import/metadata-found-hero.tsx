import { BadgeCheck, Clock, Database } from "lucide-react";
import type { LookupBookByIsbnResponse } from "@/services/ai";
import { StatusBadge } from "@/components/status-badge";
import { CoverPreview } from "./field";
import type { EditableBookForm } from "./types";
import { winningSourceName } from "./utils";

export function MetadataFoundHero({
  lookup,
  form,
  completeSignalCount,
}: {
  lookup: LookupBookByIsbnResponse;
  form: EditableBookForm;
  completeSignalCount: number;
}) {
  const quality = Math.round((lookup.metadataQualityScore || 0) * 100);
  const source = winningSourceName(lookup);
  const processingSeconds = lookup.processingTimeMs != null ? (lookup.processingTimeMs / 1000).toFixed(1) : null;

  return (
    <section
      className="mb-6 border-b border-border pb-6"
      aria-labelledby="metadata-found-title"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="h-36 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted shadow-[0_4px_16px_rgba(15,23,42,0.08)] dark:shadow-none">
          <CoverPreview src={form.thumbnail} alt={form.title ? `Bìa sách ${form.title}` : "Ảnh bìa sách"} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-success"><BadgeCheck className="h-4 w-4" aria-hidden="true" />Đã tìm thấy metadata</span>
            <StatusBadge label={`${completeSignalCount}/4 mục cốt lõi`} variant={completeSignalCount === 4 ? "success" : "warning"} />
          </div>
          <h2 id="metadata-found-title" className="mt-1 text-[22px] font-semibold tracking-tight text-foreground sm:text-2xl">{form.title || "Chưa có tên sách"}</h2>
          <p className="mt-1.5 line-clamp-2 text-[14px] leading-6 text-muted-foreground">{[form.authorsText, form.publisher, form.publishedDate].filter(Boolean).join(" · ") || "Kiểm tra các trường thông tin trước khi xác nhận."}</p>
        </div>
        <div className="w-full shrink-0 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.06] p-3.5 sm:w-32">
          <p className="text-[11px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-400">Độ tin cậy</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <p className="text-[26px] font-semibold tabular-nums leading-none text-foreground">{quality}%</p>
            <span className="pb-0.5 text-[11px] text-muted-foreground">metadata</span>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-cyan-500/15" aria-hidden="true">
            <div className="h-full rounded-full bg-cyan-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.min(100, Math.max(0, quality))}%` }} />
          </div>
        </div>
      </div>

      {(source || processingSeconds) ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          {source ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5">
              <Database className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
              Nguồn xác nhận: <span className="font-semibold text-foreground">{source}</span>
            </span>
          ) : null}
          {processingSeconds ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5">
              <Clock className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
              Thời gian tra cứu: <span className="font-semibold text-foreground">{processingSeconds}s</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
