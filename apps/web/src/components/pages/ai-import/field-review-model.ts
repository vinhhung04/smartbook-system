import type { ComponentType } from "react";
import { AlertTriangle, BadgeCheck, CircleDashed, Layers, PencilLine, ScanText, Sparkles, UserRound } from "lucide-react";
import type { IsbnSourceName, LookupBookByIsbnResponse } from "@/services/ai";
import type { FieldOrigin } from "./field";

// Presentation model of the metadata review (area D): which evidence backs each form
// field, its competing values and its status label. Pure functions - no value is ever
// decided here; the form keeps Evidence Fusion's choice until the user picks another.

/** Form field -> the key the lookup's fieldEvidence / fieldStatus use. */
export const EVIDENCE_KEY: Partial<Record<string, string>> = {
  isbn: "isbn", isbn13: "isbn", isbn10: "isbn", title: "title", subtitle: "subtitle", authorsText: "authors",
  translatorText: "translator", publisher: "publisher", publishedDate: "publishedDate", pageCount: "pageCount",
  language: "language", description: "description", categoriesText: "categories", thumbnail: "thumbnail",
};

/** Fields whose evidence values may be put into the form with one click. ISBNs are
 *  the lookup key itself and stay hand-edited only. */
export const CHOOSABLE = new Set(["title", "subtitle", "authorsText", "translatorText", "publisher", "publishedDate", "pageCount", "language", "description", "categoriesText", "thumbnail"]);

export type FieldFilter = "all" | "verified" | "multi" | "conflict" | "low" | "missing" | "ai";

export interface FieldState {
  /** Shown as the field's status label (icon + words). */
  label: string;
  icon: ComponentType<{ className?: string }>;
  tone: "ok" | "warn" | "muted" | "ai" | "edited" | "info";
  filters: Set<FieldFilter>;
}


export function toFormValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean).join(", ");
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");

export interface SourceDetail {
  source: IsbnSourceName;
  method?: string;
  round?: 1 | 2;
  verification?: string;
  matchConfidence?: number;
  sourceUrl?: string;
}

export interface Candidate {
  value: string;
  sources: SourceDetail[];
  support?: number;
  selected: boolean;
}

/** Every competing value of a field with the sources behind it. Uses Evidence
 *  Fusion's candidates[] when present, else groups the raw evidence by value. */
export function candidatesFor(lookup: LookupBookByIsbnResponse, key: string): Candidate[] {
  const evidence = lookup.fieldEvidence?.[key];
  if (!evidence) return [];
  const details = new Map<string, SourceDetail>();
  for (const confirmation of evidence.confirmations || []) {
    details.set(confirmation.source, {
      source: confirmation.source, round: confirmation.round, verification: confirmation.verification,
      matchConfidence: confirmation.matchConfidence, sourceUrl: confirmation.sourceUrl,
    });
  }
  for (const item of evidence.evidence || []) {
    details.set(item.source, { ...details.get(item.source), source: item.source, method: item.method, sourceUrl: item.sourceUrl || details.get(item.source)?.sourceUrl });
  }
  const selected = toFormValue(evidence.selectedValue);
  const detail = (source: IsbnSourceName) => details.get(source) || { source };
  if (evidence.candidates?.length) {
    return [...evidence.candidates]
      .sort((a, b) => b.support - a.support)
      .map((candidate) => {
        const value = toFormValue(candidate.value);
        return { value, sources: candidate.sources.map(detail), support: candidate.support, selected: same(value, selected) };
      })
      .filter((candidate) => candidate.value);
  }
  const groups = new Map<string, Candidate>();
  const raw = evidence.evidence?.length ? evidence.evidence : evidence.confirmations || [];
  for (const item of raw) {
    const value = toFormValue(item.value);
    if (!value) continue;
    const group = groups.get(value) || { value, sources: [], selected: same(value, selected) };
    group.sources.push(detail(item.source));
    groups.set(value, group);
  }
  if (!groups.size && selected && evidence.selectedSource) {
    groups.set(selected, { value: selected, sources: [detail(evidence.selectedSource)], selected: true });
  }
  return [...groups.values()].sort((a, b) => Number(b.selected) - Number(a.selected) || b.sources.length - a.sources.length);
}

/** Presentation only: what the review list says about a field. It never decides a value. */
export function fieldState({ field, lookup, value, origin, edited, hasAiSuggestion, aiApplied = false }: {
  field: string; lookup: LookupBookByIsbnResponse | null; value: string; origin?: FieldOrigin; edited: boolean; hasAiSuggestion: boolean;
  /** The value now in the field is an AI suggestion the user applied - never shown as source evidence. */
  aiApplied?: boolean;
}): FieldState {
  const key = EVIDENCE_KEY[field];
  const evidence = key ? lookup?.fieldEvidence?.[key] : undefined;
  const filters = new Set<FieldFilter>(["all"]);
  const agreeing = key ? (lookup?.fieldSources?.[key]?.length || evidence?.confirmations?.length || 0) : 0;
  const conflicted = Boolean(key && lookup && (lookup.conflictedFields ? lookup.conflictedFields.includes(key) : lookup.conflicts?.some((c) => c.field === key)));
  const codeVerified = Boolean(evidence?.confirmations?.some((c) => c.verification === "CODE_MATCH"));
  const low = key ? lookup?.fieldStatus?.[key] === "LOW_CONFIDENCE" : false;
  if (codeVerified && evidence?.selectedSource) filters.add("verified");
  if (agreeing >= 2) filters.add("multi");
  if (conflicted) filters.add("conflict");
  if (low) filters.add("low");
  if (!value.trim()) filters.add("missing");
  if (hasAiSuggestion) filters.add("ai");

  if (edited) return { label: "Bạn đã sửa hoặc chọn", icon: UserRound, tone: "edited", filters };
  if (aiApplied && value.trim()) return { label: "Đã dùng đề xuất AI", icon: Sparkles, tone: "ai", filters };
  if (conflicted) return { label: "Nguồn ghi khác nhau", icon: AlertTriangle, tone: "warn", filters };
  if (!value.trim()) {
    return hasAiSuggestion
      ? { label: "Có đề xuất AI chờ duyệt", icon: Sparkles, tone: "ai", filters }
      : { label: "Chưa tìm thấy", icon: CircleDashed, tone: "muted", filters };
  }
  if (origin && (origin.tone === "ocr" || origin.tone === "ocr-weak")) return { label: origin.label, icon: ScanText, tone: origin.tone === "ocr" ? "ok" : "info", filters };
  if (low) return { label: "Độ tin cậy thấp", icon: AlertTriangle, tone: "warn", filters };
  if (agreeing >= 2) return { label: `${agreeing} nguồn xác nhận`, icon: Layers, tone: "ok", filters };
  if (evidence?.selectedSource) return { label: codeVerified ? "Một nguồn · khớp mã" : "Một nguồn", icon: BadgeCheck, tone: codeVerified ? "ok" : "muted", filters };
  // The ISBN fields hold the code that was searched; Round 1 accepted a source only when its record printed it.
  const lookupCodes = [lookup?.isbn, lookup?.isbn13, lookup?.isbn10].filter(Boolean).map((code) => String(code).replace(/[^0-9X]/gi, ""));
  if (key === "isbn" && lookup?.verification?.round1.matchedSource && lookupCodes.includes(value.replace(/[^0-9X]/gi, ""))) {
    filters.add("verified");
    return { label: "Mã đã khớp ở vòng 1", icon: BadgeCheck, tone: "ok", filters };
  }
  return { label: lookup?.found ? "Không có bằng chứng nguồn" : "Nhập tay", icon: PencilLine, tone: "muted", filters };
}

export const FIELD_FILTERS: Array<{ id: FieldFilter; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "verified", label: "Khớp mã" },
  { id: "multi", label: "Nhiều nguồn" },
  { id: "conflict", label: "Xung đột" },
  { id: "low", label: "Tin cậy thấp" },
  { id: "missing", label: "Còn trống" },
  { id: "ai", label: "Đề xuất AI" },
];
