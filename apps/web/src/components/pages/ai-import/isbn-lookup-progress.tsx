import { useEffect, useRef, useState } from "react";
import { Check, Loader2, SearchCheck } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { IsbnSourceName } from "@/services/ai";
import { SOURCE_LABELS } from "./utils";

type SourceTickStatus = "pending" | "checking" | "done";
type CopyStage = "start" | "cross-check" | "marketplace";

/** Believable staged reveal, not literal per-source completion — the backend answers in one
 *  shot after ~10-30s (marketplace scraping dominates), so this timeline is a heuristic that
 *  explains *why* it's slow rather than faking real progress events. */
const SOURCE_TIMELINE: Array<{ name: IsbnSourceName; checkingAtMs: number; doneAtMs: number }> = [
  { name: "googleBooks", checkingAtMs: 0, doneAtMs: 1200 },
  { name: "openLibrary", checkingAtMs: 300, doneAtMs: 2500 },
  { name: "tiki", checkingAtMs: 600, doneAtMs: 4000 },
  { name: "vinabook", checkingAtMs: 900, doneAtMs: 6000 },
  { name: "webSearch", checkingAtMs: 1200, doneAtMs: 9000 },
  { name: "fahasa", checkingAtMs: 1500, doneAtMs: 21000 },
];

const ELAPSED_VISIBLE_AFTER_MS = 8000;

function computeProgressPct(elapsedMs: number): number {
  if (elapsedMs <= 3000) return (elapsedMs / 3000) * 55;
  if (elapsedMs <= 18000) return 55 + ((elapsedMs - 3000) / 15000) * 35;
  return 90;
}

function computeSourceTicks(elapsedMs: number): Record<IsbnSourceName, SourceTickStatus> {
  const ticks = {} as Record<IsbnSourceName, SourceTickStatus>;
  for (const item of SOURCE_TIMELINE) {
    ticks[item.name] = elapsedMs >= item.doneAtMs ? "done" : elapsedMs >= item.checkingAtMs ? "checking" : "pending";
  }
  return ticks;
}

function computeCopyStage(elapsedMs: number): CopyStage {
  if (elapsedMs < 3000) return "start";
  if (elapsedMs < 10000) return "cross-check";
  return "marketplace";
}

const COPY_BY_STAGE: Record<CopyStage, string> = {
  start: "Đang tra cứu nguồn dữ liệu sách…",
  "cross-check": "Đang đối chiếu nhiều nguồn…",
  marketplace: "Đang chờ phản hồi từ nhà sách trực tuyến (có thể mất đến 30 giây)…",
};

/** Runs for as long as `IsbnLookupProgress` stays mounted — the parent unmounts it the
 *  instant the real lookup resolves, so there is no "active" flag to toggle: mounting
 *  starts the clock, unmounting discards it. */
function useSimulatedLookupProgress() {
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    startRef.current = Date.now();
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - (startRef.current as number));
    }, 100);
    return () => window.clearInterval(interval);
  }, []);

  return {
    progressPct: computeProgressPct(elapsedMs),
    elapsedSeconds: Math.floor(elapsedMs / 1000),
    showElapsed: elapsedMs >= ELAPSED_VISIBLE_AFTER_MS,
    copy: COPY_BY_STAGE[computeCopyStage(elapsedMs)],
    sourceTicks: computeSourceTicks(elapsedMs),
  };
}

export function IsbnLookupProgress() {
  const { progressPct, elapsedSeconds, showElapsed, copy, sourceTicks } = useSimulatedLookupProgress();

  return (
    <div
      className="rounded-xl border border-border bg-card p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none"
      role="status"
      aria-live="polite"
    >
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-500/10">
          <SearchCheck className="h-4 w-4 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-foreground">{copy}</p>
          <p className="text-[12px] text-muted-foreground">Đối chiếu 6 nguồn để tìm thông tin chính xác nhất</p>
        </div>
        {showElapsed ? (
          <p className="shrink-0 text-[12px] tabular-nums text-muted-foreground" aria-live="off">
            {elapsedSeconds}s
          </p>
        ) : null}
      </div>
      <Progress value={progressPct} className="h-2" />

      <ul className="mt-5 grid grid-cols-1 gap-x-4 gap-y-2.5 lg:grid-cols-2" aria-label="Các nguồn dữ liệu đang được kiểm tra">
        {SOURCE_TIMELINE.map((item) => {
          const status = sourceTicks[item.name];
          return (
            <li key={item.name} className="flex items-center gap-2.5 text-[13px]">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors ${
                  status === "done"
                    ? "border-success/30 bg-success/15 text-success"
                    : status === "checking"
                    ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                    : "border-border bg-muted/40 text-muted-foreground/50"
                }`}
                aria-hidden="true"
              >
                {status === "done" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : status === "checking" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </span>
              <span className={status === "pending" ? "text-muted-foreground" : "font-medium text-foreground"}>
                {SOURCE_LABELS[item.name]}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
