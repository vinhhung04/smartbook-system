import { useRef, type ReactNode } from "react";
import { BadgeCheck, Camera, ChevronDown, ExternalLink, Info, PencilLine, SearchX } from "lucide-react";
import { EASE_OUT, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import type { IsbnLookupSource, LookupBookByIsbnResponse } from "@/services/ai";
import {
  QUERY_LABELS, SOURCE_KIND_META, SOURCE_STATUS_META, TONE_CHIP, VERIFICATION_LABELS, formatDuration, publicError, reasonLabel,
  safeHttpUrl, sourceKind, summarizeSources, type SourceStatus, type SourceTileData,
} from "./source-meta";
import { SourceTile } from "./source-tile";
import { SOURCE_LABELS } from "./utils";

const NOT_QUERIED: SourceStatus[] = ["DISABLED", "SKIPPED"];
const PROBLEM: SourceStatus[] = ["MISMATCH", "DIFFERENT_EDITION", "TIMEOUT", "PAUSED", "ERROR"];

export function StatusChip({ status }: { status: SourceStatus }) {
  const meta = SOURCE_STATUS_META[status];
  return (
    <span title={meta.hint} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[12px] font-medium ${TONE_CHIP[meta.tone]}`}>
      <meta.icon className="h-3.5 w-3.5" aria-hidden="true" />{meta.label}
    </span>
  );
}

const toTile = (source: IsbnLookupSource): SourceTileData => ({
  source: source.name, state: "done", status: source.status, round: source.round, query: source.query, durationMs: source.durationMs,
  attempts: source.attempts, verification: source.verification, matchConfidence: source.matchConfidence, reason: source.reason, error: source.error,
});

/** A source that returned data: the one place with full detail and a link. */
function FoundSource({ source, identifying }: { source: IsbnLookupSource; identifying: boolean }) {
  const kind = SOURCE_KIND_META[sourceKind(source.name)];
  const url = safeHttpUrl(source.sourceUrl);
  const how = [
    source.round ? `Vòng ${source.round}` : null,
    source.query && source.query !== "-" ? QUERY_LABELS[source.query]?.toLowerCase() : null,
  ].filter(Boolean).join(", ");
  return (
    <li className="flex items-start gap-3 px-4 py-3" data-testid={`source-row-${source.name}`}>
      <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${identifying ? "bg-emerald-600 text-white dark:bg-emerald-500" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"}`}>
        <kind.icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[14px] font-semibold text-foreground">{SOURCE_LABELS[source.name] || source.name}</p>
          <StatusChip status={source.status} />
          {identifying ? <span className="text-[12px] font-medium text-emerald-700 dark:text-emerald-400">Xác định sách</span> : null}
        </div>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">
          {how}
          {source.verification ? <>{how ? ", " : ""}<span className="text-foreground">{VERIFICATION_LABELS[source.verification]}</span>{source.verification === "TITLE_MATCH" && source.matchConfidence ? ` ${Math.round(source.matchConfidence * 100)}%` : ""}</> : null}
          {formatDuration(source.durationMs) ? <span className="tabular-nums">, {formatDuration(source.durationMs)}</span> : null}
        </p>
      </div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer noopener" aria-label={`Mở trang ${SOURCE_LABELS[source.name] || source.name} (tab mới)`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
    </li>
  );
}

function Group({ title, count, hint, children }: { title: string; count: number; hint?: string; children: ReactNode }) {
  if (!count) return null;
  return (
    <section aria-label={`${title}, ${count} nguồn`}>
      <h3 className="flex items-baseline gap-2 text-[13.5px] font-semibold text-foreground">
        {title}<span className="font-normal tabular-nums text-muted-foreground">{count}</span>
      </h3>
      {hint ? <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

const SEGMENTS: Array<{ key: "found" | "rejected" | "failed" | "notFound"; label: string; bar: string; dot: string }> = [
  { key: "found", label: "Có dữ liệu", bar: "bg-emerald-500", dot: "bg-emerald-500" },
  { key: "rejected", label: "Bị loại", bar: "bg-amber-400", dot: "bg-amber-400" },
  { key: "failed", label: "Lỗi, quá giờ, tạm dừng", bar: "bg-red-400", dot: "bg-red-400" },
  { key: "notFound", label: "Không tìm thấy", bar: "bg-slate-300 dark:bg-slate-600", dot: "bg-slate-300 dark:bg-slate-600" },
];

/**
 * Search results and source comparison (area C). Counts are the backend's own
 * (verification.*); every source is grouped by what it returned, so the few that
 * matter (data, rejections, failures) carry detail and the many that had nothing
 * fold into tiles. Disabled/skipped sources are listed apart: they were not asked.
 */
export function SourceComparison({ lookup, onUseOcr, onManualEntry }: {
  lookup: LookupBookByIsbnResponse;
  onUseOcr: () => void;
  onManualEntry: () => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const summary = summarizeSources(lookup);
  const sources = lookup.sources || [];
  const identifying = lookup.verification?.round1.matchedSource ?? null;
  const found = sources.filter((s) => s.status === "SUCCESS").sort((a, b) => Number(b.name === identifying) - Number(a.name === identifying) || (a.round ?? 0) - (b.round ?? 0));
  const problems = sources.filter((s) => PROBLEM.includes(s.status));
  const notFound = sources.filter((s) => s.status === "NOT_FOUND");
  const notQueried = sources.filter((s) => NOT_QUERIED.includes(s.status));
  const coverage = lookup.metadataCoverage;
  const conflicts = lookup.conflicts?.length || 0;
  const identifyingSource = identifying ? sources.find((s) => s.name === identifying) : null;
  const fromPhotos = lookup.reason === "OCR_WITHOUT_PROVIDER_RECORD" || lookup.reason === "OCR_LOOKUP_MISMATCH";
  const counts = { found: summary.found, rejected: summary.rejected, failed: summary.failed, notFound: summary.notFound };
  const barTotal = counts.found + counts.rejected + counts.failed + counts.notFound;

  // The one orchestrated moment of the results: the outcome bar draws itself left to right.
  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.fromTo("[data-outcome-fill]", { clipPath: "inset(0 100% 0 0 round 999px)" }, { clipPath: "inset(0 0% 0 0 round 999px)", duration: 1.1, ease: EASE_OUT, delay: 0.1 });
    });
    return () => mm.revert();
  }, { scope: barRef, dependencies: [lookup], revertOnUpdate: true });

  return (
    <div className="space-y-6">
      {lookup.found && identifyingSource ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3.5 dark:border-emerald-500/25 dark:bg-emerald-500/[0.07]">
          <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <div className="min-w-0 text-[13.5px]">
            <p className="font-semibold text-foreground">Sách được xác định bởi {SOURCE_LABELS[identifying!] || identifying}</p>
            <p className="mt-0.5 text-muted-foreground">
              Khớp mã chính xác ở vòng 1{lookup.verification?.round1.order.length ? `, nguồn thứ ${lookup.verification.round1.order.indexOf(identifying!) + 1}/${lookup.verification.round1.order.length} theo thứ tự ưu tiên` : ""}.
              {lookup.verification?.crossSourceVerified ? " Tên và tác giả được nguồn khác xác nhận." : ""}
            </p>
            {safeHttpUrl(lookup.verification?.round1.matchedUrl || identifyingSource.sourceUrl) ? (
              <a href={safeHttpUrl(lookup.verification?.round1.matchedUrl || identifyingSource.sourceUrl)!} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex min-h-8 items-center gap-1 font-medium text-emerald-800 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring dark:text-emerald-300">
                Xem bản ghi gốc <ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only">(mở tab mới)</span>
              </a>
            ) : null}
          </div>
        </div>
      ) : !lookup.found ? (
        <div className="rounded-xl border border-amber-300/70 bg-amber-50/70 px-4 py-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
            <SearchX className="h-4 w-4 text-amber-700 dark:text-amber-400" aria-hidden="true" />
            {fromPhotos ? "Chưa có bản ghi từ nhà cung cấp — dữ liệu chỉ đến từ ảnh" : "Không có metadata cho mã này"}
          </p>
          <p className="mt-1.5 max-w-[68ch] text-[13px] leading-relaxed text-muted-foreground">
            {lookup.verification
              ? `Vòng 1 đã hỏi ${lookup.verification.round1.attempts.filter((a) => !NOT_QUERIED.includes(a.status)).length} nguồn theo đúng mã; không nguồn nào có bản ghi mang mã này${summary.failed ? ` (${summary.failed} nguồn lỗi hoặc quá thời gian)` : ""}${summary.rejected ? `, ${summary.rejected} bản ghi bị loại vì ghi mã khác` : ""}. Hệ thống không đoán sách theo tên, nên vòng 2 không chạy.`
              : fromPhotos ? "Kiểm tra từng trường với sách thật trước khi lưu."
              : lookup.message || "Mã chưa qua bước kiểm tra nên không nguồn nào được hỏi."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onUseOcr} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Camera className="h-4 w-4" aria-hidden="true" />Chụp trang thông tin xuất bản
            </button>
            <button type="button" onClick={onManualEntry} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-4 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <PencilLine className="h-4 w-4" aria-hidden="true" />Nhập tay
            </button>
          </div>
        </div>
      ) : null}

      {summary.pipeline ? (
        <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Pipeline trích xuất liệt kê các nguồn đã cung cấp tài liệu, không có trạng thái theo vòng. Đoạn bằng chứng từng trường nằm ở tab Kiểm duyệt.
        </p>
      ) : barTotal ? (
        <div ref={barRef}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-[14px] text-foreground"><span className="text-[20px] font-semibold tabular-nums">{summary.checked}</span> nguồn đã kiểm tra</p>
            <p className="text-[12.5px] text-muted-foreground">
              {coverage ? <><span className="tabular-nums text-foreground">{coverage.foundFields}/{coverage.totalFields}</span> trường có dữ liệu</> : null}
              {coverage ? ", " : ""}
              <span className={`tabular-nums ${conflicts ? "font-medium text-amber-800 dark:text-amber-300" : "text-foreground"}`}>{conflicts}</span> trường xung đột
            </p>
          </div>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div data-outcome-fill className="flex h-full w-full gap-px">
              {SEGMENTS.filter((segment) => counts[segment.key]).map((segment) => (
                <span key={segment.key} className={`h-full ${segment.bar}`} style={{ width: `${(counts[segment.key] / barTotal) * 100}%` }} />
              ))}
            </div>
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
            {SEGMENTS.map((segment) => (
              <li key={segment.key} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${segment.dot}`} aria-hidden="true" />
                {segment.label}<span className="font-semibold tabular-nums text-foreground">{counts[segment.key]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Group title="Có dữ liệu" count={found.length} hint="Dữ liệu của các nguồn này được đối chiếu theo từng trường ở phần Kiểm duyệt metadata.">
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {found.map((source) => <FoundSource key={source.name} source={source} identifying={source.name === identifying} />)}
        </ul>
      </Group>

      <Group title="Bị loại hoặc lỗi" count={problems.length}>
        <ul className="space-y-1.5">
          {problems.map((source) => (
            <li key={source.name} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <SourceTile tile={toTile(source)} />
              <span className="min-w-0 text-[12.5px] text-muted-foreground">
                {reasonLabel(source.reason) || publicError(source.error) || SOURCE_STATUS_META[source.status].hint}
              </span>
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Không tìm thấy" count={notFound.length} hint="Nguồn trả lời nhưng không có cuốn sách này. Rê chuột hoặc chọn một ô để xem cách tra.">
        <ul className="flex flex-wrap gap-1.5">
          {notFound.map((source) => <li key={source.name} className="max-w-full"><SourceTile tile={toTile(source)} /></li>)}
        </ul>
      </Group>

      {notQueried.length ? (
        <details className="group">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-1 text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span>Không truy vấn lần này <span className="tabular-nums">{notQueried.length}</span></span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {notQueried.map((source) => <li key={source.name} className="max-w-full"><SourceTile tile={toTile(source)} /></li>)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
