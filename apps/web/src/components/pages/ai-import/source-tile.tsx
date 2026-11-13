import { useRef } from "react";
import { Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import {
  QUERY_LABELS, SOURCE_KIND_META, SOURCE_STATUS_META, VERIFICATION_LABELS, describeTile, formatDuration, publicError, reasonLabel,
  sourceKind, type SourceStatus, type SourceTileData, type Tone,
} from "./source-meta";
import { SOURCE_LABELS } from "./utils";


const TILE_TONE: Record<Tone | "running" | "queued", string> = {
  ok: "border-emerald-300/80 bg-emerald-50 text-emerald-900 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-100",
  warn: "border-amber-300/80 bg-amber-50 text-amber-950 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100",
  error: "border-red-300/80 bg-red-50 text-red-900 dark:border-red-500/35 dark:bg-red-500/10 dark:text-red-100",
  muted: "border-border bg-muted/50 text-muted-foreground",
  running: "border-primary/50 bg-primary/[0.07] text-foreground",
  queued: "border-dashed border-border bg-transparent text-muted-foreground",
};

const STATUS_ICON_TONE: Record<Tone, string> = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground/80",
};

/**
 * One source as a compact tile: kind icon, name, status glyph. Every state comes
 * from the backend; the tile only answers that change - it settles when the source
 * answers and pulses while it is being asked. Details are in the tooltip (hover or
 * keyboard focus) and in the accessible name, so nothing depends on colour.
 */
export function SourceTile({ tile, index }: { tile: SourceTileData; index?: number }) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const pulseRef = useRef<HTMLSpanElement>(null);
  const previous = useRef<string | null>(null);
  const meta = tile.status ? SOURCE_STATUS_META[tile.status] : null;
  const kind = SOURCE_KIND_META[sourceKind(tile.source)];
  const key = `${tile.state}:${tile.status ?? ""}`;
  const toneClass = tile.state === "running" ? TILE_TONE.running : tile.state === "queued" || !meta ? TILE_TONE.queued : TILE_TONE[meta.tone];

  useGSAP(() => {
    const changed = previous.current !== null && previous.current !== key;
    previous.current = key;
    const mm = gsap.matchMedia();
    mm.add(MOTION_OK, () => {
      if (tile.state === "running" && pulseRef.current) {
        gsap.fromTo(pulseRef.current, { scale: 1, autoAlpha: 0.55 }, { scale: 2.4, autoAlpha: 0, duration: 1.1, ease: "power2.out", repeat: -1 });
      }
      // Answered just now: a short settle, so the eye finds which source changed.
      if (changed && tile.state === "done" && rootRef.current) {
        gsap.fromTo(rootRef.current, { scale: 0.9 }, { scale: 1, duration: 0.55, ease: "back.out(2.4)", clearProps: "transform" });
      }
    });
    return () => mm.revert();
  }, { dependencies: [key], revertOnUpdate: true, scope: rootRef });

  const duration = formatDuration(tile.durationMs);
  const why = tile.status && tile.status !== "SUCCESS" ? reasonLabel(tile.reason) || publicError(tile.error) : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={rootRef}
          type="button"
          aria-label={describeTile(tile)}
          data-source-tile={tile.source}
          data-state={tile.state}
          className={`relative inline-flex h-8 max-w-full cursor-default items-center gap-1.5 rounded-lg border pl-2 pr-2.5 text-[12.5px] font-medium transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${toneClass}`}
        >
          {index != null ? <span className="text-[11px] tabular-nums opacity-60" aria-hidden="true">{index}</span> : null}
          <kind.icon className={`h-3.5 w-3.5 shrink-0 ${tile.source === "aiWebSearch" ? "text-[#1d5fbf] dark:text-[#8ab4f8]" : "opacity-70"}`} aria-hidden="true" />
          <span className="truncate">{SOURCE_LABELS[tile.source] || tile.source}</span>
          {tile.state === "running" ? (
            <span className="relative grid h-3.5 w-3.5 shrink-0 place-items-center" aria-hidden="true">
              <span ref={pulseRef} className="absolute inset-0 rounded-full bg-primary/40" />
              <Loader2 className="relative h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" />
            </span>
          ) : meta && tile.state === "done" ? (
            <meta.icon className={`h-3.5 w-3.5 shrink-0 ${STATUS_ICON_TONE[meta.tone]}`} aria-hidden="true" />
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[18rem] bg-foreground px-3 py-2 text-left text-background">
        <p className="text-[12.5px] font-semibold">{SOURCE_LABELS[tile.source] || tile.source}</p>
        <p className="text-[11.5px] opacity-75">{kind.label}</p>
        <p className="mt-1 text-[12px]">
          {tile.state === "running" ? "Đang truy vấn…" : meta ? meta.label : "Chờ lượt"}
          {tile.round ? `, vòng ${tile.round}` : ""}
          {tile.query && tile.query !== "-" ? `, ${QUERY_LABELS[tile.query]?.toLowerCase()}` : ""}
        </p>
        {tile.verification ? (
          <p className="text-[12px]">
            {VERIFICATION_LABELS[tile.verification as keyof typeof VERIFICATION_LABELS] || tile.verification}
            {tile.verification === "TITLE_MATCH" && tile.matchConfidence ? ` (${Math.round(tile.matchConfidence * 100)}%)` : ""}
          </p>
        ) : null}
        {why ? <p className="text-[12px] opacity-90">{why}</p> : null}
        {duration || tile.attempts ? (
          <p className="mt-1 text-[11.5px] tabular-nums opacity-75">
            {[duration, tile.attempts ? `${tile.attempts} lần thử` : null].filter(Boolean).join(", ")}
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** One line of legend: what each status glyph means, said once instead of on every tile. */
export function SourceLegend({ statuses }: { statuses: SourceStatus[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground" aria-label="Chú giải trạng thái nguồn">
      {statuses.map((status) => {
        const meta = SOURCE_STATUS_META[status];
        return (
          <li key={status} className="inline-flex items-center gap-1.5">
            <meta.icon className={`h-3.5 w-3.5 ${STATUS_ICON_TONE[meta.tone]}`} aria-hidden="true" />{meta.label}
          </li>
        );
      })}
    </ul>
  );
}

