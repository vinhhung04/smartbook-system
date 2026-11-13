import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleDashed, HelpCircle, Loader2, Minus, Radio, X } from "lucide-react";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import type { LookupProgress, PhaseState, SourceTrace } from "./lookup-progress";
import { sourceCounts } from "./lookup-progress";
import type { SourceStatus } from "./source-meta";
import { SourceLegend, SourceTile } from "./source-tile";
import { SOURCE_LABELS } from "./utils";

const KIND_LABEL: Record<string, string> = {
  ISBN13: "ISBN-13 hợp lệ, đúng checksum",
  ISBN10: "ISBN-10 hợp lệ, đúng checksum",
  BARCODE: "Không phải ISBN — tra như mã vạch bán lẻ",
  INVALID: "Mã không hợp lệ",
};

const PHASE_ICON: Record<PhaseState, { icon: typeof Check; className: string; words: string }> = {
  pending: { icon: CircleDashed, className: "text-muted-foreground/70", words: "chưa tới" },
  active: { icon: Loader2, className: "animate-spin text-primary motion-reduce:animate-none", words: "đang chạy" },
  done: { icon: Check, className: "text-white", words: "đã xong" },
  skipped: { icon: Minus, className: "text-muted-foreground", words: "không chạy" },
  failed: { icon: X, className: "text-red-600 dark:text-red-400", words: "thất bại" },
  unreported: { icon: HelpCircle, className: "text-muted-foreground/70", words: "không có dữ liệu tiến trình" },
};

/** A phase's marker and the rail under it. When the phase finishes, the check pops in and
 *  the rail fills down to the next phase - the only motion here not tied to a single source. */
function Phase({ state, title, summary, children, last = false }: {
  state: PhaseState; title: string; summary: ReactNode; children?: ReactNode; last?: boolean;
}) {
  const rootRef = useRef<HTMLLIElement>(null);
  const previous = useRef<PhaseState | null>(null);
  const { icon: Icon, className } = PHASE_ICON[state];

  useGSAP(() => {
    const finishedNow = previous.current !== null && previous.current !== "done" && state === "done";
    previous.current = state;
    if (!finishedNow) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      gsap.fromTo("[data-phase-marker]", { scale: 0.6 }, { scale: 1, duration: 0.5, ease: "back.out(2.6)", clearProps: "transform" });
      gsap.fromTo("[data-phase-rail]", { scaleY: 0 }, { scaleY: 1, transformOrigin: "top", duration: 0.6, ease: "expo.out", clearProps: "transform" });
    });
    return () => mm.revert();
  }, { dependencies: [state], scope: rootRef, revertOnUpdate: true });

  return (
    <li ref={rootRef} className="relative flex gap-3.5" aria-current={state === "active" ? "step" : undefined}>
      {!last ? (
        <span className="absolute bottom-0 left-[13px] top-7 w-px bg-border" aria-hidden="true">
          {state === "done" ? <span data-phase-rail className="absolute inset-0 bg-emerald-400/70 dark:bg-emerald-500/50" /> : null}
        </span>
      ) : null}
      <span data-phase-marker className={`relative z-[1] grid h-7 w-7 shrink-0 place-items-center rounded-full border ${
        state === "done" ? "border-emerald-600 bg-emerald-600 dark:border-emerald-500 dark:bg-emerald-500"
          : state === "active" ? "border-primary/40 bg-card ring-4 ring-primary/10" : "border-border bg-card"
      }`}>
        <Icon className={`h-3.5 w-3.5 ${className}`} aria-hidden="true" />
      </span>
      <div className={`min-w-0 flex-1 ${last ? "" : "pb-6"}`}>
        <p className={`text-[14px] font-semibold leading-7 ${state === "pending" ? "text-muted-foreground" : "text-foreground"}`}>
          {title}<span className="sr-only"> — {PHASE_ICON[state].words}</span>
        </p>
        <div className="max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">{summary}</div>
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </li>
  );
}

/** Sources after the Round 1 match are reported as SKIPPED; one chip says so instead of a tile each. */
const notAskedAfterMatch = (row: SourceTrace) => row.status === "SKIPPED" && row.reason === "ROUND1_ALREADY_MATCHED";

function Tiles({ rows, numbered, label, children }: { rows: SourceTrace[]; numbered?: SourceTrace[]; label: string; children?: ReactNode }) {
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={label}>
      {rows.map((row) => (
        <li key={`${row.round}-${row.source}`} className="max-w-full">
          <SourceTile tile={{ ...row, error: row.errorCode }} index={numbered ? numbered.indexOf(row) + 1 : undefined} />
        </li>
      ))}
      {children}
    </ul>
  );
}

function useElapsed(startedAt: number | null, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  return startedAt && running ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

const LEGEND_ORDER: SourceStatus[] = ["SUCCESS", "NOT_FOUND", "MISMATCH", "DIFFERENT_EDITION", "TIMEOUT", "PAUSED", "ERROR", "DISABLED", "SKIPPED"];

/**
 * Live Processing Timeline: the five stages of an ISBN lookup. Every state on it
 * comes from an event the backend sent (or, when no live channel was available,
 * from the finished response's own trace, and it says so). Sources are tiles that
 * light up as they answer - the tiles are the progress; nothing moves on a timer.
 */
export function ProcessingTimeline({ progress, code, running, startedAt, finishedMs }: {
  progress: LookupProgress;
  code: string;
  running: boolean;
  startedAt: number | null;
  /** Total processing time reported by the backend, once finished. */
  finishedMs?: number | null;
}) {
  const elapsed = useElapsed(startedAt, running);
  const round1 = progress.sources.filter((row) => row.round === 1);
  const round2 = progress.sources.filter((row) => row.round === 2);
  const skippedAfterMatch = round1.filter(notAskedAfterMatch);
  const r1 = sourceCounts(progress.sources, 1);
  const r2 = sourceCounts(progress.sources, 2);
  const matched = progress.round1.matchedSource;
  const matchedIndex = matched ? round1.findIndex((row) => row.source === matched) + 1 : 0;
  const asking = round1.find((row) => row.state === "running");
  const r2Found = round2.filter((row) => row.status === "SUCCESS").length;
  const r2Rejected = round2.filter((row) => row.status === "DIFFERENT_EDITION" || row.status === "MISMATCH").length;
  const noChannel = progress.channel === "unavailable";
  const prepareSteps = [progress.authority, progress.ai, progress.draft, progress.duplicate];
  const prepare: PhaseState = prepareSteps.includes("active") ? "active"
    : progress.duplicate === "done" || progress.duplicate === "failed" ? "done"
    : running ? "pending" : "unreported";
  const seenStatuses = LEGEND_ORDER.filter((status) => progress.sources.some((row) => row.status === status && !notAskedAfterMatch(row)));

  const validateSummary = progress.cache
    ? progress.cache.fallback
      ? "Các nguồn không trả kết quả lần này — dùng bản ghi đã xác minh được lưu trước đó."
      : "Kết quả đã có trong bộ nhớ đệm, các nguồn không bị hỏi lại."
    : progress.validate.kind
      ? <>{KIND_LABEL[progress.validate.kind] || progress.validate.kind}{progress.validate.code ? <span className="ml-2 font-mono tabular-nums text-foreground">{progress.validate.code}</span> : null}</>
      : progress.validate.state === "active" || (running && !noChannel) ? "Chuẩn hóa mã, kiểm tra độ dài và checksum…" : "Không có dữ liệu tiến trình cho bước này.";

  const round1Summary = progress.round1.state === "pending" && progress.cache ? "Không chạy — dùng kết quả đã lưu."
    : matched ? <>Khớp mã chính xác ở <strong className="font-semibold text-foreground">{SOURCE_LABELS[matched] || matched}</strong>{matchedIndex ? `, nguồn thứ ${matchedIndex} theo thứ tự ưu tiên` : ""}. Dừng vòng 1.</>
    : progress.round1.state === "done" ? "Không nguồn nào có bản ghi mang đúng mã này. Dừng tra cứu — hệ thống không đoán sách theo tên."
    : asking ? <>Đang hỏi <strong className="font-semibold text-foreground">{SOURCE_LABELS[asking.source] || asking.source}</strong>, nguồn {round1.indexOf(asking) + 1}/{r1.total}. Hỏi lần lượt theo thứ tự ưu tiên.</>
    : r1.total ? `${r1.answered}/${r1.total} nguồn đã trả lời.`
    : progress.fieldLevel ? "Chế độ tra cứu theo trường đang bật — máy chủ không báo tiến trình từng nguồn."
    : "Hỏi từng nguồn theo thứ tự ưu tiên cho tới khi một nguồn khớp đúng mã.";

  const round2Summary = progress.cache && !round2.length ? "Không chạy — dùng kết quả đã lưu."
    : progress.round2.state === "skipped" ? "Không chạy vì vòng 1 chưa xác định được sách."
    : r2.total ? <>
        Hỏi song song {r2.total} nguồn theo mã hoặc theo tên và tác giả.{" "}
        <span className="tabular-nums text-foreground">{r2.answered}/{r2.total}</span> đã trả lời
        {r2.answered ? <>, <span className="tabular-nums text-foreground">{r2Found}</span> có dữ liệu{r2Rejected ? `, ${r2Rejected} bị loại vì khác ấn bản hoặc sai mã` : ""}</> : null}.
      </>
    : "Chỉ chạy khi vòng 1 đã xác định được cuốn sách.";

  const fusionSummary = progress.cache && progress.fusion.state !== "done" ? "Dùng kết quả đã tổng hợp ở lần tra cứu được lưu."
    : progress.fusion.state === "done"
    ? progress.fusion.found === false ? "Không có bản ghi để tổng hợp."
      : `Đã đối chiếu từng trường${progress.fusion.foundFields != null ? `: ${progress.fusion.foundFields}/${progress.fusion.totalFields} trường có dữ liệu` : ""}, ${progress.fusion.conflicts ? `${progress.fusion.conflicts} trường các nguồn ghi khác nhau` : "không có xung đột"}.`
    : progress.fusion.state === "active" ? "Đang chọn giá trị cho từng trường và kiểm tra xung đột…"
    : "Gộp dữ liệu các nguồn, chọn giá trị từng trường, phát hiện xung đột.";

  const prepareParts = [
    progress.authority !== "pending" && progress.authority !== "unreported" ? `chuẩn hóa tác giả, NXB, thể loại ${progress.authority === "active" ? "đang chạy" : "xong"}` : null,
    progress.ai !== "pending" && progress.ai !== "unreported" ? `đề xuất AI ${progress.ai === "active" ? "đang tạo" : "xong"}` : null,
    progress.draft !== "pending" ? `bản nháp kiểm duyệt ${progress.draft === "active" ? "đang tạo" : progress.draft === "failed" ? "lỗi" : "xong"}` : null,
    progress.duplicate !== "pending" ? `kiểm tra trùng ${progress.duplicate === "active" ? "đang chạy" : progress.duplicate === "failed" ? "lỗi" : "xong"}` : null,
  ].filter(Boolean) as string[];

  // Announced at phase level only (not per source), so a screen reader is not flooded.
  const live = `${running ? "Đang tra cứu" : "Tra cứu xong"}. Vòng 1: ${matched ? `khớp ở ${SOURCE_LABELS[matched] || matched}` : progress.round1.state === "done" ? "không nguồn nào khớp" : `${r1.answered}/${r1.total} nguồn đã trả lời`}. Vòng 2: ${r2.total ? `${r2.answered}/${r2.total} nguồn đã trả lời` : "chưa chạy"}.`;

  return (
    <section aria-labelledby="lookup-timeline-title" className="rounded-2xl border border-border bg-card px-5 py-5 sm:px-7 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="lookup-timeline-title" className="text-[16px] font-semibold text-foreground">
            {running ? "Đang tra cứu" : "Diễn biến tra cứu"} <span className="font-mono text-[15px] font-medium tabular-nums">{code}</span>
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            {progress.replayed ? (
              progress.cache ? "Kết quả lấy từ bộ nhớ đệm — các ô dưới là diễn biến của lần tra cứu đã lưu"
                : "Tái hiện từ kết quả cuối cùng, không phải cập nhật theo thời gian thực"
            ) : progress.channel === "live" ? (
              <>
                <span className="relative grid h-2 w-2 place-items-center" aria-hidden="true">
                  {running ? <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70 motion-reduce:hidden" /> : null}
                  <span className="relative h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {running ? "Cập nhật trực tiếp từ máy chủ" : "Đã ghi nhận trực tiếp từ máy chủ"}
              </>
            ) : noChannel ? "Không mở được kênh tiến trình — chỉ biết yêu cầu đang chạy; chi tiết từng nguồn hiện khi xong"
              : <><Radio className="h-3.5 w-3.5" aria-hidden="true" />Đang kết nối kênh tiến trình…</>}
          </p>
        </div>
        <p className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
          {running ? <>{elapsed}s</> : finishedMs ? <>{progress.cache ? "Lần tra cứu đã lưu mất" : "Hoàn tất trong"} {(finishedMs / 1000).toFixed(1)}s</> : null}
        </p>
      </div>
      <p className="sr-only" aria-live="polite">{live}</p>

      <ol className="mt-6" aria-label="Các giai đoạn tra cứu">
        <Phase state={progress.cache ? "done" : progress.validate.state === "pending" && running && !noChannel ? "active" : progress.validate.state} title="Kiểm tra mã đầu vào" summary={validateSummary} />
        <Phase state={progress.cache && progress.round1.state === "pending" ? "skipped" : progress.round1.state} title="Vòng 1 — tìm theo mã chính xác" summary={round1Summary}>
          {round1.length ? (
            <Tiles rows={round1.filter((row) => !notAskedAfterMatch(row))} numbered={round1} label="Nguồn vòng 1 theo thứ tự ưu tiên">
              {skippedAfterMatch.length ? (
                <li className="inline-flex h-8 items-center rounded-lg px-2 text-[12.5px] text-muted-foreground"
                  title={skippedAfterMatch.map((row) => SOURCE_LABELS[row.source] || row.source).join(", ")}>
                  +{skippedAfterMatch.length} nguồn không cần hỏi
                </li>
              ) : null}
            </Tiles>
          ) : null}
        </Phase>
        <Phase state={progress.cache && !round2.length ? "skipped" : progress.round2.state} title="Vòng 2 — đối chiếu chéo" summary={round2Summary}>
          {round2.length ? <Tiles rows={round2} label="Nguồn vòng 2" /> : null}
        </Phase>
        <Phase state={progress.cache && progress.fusion.state !== "done" ? "skipped" : progress.fusion.state} title="Tổng hợp metadata" summary={fusionSummary} />
        <Phase last state={prepare} title="Chuẩn bị kiểm duyệt"
          summary={prepareParts.length ? `${prepareParts.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : "Chuẩn hóa danh mục, tạo bản nháp kiểm duyệt, kiểm tra sách trùng, mở biểu mẫu."} />
      </ol>

      {seenStatuses.length ? (
        <div className="mt-5 border-t border-border pt-4">
          <SourceLegend statuses={seenStatuses} />
        </div>
      ) : null}
    </section>
  );
}
