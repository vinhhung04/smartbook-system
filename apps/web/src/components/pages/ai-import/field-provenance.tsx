import { useId, useState, type ReactNode } from "react";
import { Check, ChevronDown, ExternalLink, RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { LookupBookByIsbnResponse } from "@/services/ai";
import { CHOOSABLE, EVIDENCE_KEY, candidatesFor, same, toFormValue, type FieldState, type SourceDetail } from "./field-review-model";
import { VERIFICATION_LABELS, safeHttpUrl } from "./source-meta";
import { SOURCE_LABELS, extractionMethodI18nKey } from "./utils";

const TONE_CLASS: Record<FieldState["tone"], string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-800 dark:text-amber-300",
  muted: "text-muted-foreground",
  ai: "text-[#1d5fbf] dark:text-[#8ab4f8]",
  edited: "text-primary",
  info: "text-sky-700 dark:text-sky-300",
};

export function FieldStateLabel({ state }: { state: FieldState }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${TONE_CLASS[state.tone]}`}>
      <state.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{state.label}
    </span>
  );
}

function SourceFacts({ detail }: { detail: SourceDetail }) {
  const { t } = useI18n();
  const extractionMethodLabel = (method: string) => t(extractionMethodI18nKey(method));
  const facts = [
    detail.round ? `Vòng ${detail.round}` : null,
    detail.verification ? VERIFICATION_LABELS[detail.verification as keyof typeof VERIFICATION_LABELS] || detail.verification : null,
    detail.matchConfidence != null && detail.verification === "TITLE_MATCH" ? `${Math.round(detail.matchConfidence * 100)}%` : null,
    detail.method ? extractionMethodLabel(detail.method) : null,
  ].filter(Boolean);
  const url = safeHttpUrl(detail.sourceUrl);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px]">
      <span className="font-medium text-foreground">{SOURCE_LABELS[detail.source] || detail.source}</span>
      {facts.length ? <span className="text-muted-foreground">{facts.join(" · ")}</span> : null}
      {url ? (
        <a href={url} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-6 items-center gap-0.5 text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          Nguồn<ExternalLink className="h-3 w-3" aria-hidden="true" /><span className="sr-only"> {SOURCE_LABELS[detail.source]} (mở tab mới)</span>
        </a>
      ) : null}
    </li>
  );
}

/**
 * Field-level provenance (area D): where the current value came from, how many
 * sources agree, and - on demand - every competing value with its sources.
 * Choosing a value goes through the page's own field handler (it counts as the
 * user's explicit choice); nothing here applies a value by itself.
 */
export function FieldProvenance({ field, label, lookup, value, onChoose, preview }: {
  field: string;
  label: string;
  lookup: LookupBookByIsbnResponse | null;
  value: string;
  onChoose: (value: string) => void;
  /** Render a value (e.g. a cover thumbnail) instead of plain text. */
  preview?: (value: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const key = EVIDENCE_KEY[field];
  if (!lookup || !key) return null;
  const evidence = lookup.fieldEvidence?.[key];
  const candidates = candidatesFor(lookup, key);
  if (!evidence?.selectedSource && !candidates.length) return null;
  const choosable = CHOOSABLE.has(field);
  const selected = candidates.find((c) => c.selected) || candidates[0];
  const backendValue = toFormValue(evidence?.selectedValue);
  const seen = new Set(candidates.flatMap((c) => c.sources.map((s) => s.source)));
  const silent = (lookup.sources || []).filter((s) => s.status === "SUCCESS" && !seen.has(s.name)).map((s) => SOURCE_LABELS[s.name] || s.name);
  const lead = selected?.sources[0];
  const summary = [
    selected ? `${selected.sources.map((s) => SOURCE_LABELS[s.source] || s.source).slice(0, 3).join(", ")}${selected.sources.length > 3 ? ` +${selected.sources.length - 3}` : ""}` : null,
    lead?.round ? `vòng ${lead.round}` : null,
    lead?.verification ? (VERIFICATION_LABELS[lead.verification as keyof typeof VERIFICATION_LABELS] || "").toLowerCase() : null,
    evidence?.selectedPhase === "TARGETED" ? "bổ sung sau" : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        {summary ? <span className="min-w-0">Nguồn: {summary}</span> : null}
        <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-1 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
          {candidates.length > 1 ? `So sánh ${candidates.length} giá trị` : "Xem bằng chứng"}
          <span className="sr-only"> cho {label}</span>
          <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {choosable && backendValue && !same(backendValue, value) ? (
          <button type="button" onClick={() => onChoose(backendValue)} className="inline-flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
            <RotateCcw className="h-3 w-3" aria-hidden="true" />Dùng lại giá trị hệ thống chọn
          </button>
        ) : null}
      </div>

      {open ? (
        <div id={panelId} className="mt-2 rounded-xl border border-border bg-muted/25 p-3 sm:p-4">
          <ul className="space-y-3" aria-label={`Các giá trị của ${label}`}>
            {candidates.map((candidate, index) => {
              const inUse = same(candidate.value, value);
              return (
                <li key={`${candidate.value}-${index}`} className="rounded-lg border border-border/80 bg-card px-3.5 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      {preview ? preview(candidate.value) : (
                        <p className={`whitespace-pre-wrap break-words text-[13.5px] leading-6 text-foreground ${field === "description" ? "line-clamp-6" : ""}`}>{candidate.value}</p>
                      )}
                      <p className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-muted-foreground">
                        {candidate.selected ? <span className="font-medium text-foreground">Hệ thống chọn</span> : null}
                        <span>{candidate.sources.length} nguồn</span>
                        {candidate.support != null ? <span className="tabular-nums">mức ủng hộ {Math.round(candidate.support * 100)}%</span> : null}
                      </p>
                    </div>
                    {choosable ? (
                      inUse ? (
                        <span className="inline-flex min-h-8 items-center gap-1 text-[12.5px] font-medium text-emerald-700 dark:text-emerald-400"><Check className="h-3.5 w-3.5" aria-hidden="true" />Đang dùng</span>
                      ) : (
                        <button type="button" onClick={() => onChoose(candidate.value)}
                          className="inline-flex min-h-9 shrink-0 cursor-pointer items-center rounded-lg border border-border bg-card px-3 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
                          Dùng giá trị này<span className="sr-only"> cho {label}</span>
                        </button>
                      )
                    ) : null}
                  </div>
                  <ul className="mt-2 space-y-1 border-t border-border/70 pt-2">
                    {candidate.sources.map((detail) => <SourceFacts key={detail.source} detail={detail} />)}
                  </ul>
                </li>
              );
            })}
          </ul>
          {silent.length ? (
            <p className="mt-3 text-[12px] text-muted-foreground">Có bản ghi nhưng không ghi trường này: {silent.join(", ")}.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
