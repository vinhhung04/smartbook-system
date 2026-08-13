import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  BadgeCheck,
  BookCheck,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Database,
  FileText,
  Gauge,
  Hash,
  Languages,
  Layers3,
  Loader2,
  ScanBarcode,
  Search,
  Sparkles,
  Tags,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { BarcodeScanModal } from "@/components/barcode-scan-modal";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";
import { StatusBadge } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { aiService, type LookupBookByIsbnResponse, type EnrichBookMetadataResponse, type EnrichMode, type PostIsbnAiSuggestions } from "@/services/ai";
import { bookService } from "@/services/book";
import { metadataIntelligenceService, type DuplicateReview, type ReconciliationDraft } from "@/services/metadata-intelligence";
import { getApiErrorMessage } from "@/services/api";
import { useI18n } from "@/lib/i18n";

interface EditableBookForm {
  isbn: string;
  isbn13: string;
  isbn10: string;
  title: string;
  subtitle: string;
  authorsText: string;
  publisher: string;
  publishedDate: string;
  description: string;
  categoriesText: string;
  language: string;
  pageCount: string;
  thumbnail: string;
  summaryVi: string;
  keywordsText: string;
}

const EMPTY_FORM: EditableBookForm = {
  isbn: "",
  isbn13: "",
  isbn10: "",
  title: "",
  subtitle: "",
  authorsText: "",
  publisher: "",
  publishedDate: "",
  description: "",
  categoriesText: "",
  language: "vi",
  pageCount: "",
  thumbnail: "",
  summaryVi: "",
  keywordsText: "",
};

function normalizeIsbnInput(value: string): string {
  const cleaned = String(value || "").trim().replace(/[^0-9Xx]/g, "");
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 9)}${cleaned.slice(9).toUpperCase()}`;
  }
  return cleaned;
}

function parsePublishYear(publishedDate: string): number | undefined {
  const matched = String(publishedDate || "").match(/\b(\d{4})\b/);
  if (!matched) return undefined;
  const year = Number(matched[1]);
  if (!Number.isInteger(year) || year < 1000 || year > 2100) return undefined;
  return year;
}

interface CatalogBookLite {
  id: string;
  title: string;
  author: string;
  isbn: string;
  category: string;
}

/** Lowercase, strip diacritics/punctuation — for loose duplicate/category comparisons. */
function normalizeForCompare(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface DuplicateMatch {
  book: CatalogBookLite;
  reason: "isbn" | "title";
}

/** Flags catalog books that look like the same title being entered again. */
function findDuplicateMatches(form: EditableBookForm, catalogBooks: CatalogBookLite[]): DuplicateMatch[] {
  const candidateIsbns = new Set(
    [form.isbn, form.isbn13, form.isbn10].map((v) => normalizeIsbnInput(v)).filter(Boolean),
  );
  const normalizedTitle = normalizeForCompare(form.title);
  const firstAuthor = normalizeForCompare(form.authorsText.split(",")[0] || "");

  if (!candidateIsbns.size && normalizedTitle.length < 3) return [];

  const matches: DuplicateMatch[] = [];
  for (const book of catalogBooks) {
    const bookIsbn = normalizeIsbnInput(book.isbn || "");
    if (bookIsbn && candidateIsbns.has(bookIsbn)) {
      matches.push({ book, reason: "isbn" });
      continue;
    }
    if (normalizedTitle.length < 3) continue;
    const bookTitle = normalizeForCompare(book.title);
    if (!bookTitle) continue;
    const titleMatches = bookTitle === normalizedTitle;
    const authorMatches = !firstAuthor || normalizeForCompare(book.author).includes(firstAuthor);
    if (titleMatches && authorMatches) {
      matches.push({ book, reason: "title" });
    }
  }
  return matches;
}

function mapLookupToForm(data: LookupBookByIsbnResponse): EditableBookForm {
  return {
    isbn: data.isbn || "",
    isbn13: data.isbn13 || "",
    isbn10: data.isbn10 || "",
    title: data.title || "",
    subtitle: data.subtitle || "",
    authorsText: (data.authors || []).join(", "),
    publisher: data.publisher || "",
    publishedDate: data.publishedDate || "",
    description: data.description || "",
    categoriesText: (data.categories || []).join(", "),
    language: data.language || "vi",
    pageCount: data.pageCount != null ? String(data.pageCount) : "",
    thumbnail: data.thumbnail || "",
    summaryVi: data.summaryVi || "",
    keywordsText: (data.keywords || []).join(", "),
  };
}

function mergeCommaText(current: string, additions: string[]): string {
  const merged = [
    ...current.split(",").map((value) => value.trim()).filter(Boolean),
    ...additions.map((value) => value.trim()).filter(Boolean),
  ];
  return [...new Set(merged)].join(", ");
}

// ── Small presentational helpers ────────────────────────────────────────────

function Field({
  id,
  label,
  value,
  onChange,
  mono,
  placeholder,
  className,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground">
        {label}
        {required ? <span className="text-rose-500">*</span> : null}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-required={required || undefined}
        className={mono ? "font-mono tabular-nums" : undefined}
      />
    </div>
  );
}

/** Book cover preview with graceful fallback. Remount via `key` when the URL changes. */
function CoverPreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-cyan-50 to-violet-50 text-cyan-400 dark:from-cyan-500/10 dark:to-violet-500/10 dark:text-cyan-500/50">
        <BookOpen className="h-9 w-9" />
        <span className="text-[10px] font-medium">Chưa có ảnh bìa</span>
      </div>
    );
  }
  return <img src={src} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} />;
}

function LookupSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
        <Skeleton className="aspect-[3/4] w-full max-w-[200px] rounded-xl" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewSignal({
  label,
  detail,
  complete,
}: {
  label: string;
  detail: string;
  complete: boolean;
}) {
  const Icon = complete ? CheckCircle2 : AlertTriangle;
  return (
    <div className="flex min-h-[58px] items-start gap-2 rounded-[10px] border border-border bg-muted/35 px-3 py-2">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${complete ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`} />
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-foreground">{label}</div>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function AiToolButton({
  label,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-violet-200 bg-card px-3 py-1.5 text-[11px] font-semibold text-violet-700 transition-colors duration-150 hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-45 dark:border-violet-500/20 dark:text-violet-400 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/10"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      <span>{loading ? "Đang xử lý..." : label}</span>
    </button>
  );
}

function AiSuggestionRow({
  title,
  value,
  onApply,
  icon: Icon,
}: {
  title: string;
  value: string;
  onApply: () => void;
  icon: LucideIcon;
}) {
  if (!value.trim()) return null;
  return (
    <div className="rounded-[10px] border border-border bg-card p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-foreground">{title}</div>
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">{value}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onApply}
          className="inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-violet-200 bg-violet-50 px-3 text-[11px] font-semibold text-violet-700 transition-colors hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
        >
          Áp dụng
        </button>
      </div>
    </div>
  );
}

function displayEvidenceValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "–";
  return String(value);
}

function MetadataFoundHero({
  lookup,
  form,
  completeSignalCount,
}: {
  lookup: LookupBookByIsbnResponse;
  form: EditableBookForm;
  completeSignalCount: number;
}) {
  const quality = Math.round((lookup.metadataQualityScore || 0) * 100);
  const successfulSources = (lookup.sources || []).filter((source) => source.status === "SUCCESS");
  const facts = [
    { icon: Hash, label: "ISBN", value: form.isbn13 || form.isbn || "Chưa có" },
    { icon: Languages, label: "Ngôn ngữ", value: form.language || "Chưa có" },
    { icon: Layers3, label: "Thể loại", value: form.categoriesText || "Chưa phân loại" },
  ];

  return (
    <section
      className="relative mb-5 overflow-hidden rounded-2xl border border-violet-200/80 bg-gradient-to-br from-violet-50 via-card to-cyan-50/70 p-4 shadow-[0_12px_32px_rgba(124,58,237,0.08)] dark:border-violet-500/20 dark:from-violet-500/10 dark:via-card dark:to-cyan-500/5 sm:p-5"
      aria-labelledby="metadata-found-title"
    >
      <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-violet-300/20 blur-3xl dark:bg-violet-500/10" />
      <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-stretch">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-bold text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Metadata đã tìm thấy
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">Sẵn sàng để đối chiếu trước khi lưu</span>
          </div>
          <h3 id="metadata-found-title" className="max-w-3xl text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {form.title || "Chưa có tên sách"}
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            {[form.authorsText, form.publisher, form.publishedDate].filter(Boolean).join(" · ") || "Kiểm tra các trường thông tin trước khi xác nhận."}
          </p>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {facts.map(({ icon: Icon, label, value }) => (
              <div key={label} className="min-w-0 rounded-xl border border-border/80 bg-card/80 px-3 py-2.5 backdrop-blur-sm">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" aria-hidden="true" />
                  {label}
                </div>
                <p className="mt-1 truncate text-[12px] font-semibold text-foreground" title={value}>{value}</p>
              </div>
            ))}
          </div>
        </div>

        <aside className="rounded-2xl border border-violet-200/80 bg-card/90 p-4 shadow-sm dark:border-violet-500/20 dark:bg-card/70">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Chất lượng</span>
            <Gauge className="h-4 w-4 text-violet-600 dark:text-violet-400" aria-hidden="true" />
          </div>
          <div className="mt-2 flex items-end gap-1">
            <strong className="text-4xl font-bold tracking-tight text-foreground tabular-nums">{quality}</strong>
            <span className="mb-1 text-sm font-semibold text-muted-foreground">%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-violet-100 dark:bg-violet-500/15">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-cyan-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${quality}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
            <span>{completeSignalCount}/4 mục cốt lõi</span>
            <span className="inline-flex items-center gap-1 tabular-nums"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{Math.round((lookup.processingTimeMs || 0) / 1000)}s</span>
          </div>
        </aside>
      </div>

      <div className="relative mt-4 flex flex-col gap-2 border-t border-violet-200/70 pt-3 dark:border-violet-500/15 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Database className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" aria-hidden="true" />
          <span className="font-medium">Nguồn xác nhận</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {successfulSources.length ? successfulSources.map((source) => (
            <span key={source.name} className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-1 text-[10px] font-bold text-cyan-800 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">
              {source.name}
            </span>
          )) : <span className="text-[11px] text-muted-foreground">Đang chờ xác nhận nguồn</span>}
        </div>
      </div>
    </section>
  );
}

function IsbnIntelligencePanel({ lookup }: { lookup: LookupBookByIsbnResponse }) {
  const { t } = useI18n();
  const evidence = Object.entries(lookup.fieldEvidence || {}).filter(([, item]) => item.selectedSource);
  const conflicts = lookup.conflicts || [];
  const sources = lookup.sources || [];
  if (!evidence.length && !sources.length) return null;

  return (
    <section className="mb-4 rounded-[10px] border border-cyan-200/80 bg-cyan-50/35 p-3 dark:border-cyan-500/20 dark:bg-cyan-500/5" aria-label={t("isbn_intelligence.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-semibold text-cyan-800 dark:text-cyan-300">{t("isbn_intelligence.title")}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("isbn_intelligence.quality")} {Math.round((lookup.metadataQualityScore || 0) * 100)}% · {t("isbn_intelligence.processing")} {lookup.processingTimeMs ?? 0} ms
          </p>
        </div>
        {conflicts.length > 0 ? <StatusBadge label={`${conflicts.length} ${t("isbn_intelligence.conflicts")}`} variant="warning" /> : null}
      </div>

      {conflicts.length > 0 ? (
        <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />{t("isbn_intelligence.conflict_warning")}</div>
          {conflicts.map((conflict) => <p key={conflict.field} className="mt-1">{conflict.field}: {displayEvidenceValue(conflict.selectedValue)} · {conflict.alternatives.map((item) => `${item.source}: ${displayEvidenceValue(item.value)}`).join(" | ")}</p>)}
        </div>
      ) : null}

      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] font-semibold text-cyan-800 dark:text-cyan-300">{t("isbn_intelligence.evidence")}</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {evidence.map(([field, item]) => (
            <div key={field} className="rounded-[8px] border border-border bg-card px-2.5 py-2 text-[11px]">
              <p className="font-semibold text-foreground">{field} <span className="font-normal text-muted-foreground">· {Math.round((lookup.fieldConfidence?.[field] || 0) * 100)}%</span></p>
              <p className="mt-0.5 text-muted-foreground">{displayEvidenceValue(item.selectedValue)}</p>
              <p className="mt-1 text-cyan-700 dark:text-cyan-300">{t("isbn_intelligence.confirmed_by")}: {item.confirmations.map((confirmation) => confirmation.source).join(", ")}</p>
            </div>
          ))}
        </div>
      </details>

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] font-semibold text-cyan-800 dark:text-cyan-300">{t("isbn_intelligence.sources")}</summary>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {sources.map((source) => <StatusBadge key={source.name} label={`${source.name}: ${source.status}`} variant={source.status === "SUCCESS" ? "success" : source.status === "DISABLED" ? "neutral" : "warning"} />)}
        </div>
      </details>
    </section>
  );
}

function AuthorityReviewPanel({
  draft,
  onDecision,
  onCreateEntity,
}: {
  draft: ReconciliationDraft;
  onDecision: (field: string, status: "ACCEPTED" | "REJECTED") => void;
  onCreateEntity: (field: string) => void;
}) {
  const { t } = useI18n();
  const rows = [
    { field: "authors", label: t("metadata_reconciliation.authors"), items: draft.normalizationSuggestions.authorNormalization },
    { field: "publisher", label: t("metadata_reconciliation.publisher"), items: [draft.normalizationSuggestions.publisherNormalization] },
    { field: "categories", label: t("metadata_reconciliation.categories"), items: draft.normalizationSuggestions.categoryNormalization },
  ].filter((row) => row.items.length > 0);
  if (!rows.length) return null;
  return (
    <section className="mb-4 rounded-[10px] border border-violet-200/80 bg-violet-50/35 p-3 dark:border-violet-500/20 dark:bg-violet-500/5" aria-label={t("metadata_reconciliation.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-semibold text-violet-800 dark:text-violet-300">{t("metadata_reconciliation.title")}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("metadata_reconciliation.hint")}</p>
        </div>
        {draft.qualityWarnings.length ? <StatusBadge label={`${draft.qualityWarnings.length} ${t("metadata_reconciliation.warnings")}`} variant="warning" /> : <StatusBadge label={t("metadata_reconciliation.no_warnings")} variant="success" />}
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((row) => {
          const decision = draft.decisions.find((item) => item.field === row.field)?.status || "PENDING";
          return (
            <div key={row.field} className="rounded-[8px] border border-border bg-card p-2.5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 text-[11px]">
                  <p className="font-semibold text-foreground">{row.label} <span className="font-normal text-muted-foreground">· {decision}</span></p>
                  {row.items.map((item) => <p key={`${item.rawValue}-${item.normalizedValue}`} className="mt-1 text-muted-foreground"><span className="font-medium text-foreground">{item.rawValue}</span> → {item.normalizedValue} · {item.matchedEntity?.name || t("metadata_reconciliation.new_entity")} · {Math.round(item.confidence * 100)}% · {item.status}</p>)}
                  <p className="mt-1 text-violet-700 dark:text-violet-300">{row.items.map((item) => item.reason).join(" ")}</p>
                </div>
                {decision === "PENDING" ? <div className="flex shrink-0 gap-1.5">
                  <button type="button" onClick={() => onDecision(row.field, "ACCEPTED")} className="min-h-8 rounded-[7px] border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">{t("metadata_reconciliation.accept")}</button>
                  <button type="button" onClick={() => onDecision(row.field, "REJECTED")} className="min-h-8 rounded-[7px] border border-border bg-card px-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30">{t("metadata_reconciliation.reject")}</button>
                  {row.items.some((item) => item.status === "NEW_ENTITY") ? <button type="button" onClick={() => onCreateEntity(row.field)} className="min-h-8 rounded-[7px] border border-cyan-200 bg-cyan-50 px-2.5 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("metadata_reconciliation.create_entity")}</button> : null}
                </div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {draft.qualityWarnings.length ? <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">{draft.qualityWarnings.join(" · ")}</p> : null}
    </section>
  );
}

function DuplicateReviewPanel({ review, onAction }: { review: DuplicateReview; onAction: (action: string, candidate?: DuplicateReview["candidates"][number]) => void }) {
  const { t } = useI18n();
  const isNew = review.classification === "NEW_TITLE";
  return (
    <section className={`mb-4 rounded-[10px] border p-3 ${isNew ? "border-emerald-200 bg-emerald-50/35 dark:border-emerald-500/20 dark:bg-emerald-500/5" : "border-amber-200 bg-amber-50/35 dark:border-amber-500/20 dark:bg-amber-500/5"}`} aria-label={t("duplicate_intelligence.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-semibold text-foreground">{t("duplicate_intelligence.title")}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{review.classification} · {Math.round(review.similarityScore * 100)}%</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {review.classification === "EXACT_DUPLICATE" && review.candidates[0] ? <button type="button" onClick={() => onAction("LINK_EXISTING_VARIANT", review.candidates[0])} className="min-h-8 rounded-[7px] border border-cyan-200 bg-cyan-50 px-2.5 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("duplicate_intelligence.link_variant")}</button> : null}
          {review.classification === "SAME_EDITION" && review.candidates[0] ? <button type="button" onClick={() => onAction("CREATE_VARIANT_FOR_EDITION", review.candidates[0])} className="min-h-8 rounded-[7px] border border-cyan-200 bg-cyan-50 px-2.5 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("duplicate_intelligence.create_variant")}</button> : null}
          {review.classification === "SAME_WORK_DIFFERENT_EDITION" && review.candidates[0] ? <button type="button" onClick={() => onAction("CREATE_NEW_EDITION", review.candidates[0])} className="min-h-8 rounded-[7px] border border-cyan-200 bg-cyan-50 px-2.5 text-[11px] font-semibold text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("duplicate_intelligence.create_edition")}</button> : null}
          {isNew ? <button type="button" onClick={() => onAction("CREATE_NEW_TITLE")} className="min-h-8 rounded-[7px] border border-emerald-200 bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">{t("duplicate_intelligence.create_title")}</button> : <button type="button" onClick={() => onAction("DISMISS_WARNING")} className="min-h-8 rounded-[7px] border border-border bg-card px-2.5 text-[11px] font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30">{t("duplicate_intelligence.dismiss")}</button>}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">{review.explanation.join(" ")}</p>
      {review.candidates.length ? <ul className="mt-2 space-y-1.5" role="list">{review.candidates.slice(0, 3).map((candidate) => <li key={candidate.bookId} className="rounded-[7px] border border-border bg-card px-2.5 py-2 text-[11px]"><span className="font-semibold text-foreground">{candidate.title}</span> · {candidate.classification} · {Math.round(candidate.score * 100)}%</li>)}</ul> : null}
    </section>
  );
}

const SOURCE_BADGES: Array<{ key: keyof LookupBookByIsbnResponse["source"]; label: string; variant: string }> = [
  { key: "googleBooks", label: "Google", variant: "cyan" },
  { key: "openLibrary", label: "OpenLibrary", variant: "violet" },
  { key: "worldCat", label: "WorldCat", variant: "primary" },
  { key: "fahasa", label: "Fahasa", variant: "amber" },
  { key: "tiki", label: "Tiki", variant: "rose" },
  { key: "vinabook", label: "Vinabook", variant: "teal" },
  { key: "webSearch", label: "Web", variant: "neutral" },
];

export function AIImportPage() {
  const [isbnInput, setIsbnInput] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupStage, setLookupStage] = useState<"lookup" | "ai" | null>(null);
  const [saving, setSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [lookupData, setLookupData] = useState<LookupBookByIsbnResponse | null>(null);
  const [postIsbnSuggestions, setPostIsbnSuggestions] = useState<PostIsbnAiSuggestions | null>(null);
  const [reconciliationDraft, setReconciliationDraft] = useState<ReconciliationDraft | null>(null);
  const [createAuthorityEntities, setCreateAuthorityEntities] = useState<Record<string, boolean>>({});
  const [duplicateReview, setDuplicateReview] = useState<DuplicateReview | null>(null);
  const [form, setForm] = useState<EditableBookForm>(EMPTY_FORM);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState<EnrichMode | null>(null);
  const [enrichResult, setEnrichResult] = useState<EnrichBookMetadataResponse | null>(null);

  const [catalogBooks, setCatalogBooks] = useState<CatalogBookLite[]>([]);
  const [confirmDuplicateSave, setConfirmDuplicateSave] = useState(false);

  // Loaded once for two AI-assist features: matching category suggestions against the
  // real catalog, and warning about likely duplicate books before save.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await bookService.getAll();
        const rows = (Array.isArray(response) ? response : []).map((row: unknown) => {
          const book = row as Partial<Record<"id" | "title" | "author" | "isbn" | "category", unknown>>;
          return {
            id: String(book.id || ""),
            title: String(book.title || ""),
            author: String(book.author || ""),
            isbn: String(book.isbn || ""),
            category: String(book.category || ""),
          };
        });
        if (!cancelled) setCatalogBooks(rows);
      } catch {
        // Non-critical: category suggestions and duplicate check just degrade gracefully.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    catalogBooks.forEach((book) => {
      const trimmed = book.category.trim();
      if (trimmed) set.add(trimmed);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogBooks]);

  const duplicateMatches = useMemo(
    () => findDuplicateMatches(form, catalogBooks),
    [form, catalogBooks],
  );

  useEffect(() => {
    setConfirmDuplicateSave(false);
  }, [duplicateMatches.length]);

  const manualMode = Boolean(lookupData && !lookupData.found);

  const confidenceValue = lookupData?.confidence?.overall;
  const confidenceText = useMemo(() => {
    if (typeof confidenceValue !== "number") return "-";
    return `${Math.round(confidenceValue * 100)}%`;
  }, [confidenceValue]);
  const confidenceVariant = useMemo(() => {
    if (typeof confidenceValue !== "number") return "neutral";
    if (confidenceValue >= 0.75) return "success";
    if (confidenceValue >= 0.4) return "warning";
    return "danger";
  }, [confidenceValue]);

  const sourceBadges = useMemo(() => {
    if (!lookupData) return [];
    return SOURCE_BADGES.filter((s) => lookupData.source[s.key]);
  }, [lookupData]);

  const lookupLoadingLabel = lookupStage === "ai" ? "AI đang hoàn thiện metadata" : "Đang tra cứu ISBN";
  const hasPostIsbnSuggestions = Boolean(
    postIsbnSuggestions
      && (
        postIsbnSuggestions.description
        || postIsbnSuggestions.summaryVi
        || postIsbnSuggestions.keywords.length > 0
        || postIsbnSuggestions.categories.length > 0
        || postIsbnSuggestions.qualityWarnings.length > 0
      ),
  );
  const aiSuggestionCount = useMemo(() => {
    if (!postIsbnSuggestions) return 0;
    return [
      postIsbnSuggestions.description,
      postIsbnSuggestions.summaryVi,
      postIsbnSuggestions.keywords.length > 0,
      postIsbnSuggestions.categories.length > 0,
    ].filter(Boolean).length;
  }, [postIsbnSuggestions]);
  const reviewSignals = useMemo(() => {
    const isbn = normalizeIsbnInput(form.isbn || form.isbn13 || form.isbn10);
    const hasTitle = Boolean(form.title.trim());
    const hasAuthor = Boolean(form.authorsText.trim());
    const hasDescription = Boolean(form.description.trim() || postIsbnSuggestions?.description);
    return [
      {
        label: "ISBN",
        detail: isbn ? `Sẵn sàng kiểm duplicate: ${isbn}` : "Thiếu ISBN, chưa thể lưu",
        complete: Boolean(isbn),
      },
      {
        label: "Nhan đề",
        detail: hasTitle ? "Đã có tên sách để catalog" : "Cần tên sách trước khi lưu",
        complete: hasTitle,
      },
      {
        label: "Tác giả",
        detail: hasAuthor ? "Có dữ liệu tác giả để tìm kiếm" : "Nên bổ sung tác giả nếu lookup thiếu",
        complete: hasAuthor,
      },
      {
        label: "Mô tả",
        detail: hasDescription ? "Có mô tả hoặc đề xuất AI chờ duyệt" : "Có thể dùng AI để tạo mô tả",
        complete: hasDescription,
      },
    ];
  }, [form.authorsText, form.description, form.isbn, form.isbn10, form.isbn13, form.title, postIsbnSuggestions?.description]);
  const completeSignalCount = reviewSignals.filter((signal) => signal.complete).length;

  const steps: WorkflowStep[] = [
    { id: "lookup", label: "Tra cứu ISBN", icon: Search, status: lookupData ? "completed" : "active" },
    {
      id: "ai",
      label: "AI đề xuất",
      icon: Sparkles,
      status: hasPostIsbnSuggestions ? "completed" : lookupStage === "ai" ? "active" : "pending",
    },
    { id: "edit", label: "Admin duyệt", icon: ClipboardCheck, status: lookupData ? "active" : "pending" },
  ];

  async function handleLookup(rawInput?: string) {
    const normalized = normalizeIsbnInput(rawInput ?? isbnInput);
    if (!normalized) {
      toast.error("Vui lòng nhập ISBN");
      return;
    }

    setLookupLoading(true);
    setLookupStage("lookup");
    setPostIsbnSuggestions(null);
    setReconciliationDraft(null);
    setCreateAuthorityEntities({});
    setDuplicateReview(null);
    const stageTimer = window.setTimeout(() => setLookupStage("ai"), 700);
    try {
      const result = await aiService.enrichBookAfterIsbn({
        isbn: normalized,
        existingCategories,
      });
      const lookup = result.lookup;

      setIsbnInput(normalized);
      setLookupData(lookup);
      setPostIsbnSuggestions(result.aiSuggestions);

      if (lookup.found) {
        setForm(mapLookupToForm(lookup));
        try {
          const draft = await metadataIntelligenceService.createReconciliationDraft(lookup, result.aiSuggestions);
          setReconciliationDraft(draft);
          const duplicate = await metadataIntelligenceService.checkDuplicate(draft.normalized_metadata);
          setDuplicateReview(duplicate);
        } catch {
          // Catalog intelligence is additive: ISBN lookup remains usable when its review APIs are unavailable.
          toast.info("Không thể tải review catalog lúc này; bạn vẫn có thể kiểm tra metadata thủ công.");
        }
        if (result.aiSuggestions.provider && result.aiSuggestions.provider !== "none") {
          toast.success("Đã tìm thấy metadata và AI đã tạo đề xuất hậu xử lý");
        } else {
          toast.success("Đã tìm thấy metadata sách");
        }
      } else {
        setForm({
          ...EMPTY_FORM,
          isbn: lookup.isbn || normalized,
          isbn13: lookup.isbn13 || (normalized.length === 13 ? normalized : ""),
          isbn10: lookup.isbn10 || (normalized.length === 10 ? normalized : ""),
        });
        toast.info("Không tìm thấy metadata. Chuyển sang nhập tay.");
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tra cứu ISBN thất bại"));
    } finally {
      window.clearTimeout(stageTimer);
      setLookupLoading(false);
      setLookupStage(null);
    }
  }

  async function handleAuthorityDecision(field: string, status: "ACCEPTED" | "REJECTED") {
    if (!reconciliationDraft) return;
    try {
      await metadataIntelligenceService.decideField(reconciliationDraft.id, field, status);
      setReconciliationDraft((current) => current ? {
        ...current,
        decisions: current.decisions.map((item) => item.field === field ? { ...item, status } : item),
      } : current);
      toast.success(status === "ACCEPTED" ? "Đã chấp nhận đề xuất" : "Đã từ chối đề xuất");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể lưu quyết định metadata"));
    }
  }

  function handleCreateAuthorityEntity(field: string) {
    if (!window.confirm("Entity mới chỉ được tạo khi bạn chấp nhận field này. Bạn có muốn tiếp tục?")) return;
    setCreateAuthorityEntities((current) => ({ ...current, [field]: true }));
    void handleAuthorityDecision(field, "ACCEPTED");
  }

  async function handleDuplicateAction(action: string, candidate?: DuplicateReview["candidates"][number]) {
    if (!duplicateReview) return;
    if (["CREATE_VARIANT_FOR_EDITION", "CREATE_NEW_EDITION", "CREATE_NEW_TITLE"].includes(action) && !window.confirm("Thao tác này sẽ tạo catalog/edition mới. Bạn có muốn tiếp tục?")) return;
    try {
      const variantId = candidate?.variantIds[0];
      await metadataIntelligenceService.decideDuplicate(duplicateReview.id, action, {
        ...(action === "LINK_EXISTING_VARIANT" && variantId ? { selectedVariantId: variantId } : {}),
        ...(["CREATE_VARIANT_FOR_EDITION", "CREATE_NEW_EDITION"].includes(action) && candidate ? { selectedBookId: candidate.bookId } : {}),
      });
      toast.success(action === "DISMISS_WARNING" ? "Đã ghi nhận quyết định bỏ qua cảnh báo duplicate" : "Đã lưu quyết định duplicate; chỉ metadata được duyệt mới được áp dụng.");
      setDuplicateReview(null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể lưu quyết định duplicate"));
    }
  }

  async function handleGenerateDescription() {
    if (!form.title.trim()) {
      toast.error("Cần có tên sách trước khi tạo mô tả AI");
      return;
    }
    setSummaryLoading(true);
    try {
      const result = await aiService.generateSummaryVi({
        title: form.title.trim(),
        author: form.authorsText.split(",")[0].trim(),
        publisher: form.publisher || undefined,
        description: form.description,
        categories: form.categoriesText.split(",").map((c) => c.trim()).filter(Boolean),
      });
      setForm((prev) => ({
        ...prev,
        description: result.summaryVi || prev.description,
        keywordsText: (result.keywords || []).join(", ") || prev.keywordsText,
      }));
      toast.success(`Đã tạo mô tả AI (${result.ai_provider === "anthropic" ? "Anthropic" : "Ollama"})`);
    } catch {
      toast.error("Không thể tạo mô tả. Vui lòng thử lại.");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleEnrichMetadata(mode: EnrichMode) {
    if (!form.title.trim()) {
      toast.error("Cần có tên sách để sử dụng công cụ AI");
      return;
    }
    setEnrichLoading(mode);
    setEnrichResult(null);
    try {
      const result = await aiService.enrichBookMetadata({
        title: form.title.trim(),
        authors: form.authorsText.split(",").map((a) => a.trim()).filter(Boolean),
        publisher: form.publisher || undefined,
        description: form.description || undefined,
        categories: form.categoriesText.split(",").map((c) => c.trim()).filter(Boolean),
        existingCategories: mode === "suggest_categories" ? existingCategories : undefined,
        mode,
      });
      setEnrichResult(result);
      if (result.success) {
        toast.success("AI đã xử lý xong");
      } else {
        toast.warning(result.qualityWarnings[0] || "AI không tạo được kết quả");
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Công cụ AI gặp lỗi, vui lòng thử lại"));
    } finally {
      setEnrichLoading(null);
    }
  }

  function applyEnrichResult() {
    if (!enrichResult) return;
    const { mode } = enrichResult;

    if (mode === "keywords" && enrichResult.keywords.length > 0) {
      const sanitized = [
        ...new Set(enrichResult.keywords.map((k) => k.trim()).filter((k) => k.length > 0 && k.length <= 50)),
      ].slice(0, 15);
      setForm((prev) => ({ ...prev, keywordsText: sanitized.join(", ") }));
      toast.success("Đã áp dụng từ khóa AI");
    } else if (mode === "short_summary" && enrichResult.shortSummary) {
      setForm((prev) => ({ ...prev, summaryVi: enrichResult.shortSummary! }));
      toast.success("Đã áp dụng tóm tắt ngắn");
    } else if (mode === "normalize_description" && enrichResult.normalizedDescription) {
      setForm((prev) => ({ ...prev, description: enrichResult.normalizedDescription! }));
      toast.success("Đã áp dụng mô tả đã chuẩn hóa");
    } else if (mode === "suggest_categories" && enrichResult.suggestedCategories.length > 0) {
      setForm((prev) => {
        const existing = prev.categoriesText.split(",").map((c) => c.trim()).filter(Boolean);
        const merged = [...new Set([...existing, ...enrichResult.suggestedCategories])];
        return { ...prev, categoriesText: merged.join(", ") };
      });
      toast.success("Đã thêm thể loại AI (merge với thể loại cũ)");
    }

    setEnrichResult(null);
  }

  function applyPostIsbnSuggestion(field: "description" | "summaryVi" | "keywords" | "categories") {
    if (!postIsbnSuggestions) return;

    if (field === "description" && postIsbnSuggestions.description) {
      setForm((prev) => ({ ...prev, description: postIsbnSuggestions.description! }));
      toast.success("Đã áp dụng mô tả AI");
    } else if (field === "summaryVi" && postIsbnSuggestions.summaryVi) {
      setForm((prev) => ({ ...prev, summaryVi: postIsbnSuggestions.summaryVi! }));
      toast.success("Đã áp dụng tóm tắt AI");
    } else if (field === "keywords" && postIsbnSuggestions.keywords.length > 0) {
      setForm((prev) => ({ ...prev, keywordsText: mergeCommaText(prev.keywordsText, postIsbnSuggestions.keywords) }));
      toast.success("Đã thêm từ khóa AI");
    } else if (field === "categories" && postIsbnSuggestions.categories.length > 0) {
      setForm((prev) => ({ ...prev, categoriesText: mergeCommaText(prev.categoriesText, postIsbnSuggestions.categories) }));
      toast.success("Đã thêm thể loại AI");
    }
  }

  function applyAllPostIsbnSuggestions() {
    if (!postIsbnSuggestions) return;
    setForm((prev) => ({
      ...prev,
      description: postIsbnSuggestions.description || prev.description,
      summaryVi: postIsbnSuggestions.summaryVi || prev.summaryVi,
      keywordsText: postIsbnSuggestions.keywords.length > 0
        ? mergeCommaText(prev.keywordsText, postIsbnSuggestions.keywords)
        : prev.keywordsText,
      categoriesText: postIsbnSuggestions.categories.length > 0
        ? mergeCommaText(prev.categoriesText, postIsbnSuggestions.categories)
        : prev.categoriesText,
    }));
    toast.success("Đã áp dụng tất cả đề xuất AI sau ISBN");
  }

  async function handleSave() {
    const normalizedIsbn = normalizeIsbnInput(form.isbn || isbnInput);
    const title = form.title.trim();
    if (!normalizedIsbn) {
      toast.error("ISBN là bắt buộc");
      return;
    }
    if (!title) {
      toast.error("Tên sách là bắt buộc");
      return;
    }
    if (duplicateMatches.length > 0 && !confirmDuplicateSave) {
      toast.error("Sách này có thể đã tồn tại trong catalog. Vui lòng xác nhận ở cảnh báo bên dưới trước khi lưu.");
      return;
    }

    const authors = form.authorsText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const categories = form.categoriesText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    setSaving(true);
    try {
      const created = await bookService.createIncomplete({
        isbn13: normalizedIsbn,
        title,
        price: 0,
        language: (form.language || "vi").trim() || "vi",
      });

      const payload = created?.data;
      if (!payload?.book_id) {
        toast.error("Không lấy được book id để cập nhật metadata");
        return;
      }

      const updatePayload: Record<string, unknown> = {
        title,
        subtitle: form.subtitle.trim() || null,
        author_name: authors[0] || null,
        publisher_name: form.publisher.trim() || null,
        category_name: categories[0] || null,
        description: form.description.trim() || null,
        summary_vi: form.summaryVi.trim() || null,
        language: (form.language || "vi").trim() || "vi",
        internal_barcode: normalizedIsbn,
      };

      const isbn13 = normalizeIsbnInput(form.isbn13 || "");
      const isbn10 = normalizeIsbnInput(form.isbn10 || "");
      if (isbn13.length === 13) updatePayload.isbn13 = isbn13;
      if (isbn10.length === 10) updatePayload.isbn10 = isbn10;

      const year = parsePublishYear(form.publishedDate);
      if (year) updatePayload.publish_year = year;

      if (form.thumbnail.trim()) updatePayload.cover_image_url = form.thumbnail.trim();

      const pageCountNum = parseInt(form.pageCount, 10);
      if (form.pageCount && !isNaN(pageCountNum) && pageCountNum > 0) {
        updatePayload.page_count = pageCountNum;
      }

      const keywords = form.keywordsText
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0 && k.length <= 50);
      const uniqueKeywords = [...new Set(keywords)].slice(0, 15);
      if (uniqueKeywords.length > 0) {
        updatePayload.keywords = uniqueKeywords;
      }

      if (reconciliationDraft) {
        await metadataIntelligenceService.applyReconciliationDraft(reconciliationDraft.id, String(payload.book_id), createAuthorityEntities);
      } else {
        await bookService.update(String(payload.book_id), updatePayload);
      }
      toast.success("Đã lưu sách với metadata ISBN");

      // Keep the local catalog snapshot in sync so the duplicate check catches
      // this book if the user immediately tries to import it again this session.
      setCatalogBooks((prev) => [
        ...prev,
        { id: String(payload.book_id), title, author: authors[0] || "", isbn: normalizedIsbn, category: categories[0] || "" },
      ]);

      setLookupData(null);
      setPostIsbnSuggestions(null);
      setReconciliationDraft(null);
      setCreateAuthorityEntities({});
      setDuplicateReview(null);
      setForm(EMPTY_FORM);
      setIsbnInput("");
      setConfirmDuplicateSave(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lưu thông tin sách thất bại"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <p className="text-[12px] font-medium uppercase text-cyan-600 dark:text-cyan-400">
          AI-assisted cataloging
        </p>
        <div className="mt-2">
          <PageHeader
            icon={Sparkles}
            title="Nhập sách qua AI"
            description="Quét mã vạch hoặc nhập ISBN để tra cứu metadata, sau đó AI tự tạo đề xuất mô tả, tóm tắt, từ khóa và thể loại cho admin duyệt."
            iconBg="bg-gradient-to-br from-cyan-100 to-violet-100 dark:from-cyan-500/15 dark:to-violet-500/15"
            iconColor="text-cyan-600 dark:text-cyan-400"
          />
        </div>
      </FadeItem>

      <FadeItem>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <SectionCard
            icon={Search}
            title="Tra cứu ISBN"
            subtitle="Sau lookup, AI hoàn thiện metadata ở dạng đề xuất để admin chọn áp dụng"
          >
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div>
                <Label htmlFor="isbnLookup" className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground">
                  ISBN hoặc barcode sách
                  <span className="text-rose-500">*</span>
                </Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-500" />
                  <Input
                    id="isbnLookup"
                    value={isbnInput}
                    onChange={(event) => setIsbnInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleLookup();
                      }
                    }}
                    placeholder="Nhập hoặc quét ISBN-10 / ISBN-13"
                    aria-required
                    className="min-h-11 border-cyan-200 bg-card pl-10 pr-4 text-[13px] font-mono tabular-nums focus-visible:border-cyan-400/70 focus-visible:ring-cyan-500/20 dark:border-cyan-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:flex">
                <button
                  type="button"
                  onClick={() => void handleLookup()}
                  disabled={lookupLoading}
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-cyan-600 px-4 text-[13px] font-semibold text-white transition-colors duration-150 hover:bg-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-500 dark:hover:bg-cyan-600"
                >
                  {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span>{lookupLoading ? lookupLoadingLabel : "Tra cứu"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  disabled={lookupLoading}
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-indigo-200 bg-indigo-50 px-4 text-[13px] font-semibold text-indigo-700 transition-colors duration-150 hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20"
                >
                  <ScanBarcode className="h-4 w-4" />
                  <span>Quét camera</span>
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-2 text-[12px] text-muted-foreground sm:grid-cols-3">
              <div className="flex items-center gap-2 rounded-[8px] bg-muted/45 px-3 py-2">
                <Search className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                Lookup metadata hiện có
              </div>
              <div className="flex items-center gap-2 rounded-[8px] bg-muted/45 px-3 py-2">
                <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                AI tạo đề xuất hậu xử lý
              </div>
              <div className="flex items-center gap-2 rounded-[8px] bg-muted/45 px-3 py-2">
                <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Admin duyệt trước khi lưu
              </div>
            </div>
          </SectionCard>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-foreground">Luồng nhập hiện tại</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">ISBN-first, AI hỗ trợ sau lookup</p>
              </div>
              <StatusBadge
                label={lookupLoading ? lookupLoadingLabel : lookupData ? "Đang review" : "Sẵn sàng"}
                variant={lookupLoading ? "info" : lookupData ? "success" : "neutral"}
                dot
              />
            </div>
            <WorkflowStepper steps={steps} orientation="vertical" compact />
          </div>
        </div>
      </FadeItem>

      {lookupLoading ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          <LookupSkeleton />
        </motion.div>
      ) : lookupData ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <SectionCard
              icon={BookCheck}
              title={lookupData.found ? "Đã tìm thấy metadata" : "Không tìm thấy metadata"}
              subtitle="Kiểm tra và chỉnh sửa thông tin trước khi lưu vào kho"
              actions={
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <StatusBadge label={`Đủ ${completeSignalCount}/4 mục`} variant={completeSignalCount === 4 ? "success" : "warning"} />
                  <StatusBadge label={`Tin cậy ${confidenceText}`} variant={confidenceVariant} dot />
                  {sourceBadges.length > 0
                    ? sourceBadges.map((s) => <StatusBadge key={s.key} label={s.label} variant={s.variant} />)
                    : <StatusBadge label="Thủ công" variant="neutral" />}
                </div>
              }
            >
              {lookupData.found ? <MetadataFoundHero lookup={lookupData} form={form} completeSignalCount={completeSignalCount} /> : null}

              {manualMode ? (
                <div className="mb-4 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                  Không tìm thấy metadata từ nhà cung cấp. Vui lòng nhập tay thông tin sách, ISBN đã được giữ lại.
                </div>
              ) : null}

              {lookupData?.reason === "barcode is not a valid ISBN but marketplace lookup attempted" ? (
                <div className="mb-4 rounded-[10px] border border-yellow-200 bg-yellow-50 px-3 py-2 text-[12px] text-yellow-700 dark:border-yellow-500/20 dark:bg-yellow-500/10 dark:text-yellow-300">
                  Mã quét có thể là barcode bán lẻ, không phải ISBN chuẩn. Kết quả được tìm từ nhà sách trực tuyến.
                </div>
              ) : null}

              <IsbnIntelligencePanel lookup={lookupData} />
              {reconciliationDraft ? <AuthorityReviewPanel draft={reconciliationDraft} onDecision={(field, status) => void handleAuthorityDecision(field, status)} onCreateEntity={handleCreateAuthorityEntity} /> : null}
              {duplicateReview ? <DuplicateReviewPanel review={duplicateReview} onAction={(action, candidate) => void handleDuplicateAction(action, candidate)} /> : null}

              <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Tình trạng metadata trước khi lưu">
                {reviewSignals.map((signal) => (
                  <ReviewSignal key={signal.label} {...signal} />
                ))}
              </div>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                {/* Cover preview + live caption */}
                <div className="mx-auto w-full max-w-[220px] space-y-3 lg:mx-0">
                  <motion.div
                    key={form.thumbnail}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className="aspect-[3/4] overflow-hidden rounded-[10px] border border-border shadow-sm"
                  >
                    <CoverPreview key={form.thumbnail} src={form.thumbnail} alt={form.title ? `Bìa sách ${form.title}` : "Ảnh bìa sách"} />
                  </motion.div>
                  <div className="text-center lg:text-left">
                    <p className="line-clamp-2 text-[13px] font-semibold text-foreground">{form.title || "Chưa có tên sách"}</p>
                    {form.authorsText && <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{form.authorsText}</p>}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-[8px] bg-muted/45 px-2.5 py-2">
                      <span className="text-muted-foreground">Đề xuất AI</span>
                      <p className="mt-0.5 font-semibold text-foreground">{aiSuggestionCount}</p>
                    </div>
                    <div className="rounded-[8px] bg-muted/45 px-2.5 py-2">
                      <span className="text-muted-foreground">Duplicate</span>
                      <p className={`mt-0.5 font-semibold ${duplicateMatches.length ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                        {duplicateMatches.length ? `${duplicateMatches.length} cảnh báo` : "Chưa thấy"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Editable short fields */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="isbn" label="ISBN" mono required value={form.isbn} onChange={(v) => setForm((prev) => ({ ...prev, isbn: v }))} />
                  <Field id="title" label="Tên sách" required value={form.title} onChange={(v) => setForm((prev) => ({ ...prev, title: v }))} />
                  <Field id="subtitle" label="Tựa phụ" value={form.subtitle} onChange={(v) => setForm((prev) => ({ ...prev, subtitle: v }))} />
                  <Field id="authors" label="Tác giả (cách nhau dấu phẩy)" value={form.authorsText} onChange={(v) => setForm((prev) => ({ ...prev, authorsText: v }))} />
                  <Field id="publisher" label="Nhà xuất bản" value={form.publisher} onChange={(v) => setForm((prev) => ({ ...prev, publisher: v }))} />
                  <Field id="publishedDate" label="Ngày xuất bản" value={form.publishedDate} onChange={(v) => setForm((prev) => ({ ...prev, publishedDate: v }))} />
                  <Field id="categories" label="Thể loại (cách nhau dấu phẩy)" value={form.categoriesText} onChange={(v) => setForm((prev) => ({ ...prev, categoriesText: v }))} />
                  <Field id="language" label="Ngôn ngữ" value={form.language} onChange={(v) => setForm((prev) => ({ ...prev, language: v }))} />
                  <Field id="isbn13" label="ISBN13" mono value={form.isbn13} onChange={(v) => setForm((prev) => ({ ...prev, isbn13: v }))} />
                  <Field id="isbn10" label="ISBN10" mono value={form.isbn10} onChange={(v) => setForm((prev) => ({ ...prev, isbn10: v }))} />
                  <Field id="pageCount" label="Số trang" value={form.pageCount} onChange={(v) => setForm((prev) => ({ ...prev, pageCount: v }))} />
                  <Field id="thumbnail" label="URL ảnh bìa" value={form.thumbnail} onChange={(v) => setForm((prev) => ({ ...prev, thumbnail: v }))} />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3">
                <div>
                  <Label htmlFor="description" className="mb-1.5 text-[11px] font-semibold uppercase text-muted-foreground">Mô tả</Label>
                  <Textarea id="description" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} rows={4} />
                </div>
                <div>
                  <Label htmlFor="summaryVi" className="mb-1.5 text-[11px] font-semibold uppercase text-muted-foreground">Tóm tắt ngắn (summary_vi)</Label>
                  <Textarea
                    id="summaryVi"
                    value={form.summaryVi}
                    onChange={(e) => setForm((prev) => ({ ...prev, summaryVi: e.target.value }))}
                    rows={2}
                    placeholder="Tóm tắt 2-3 câu dùng cho AI chatbot..."
                  />
                </div>
                <Field id="keywords" label="Từ khóa (cách nhau dấu phẩy)" value={form.keywordsText} onChange={(v) => setForm((prev) => ({ ...prev, keywordsText: v }))} />

                {form.title.trim() && (
                  <div
                    role="region"
                    aria-labelledby="ai-tools-title"
                    className="rounded-[12px] border border-violet-200/80 bg-violet-50/35 p-4 dark:border-violet-500/20 dark:bg-violet-500/5"
                  >
                    <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-violet-100 dark:bg-violet-500/15">
                          <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                        </div>
                        <div className="min-w-0">
                          <h3 id="ai-tools-title" className="text-[12px] font-semibold uppercase text-violet-700 dark:text-violet-300">
                            Công cụ AI
                          </h3>
                          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
                            Các nút bên dưới chỉ tạo đề xuất. Form chỉ thay đổi khi bạn bấm áp dụng.
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge label={`${aiSuggestionCount} đề xuất chờ duyệt`} variant={aiSuggestionCount ? "violet" : "neutral"} />
                        {hasPostIsbnSuggestions && postIsbnSuggestions ? (
                          <>
                            <StatusBadge label={postIsbnSuggestions.provider === "none" ? "AI không khả dụng" : postIsbnSuggestions.provider} variant={postIsbnSuggestions.provider === "none" ? "neutral" : "violet"} dot />
                            <StatusBadge label={`Tin cậy ${Math.round((postIsbnSuggestions.confidence || 0) * 100)}%`} variant={postIsbnSuggestions.confidence >= 0.7 ? "success" : postIsbnSuggestions.confidence > 0 ? "warning" : "neutral"} />
                          </>
                        ) : null}
                      </div>
                    </div>

                    {!form.description.trim() ? (
                      <AiToolButton
                        label="Tạo mô tả AI"
                        loading={summaryLoading}
                        disabled={summaryLoading}
                        onClick={() => void handleGenerateDescription()}
                      />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            { mode: "keywords" as const, label: "Tạo từ khóa AI" },
                            { mode: "short_summary" as const, label: "Tóm tắt ngắn AI" },
                            { mode: "normalize_description" as const, label: "Chuẩn hóa mô tả AI" },
                            { mode: "suggest_categories" as const, label: "Gợi ý thể loại AI" },
                            { mode: "quality_check" as const, label: "Kiểm tra chất lượng" },
                          ] as const
                        ).map(({ mode, label }) => (
                          <AiToolButton
                            key={mode}
                            label={label}
                            loading={enrichLoading === mode}
                            disabled={!!enrichLoading || summaryLoading}
                            onClick={() => void handleEnrichMetadata(mode)}
                          />
                        ))}
                      </div>
                    )}

                    {hasPostIsbnSuggestions && postIsbnSuggestions ? (
                      <div className="mt-4 border-t border-violet-200/70 pt-4 dark:border-violet-500/20">
                        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-[12px] font-semibold text-foreground">Đề xuất AI sau ISBN</p>
                            <p className="mt-0.5 text-[12px] text-muted-foreground">
                              Chọn từng mục hoặc áp dụng tất cả nếu nội dung phù hợp với sách.
                            </p>
                          </div>
                          {(postIsbnSuggestions.description || postIsbnSuggestions.summaryVi || postIsbnSuggestions.keywords.length > 0 || postIsbnSuggestions.categories.length > 0) ? (
                            <button
                              type="button"
                              onClick={applyAllPostIsbnSuggestions}
                              className="inline-flex min-h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] bg-violet-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:bg-violet-500 dark:hover:bg-violet-600"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              Áp dụng tất cả
                            </button>
                          ) : null}
                        </div>

                        {postIsbnSuggestions.qualityWarnings.length > 0 ? (
                          <div className="mb-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
                            <div className="mb-1 flex items-center gap-2 font-semibold">
                              <AlertTriangle className="h-4 w-4" />
                              Cảnh báo chất lượng metadata
                            </div>
                            <ul className="list-disc space-y-0.5 pl-5">
                              {postIsbnSuggestions.qualityWarnings.map((warning, index) => (
                                <li key={`${warning}-${index}`}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                          <AiSuggestionRow
                            title="Mô tả đã chuẩn hóa"
                            value={postIsbnSuggestions.description || ""}
                            onApply={() => applyPostIsbnSuggestion("description")}
                            icon={FileText}
                          />
                          <AiSuggestionRow
                            title="Tóm tắt ngắn cho chatbot"
                            value={postIsbnSuggestions.summaryVi || ""}
                            onApply={() => applyPostIsbnSuggestion("summaryVi")}
                            icon={ClipboardCheck}
                          />
                          <AiSuggestionRow
                            title="Từ khóa tìm kiếm"
                            value={postIsbnSuggestions.keywords.join(", ")}
                            onApply={() => applyPostIsbnSuggestion("keywords")}
                            icon={Hash}
                          />
                          <AiSuggestionRow
                            title="Thể loại phù hợp"
                            value={postIsbnSuggestions.categories.join(", ")}
                            onApply={() => applyPostIsbnSuggestion("categories")}
                            icon={Tags}
                          />
                        </div>
                      </div>
                    ) : null}

                    {enrichResult && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18 }}
                        className="mt-3 rounded-[10px] border border-violet-200 bg-card p-3 text-[12px] dark:border-violet-500/20"
                      >
                        <div className="mb-2 font-semibold text-violet-700 dark:text-violet-400">
                          Kết quả AI{enrichResult.ai_provider !== "none" ? ` (${enrichResult.ai_provider})` : ""}
                        </div>

                        {enrichResult.mode === "keywords" && enrichResult.keywords.length > 0 && (
                          <p className="mb-2 text-foreground">Từ khóa: {enrichResult.keywords.join(", ")}</p>
                        )}
                        {enrichResult.mode === "short_summary" && enrichResult.shortSummary && (
                          <p className="mb-2 text-foreground">{enrichResult.shortSummary}</p>
                        )}
                        {enrichResult.mode === "normalize_description" && enrichResult.normalizedDescription && (
                          <p className="mb-2 whitespace-pre-wrap text-foreground">{enrichResult.normalizedDescription}</p>
                        )}
                        {enrichResult.mode === "suggest_categories" && enrichResult.suggestedCategories.length > 0 && (
                          <p className="mb-2 text-foreground">
                            Thể loại gợi ý: {enrichResult.suggestedCategories.join(", ")}
                            <span className="ml-1 text-muted-foreground">(sẽ merge với thể loại cũ)</span>
                          </p>
                        )}
                        {enrichResult.mode === "quality_check" && (
                          enrichResult.qualityWarnings.length === 0
                            ? (
                              <p className="mb-2 flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-4 w-4" />
                                Metadata đạt chất lượng tốt
                              </p>
                            )
                            : (
                              <ul className="mb-2 list-disc space-y-0.5 pl-4 text-amber-700 dark:text-amber-400">
                                {enrichResult.qualityWarnings.map((w, i) => <li key={i}>{w}</li>)}
                              </ul>
                            )
                        )}
                        {!enrichResult.success && enrichResult.qualityWarnings.length > 0 && enrichResult.mode !== "quality_check" && (
                          <p className="mb-2 text-red-600 dark:text-red-400">{enrichResult.qualityWarnings[0]}</p>
                        )}

                        <div className="flex gap-2">
                          {enrichResult.mode !== "quality_check" && enrichResult.success && (
                            <button
                              type="button"
                              onClick={applyEnrichResult}
                              className="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-[8px] bg-violet-600 px-3 text-[11px] font-semibold text-white hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:bg-violet-500 dark:hover:bg-violet-600"
                            >
                              Áp dụng
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setEnrichResult(null)}
                            className="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-[8px] border border-border px-3 text-[11px] font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 dark:text-slate-400"
                          >
                            Đóng
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>

              {duplicateMatches.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                  className="mt-4 rounded-[10px] border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="flex-1">
                      <p className="text-[12px] font-semibold text-amber-800 dark:text-amber-300">
                        Có thể sách này đã tồn tại trong catalog
                      </p>
                      <ul className="mt-1 space-y-0.5 text-[12px] text-amber-700 dark:text-amber-400">
                        {duplicateMatches.slice(0, 5).map((match) => (
                          <li key={match.book.id}>
                            <span className="font-medium">{match.book.title}</span>
                            {match.book.author ? ` — ${match.book.author}` : ""}
                            {match.book.isbn ? ` (ISBN ${match.book.isbn})` : ""}
                            {match.reason === "isbn" ? " · trùng ISBN" : " · trùng tên sách"}
                          </li>
                        ))}
                      </ul>
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] text-amber-800 dark:text-amber-300">
                        <input
                          type="checkbox"
                          checked={confirmDuplicateSave}
                          onChange={(event) => setConfirmDuplicateSave(event.target.checked)}
                          className="h-3.5 w-3.5 cursor-pointer accent-amber-600"
                        />
                        Tôi xác nhận đây vẫn là bản sách cần lưu (vd bản khác, đợt nhập khác)
                      </label>
                    </div>
                  </div>
                </motion.div>
              )}

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setLookupData(null);
                    setPostIsbnSuggestions(null);
                    setForm(EMPTY_FORM);
                    setIsbnInput("");
                  }}
                  disabled={saving}
                  className="cursor-pointer rounded-[10px] border border-border bg-card px-4 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Đặt lại
                </button>
                <button
                  onClick={() => void handleSave()}
                  disabled={saving || (duplicateMatches.length > 0 && !confirmDuplicateSave)}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-[10px] bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-[13px] font-semibold text-white transition-transform duration-150 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookCheck className="h-4 w-4" />}
                  {saving ? "Đang lưu" : "Lưu sách"}
                </button>
              </div>
            </SectionCard>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden rounded-xl border border-dashed border-cyan-200 bg-gradient-to-br from-cyan-50/50 via-card to-violet-50/50 p-8 text-center dark:border-cyan-500/20 dark:from-cyan-500/5 dark:via-card dark:to-violet-500/5"
          >
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-200/60 bg-card shadow-sm dark:border-cyan-500/20">
              <BookOpen className="h-7 w-7 text-cyan-500" />
            </div>
            <h3 className="text-[15px] font-semibold text-foreground">Sẵn sàng nhập sách mới</h3>
            <p className="mx-auto mt-1.5 max-w-md text-[13px] text-muted-foreground">
              Quét mã vạch hoặc nhập ISBN ở trên — hệ thống sẽ tra cứu metadata và AI sẽ tạo đề xuất để bạn duyệt.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {[
                { icon: Sparkles, text: "Tự động điền metadata" },
                { icon: ScanBarcode, text: "Quét camera trực tiếp" },
                { icon: BookCheck, text: "Chỉnh sửa trước khi lưu" },
              ].map(({ icon: Icon, text }) => (
                <span
                  key={text}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-medium text-muted-foreground"
                >
                  <Icon className="h-3.5 w-3.5 text-cyan-500" />
                  {text}
                </span>
              ))}
            </div>
          </motion.div>
      )}

      <BarcodeScanModal
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onDetected={(code) => {
          setShowScanner(false);
          setIsbnInput(code);
          void handleLookup(code);
        }}
        title="Quét ISBN"
      />
    </PageWrapper>
  );
}
