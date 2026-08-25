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
      <div className="flex gap-4 sm:items-center">
        <div className="h-24 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
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
        <div className="hidden w-28 shrink-0 sm:block">
          <p className="text-[12px] text-muted-foreground">Độ tin cậy</p>
          <div className="mt-1 flex items-end justify-between gap-2">
            <p className="text-[20px] font-semibold tabular-nums text-foreground">{quality}%</p>
            <span className="pb-0.5 text-[11px] text-muted-foreground">metadata</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-cyan-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.min(100, Math.max(0, quality))}%` }} />
          </div>
        </div>
      </div>

      {(source || processingSeconds) ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          {source ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1">
              <Database className="h-3.5 w-3.5 text-cyan-500" aria-hidden="true" />
              Nguồn xác nhận: <span className="font-medium text-foreground">{source}</span>
            </span>
          ) : null}
          {processingSeconds ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-1">
              <Clock className="h-3.5 w-3.5 text-cyan-500" aria-hidden="true" />
              Thời gian tra cứu: <span className="font-medium text-foreground">{processingSeconds}s</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
