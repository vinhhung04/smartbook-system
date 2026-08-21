import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  BadgeCheck,
  BookCheck,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Hash,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { aiService, type LookupBookByIsbnResponse, type EnrichBookMetadataResponse, type EnrichMode, type PostIsbnAiSuggestions } from "@/services/ai";
import { bookService } from "@/services/book";
import { metadataIntelligenceService, type DuplicateDecisionResult, type DuplicateReview, type FinalMetadata, type ReconciliationDraft } from "@/services/metadata-intelligence";
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

function splitCommaValues(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function buildDuplicateCheckMetadata({ lookup, normalizedMetadata, form }: { lookup: LookupBookByIsbnResponse; normalizedMetadata: Record<string, unknown>; form: EditableBookForm }): Record<string, unknown> {
  const pick = (formValue: string, normalizedKey: string, lookupValue: unknown) => formValue.trim() || normalizedMetadata[normalizedKey] || lookupValue || undefined;
  const isbn13 = normalizeIsbnInput(form.isbn13 || "");
  const isbn10 = normalizeIsbnInput(form.isbn10 || "");
  const isbn = normalizeIsbnInput(form.isbn || "") || (isbn13.length === 13 ? isbn13 : isbn10);
  return {
    isbn,
    isbn13: isbn13.length === 13 ? isbn13 : normalizeIsbnInput(String(normalizedMetadata.isbn13 || lookup.isbn13 || "")),
    isbn10: isbn10.length === 10 ? isbn10 : normalizeIsbnInput(String(normalizedMetadata.isbn10 || lookup.isbn10 || "")),
    barcode: normalizeIsbnInput(form.isbn) || String(normalizedMetadata.barcode || normalizedMetadata.internal_barcode || lookup.isbn || ""),
    internal_barcode: normalizeIsbnInput(form.isbn) || String(normalizedMetadata.internalBarcode || normalizedMetadata.internal_barcode || lookup.isbn || ""),
    title: pick(form.title, "title", lookup.title),
    authors: splitCommaValues(form.authorsText).length ? splitCommaValues(form.authorsText) : normalizedMetadata.authors || lookup.authors || [],
    publisher: pick(form.publisher, "publisher", lookup.publisher),
    categories: splitCommaValues(form.categoriesText).length ? splitCommaValues(form.categoriesText) : normalizedMetadata.categories || lookup.categories || [],
    language: pick(form.language, "language", lookup.language),
    publishedDate: pick(form.publishedDate, "publishedDate", lookup.publishedDate),
    pageCount: form.pageCount.trim() ? Number(form.pageCount) : normalizedMetadata.pageCount || lookup.pageCount,
    coverFormat: normalizedMetadata.coverFormat,
  };
}

function reconciliationValueFromForm(field: string, form: EditableBookForm): unknown {
  switch (field) {
    case "title": return form.title.trim();
    case "authors": return splitCommaValues(form.authorsText);
    case "publisher": return form.publisher.trim();
    case "categories": return splitCommaValues(form.categoriesText);
    case "language": return form.language.trim();
    case "publishedDate": return form.publishedDate.trim() || null;
    case "pageCount": return form.pageCount.trim() ? Number(form.pageCount) : null;
    case "description": return form.description.trim() || null;
    default: return undefined;
  }
}

function finalMetadataFromForm(form: EditableBookForm): FinalMetadata {
  const isbn13 = normalizeIsbnInput(form.isbn13 || form.isbn);
  const isbn10 = normalizeIsbnInput(form.isbn10 || "");
  const keywords = [...new Set(splitCommaValues(form.keywordsText).filter((item) => item.length <= 50))].slice(0, 15);
  return {
    title: form.title.trim(), subtitle: form.subtitle.trim() || null, description: form.description.trim() || null,
    summaryVi: form.summaryVi.trim() || null, language: form.language.trim() || "vi",
    ...(isbn13.length === 13 ? { isbn13 } : {}), ...(isbn10.length === 10 ? { isbn10 } : {}),
    internalBarcode: normalizeIsbnInput(form.isbn || "") || null, publishYear: parsePublishYear(form.publishedDate),
    pageCount: form.pageCount.trim() ? Number(form.pageCount) : null, coverImageUrl: form.thumbnail.trim() || null, keywords,
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
      <Label htmlFor={id} className="mb-2 flex items-center gap-1 text-[12px] font-semibold text-foreground">
        {label}
        {required ? <span className="text-rose-500">*</span> : null}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-required={required || undefined}
        className={`${mono ? "font-mono tabular-nums" : ""} min-h-11 border-border/80 bg-muted/[0.12] text-[14px] shadow-none transition-colors focus-visible:bg-card`.trim()}
      />
    </div>
  );
}

/** Book cover preview with graceful fallback. Remount via `key` when the URL changes. */
function CoverPreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-cyan-600 dark:text-cyan-400">
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
    <div className="flex min-h-[72px] items-start gap-2.5 rounded-lg border border-border/80 bg-card px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
      <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${complete ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">{label}<span className={`text-[10px] font-medium ${complete ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{complete ? "Sẵn sàng" : "Cần xem"}</span></div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

type ReviewSignalData = {
  label: string;
  detail: string;
  complete: boolean;
  fieldId: string;
};

function MetadataReadiness({
  signals,
  onFocusField,
}: {
  signals: ReviewSignalData[];
  onFocusField: (fieldId: string) => void;
}) {
  const incomplete = signals.filter((signal) => !signal.complete);
  if (incomplete.length === 0) {
    return (
      <div className="flex items-center gap-2 border-y border-emerald-200/80 py-3 text-[14px] text-emerald-800 dark:border-emerald-500/20 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">Metadata cốt lõi đã sẵn sàng để lưu.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-y border-amber-200/80 py-3 sm:flex-row sm:items-center dark:border-amber-500/20">
      <div className="flex items-center gap-2 text-[14px] text-amber-900 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-medium">Cần bổ sung trước khi lưu:</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {incomplete.map((signal) => (
          <button
            key={signal.label}
            type="button"
            onClick={() => onFocusField(signal.fieldId)}
            className="cursor-pointer text-left text-[13px] font-medium text-amber-800 underline decoration-amber-400 underline-offset-4 transition-colors hover:text-amber-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 dark:text-amber-300 dark:hover:text-amber-100"
          >
            {signal.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ReviewQueueItem({
  id,
  title,
  description,
  status,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  description: string;
  status: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <section className="border-b border-border last:border-b-0" aria-labelledby={`${id}-title`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-content`}
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 py-3 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
      >
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-title`} className="text-[14px] font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
        </div>
        {status}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={`${id}-content`}
            initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}
            className="pb-4"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function ReviewDisclosure({
  id,
  title,
  description,
  badge,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  description: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen]);

  return (
    <section className="group overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-shadow hover:shadow-[0_4px_16px_rgba(15,23,42,0.05)] dark:shadow-none">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
      >
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
        </div>
        {badge}
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            id={id}
            initial={shouldReduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}
            className="border-t border-border/80 bg-muted/[0.12] px-4 py-4"
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
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
      className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-violet-200 bg-card px-3 py-1.5 text-[11px] font-semibold text-violet-700 transition-[background-color,border-color,transform] duration-150 hover:border-violet-300 hover:bg-violet-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 dark:border-violet-500/20 dark:text-violet-400 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/10"
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
  index = 0,
}: {
  title: string;
  value: string;
  onApply: () => void;
  icon: LucideIcon;
  index?: number;
}) {
  const shouldReduceMotion = useReducedMotion();
  if (!value.trim()) return null;
  return (
    <motion.div
      initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: shouldReduceMotion ? 0 : 0.2, delay: shouldReduceMotion ? 0 : index * 0.05, ease: "easeOut" }}
      className="py-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-foreground">{title}</div>
            <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[13px] leading-5 text-muted-foreground">{value}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onApply}
          className="inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-violet-200 bg-violet-50 px-3.5 text-[12px] font-semibold text-violet-700 transition-[background-color,transform] duration-150 hover:bg-violet-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/20"
        >
          Áp dụng
        </button>
      </div>
    </motion.div>
  );
}

function displayEvidenceValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null || value === undefined || value === "") return "–";
  return String(value);
}

const REVIEW_FIELD_LABELS: Record<string, string> = {
  title: "Tên sách",
  authors: "Tác giả",
  publisher: "Nhà xuất bản",
  publishedDate: "Ngày xuất bản",
  categories: "Thể loại",
  isbn: "ISBN",
};

function formatQualityWarning(warning: string): string {
  const [code, field] = warning.split(":");
  if (code === "SOURCE_CONFLICT" && field) {
    return `Xung đột nguồn: ${REVIEW_FIELD_LABELS[field] || field}`;
  }
  return warning.replace(/_/g, " ").toLowerCase().replace(/^./, (value: string) => value.toUpperCase());
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
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300"><BadgeCheck className="h-4 w-4" aria-hidden="true" />Đã tìm thấy metadata</span>
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
    <section className="space-y-3" aria-label={t("isbn_intelligence.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">{t("isbn_intelligence.title")}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {t("isbn_intelligence.quality")} {Math.round((lookup.metadataQualityScore || 0) * 100)}% · {t("isbn_intelligence.processing")} {lookup.processingTimeMs ?? 0} ms
          </p>
        </div>
        {conflicts.length > 0 ? <StatusBadge label={`${conflicts.length} ${t("isbn_intelligence.conflicts")}`} variant="warning" /> : null}
      </div>

      {conflicts.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />{t("isbn_intelligence.conflict_warning")}</div>
          {conflicts.map((conflict) => <p key={conflict.field} className="mt-1">{conflict.field}: {displayEvidenceValue(conflict.selectedValue)} · {conflict.alternatives.map((item) => `${item.source}: ${displayEvidenceValue(item.value)}`).join(" | ")}</p>)}
        </div>
      ) : null}

      <details className="rounded-md border border-border bg-muted/[0.12] px-3 py-2.5">
        <summary className="cursor-pointer text-[13px] font-semibold text-foreground marker:text-cyan-500">{t("isbn_intelligence.evidence")}</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {evidence.map(([field, item]) => (
            <div key={field} className="rounded-md border border-border bg-card px-3 py-2.5 text-[13px]">
              <p className="font-semibold text-foreground">{field} <span className="font-normal text-muted-foreground">· {Math.round((lookup.fieldConfidence?.[field] || 0) * 100)}%</span></p>
              <p className="mt-0.5 text-muted-foreground">{displayEvidenceValue(item.selectedValue)}</p>
              <p className="mt-1 text-cyan-700 dark:text-cyan-300">{t("isbn_intelligence.confirmed_by")}: {item.confirmations.map((confirmation) => confirmation.source).join(", ")}</p>
            </div>
          ))}
        </div>
      </details>

      <details className="rounded-md border border-border bg-muted/[0.12] px-3 py-2.5">
        <summary className="cursor-pointer text-[13px] font-semibold text-foreground marker:text-cyan-500">{t("isbn_intelligence.sources")}</summary>
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
    <section aria-label={t("metadata_reconciliation.title")}>
      <p className="mb-2 text-[13px] leading-5 text-muted-foreground">{t("metadata_reconciliation.hint")}</p>
      <div className="divide-y divide-border border-y border-border">
        {rows.map((row) => {
          const decision = draft.decisions.find((item) => item.field === row.field)?.status || "PENDING";
          return (
            <div key={row.field} className="py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[14px] font-semibold text-foreground">{row.label}</h4>
                    <StatusBadge label={decision === "PENDING" ? "Chờ duyệt" : decision === "ACCEPTED" ? "Đã chấp nhận" : "Đã từ chối"} variant={decision === "PENDING" ? "warning" : decision === "ACCEPTED" ? "success" : "neutral"} />
                  </div>
                  <div className="mt-3 space-y-3">
                    {row.items.map((item) => (
                      <div key={`${item.rawValue}-${item.normalizedValue}`} className="grid gap-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dữ liệu gốc</p>
                          <p className="mt-0.5 truncate font-medium text-foreground">{item.rawValue}</p>
                        </div>
                        <span className="hidden text-muted-foreground sm:block" aria-hidden="true">→</span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Đề xuất chuẩn hóa</p>
                          <p className="mt-0.5 truncate font-medium text-foreground">{item.normalizedValue}</p>
                        </div>
                        <p className="text-[12px] text-muted-foreground sm:col-span-3">
                          {item.matchedEntity?.name || t("metadata_reconciliation.new_entity")} · Tin cậy {Math.round(item.confidence * 100)}%
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                {decision === "PENDING" ? <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" onClick={() => onDecision(row.field, "ACCEPTED")} className="min-h-10 cursor-pointer rounded-md border border-emerald-200 bg-emerald-50 px-3 text-[12px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">{t("metadata_reconciliation.accept")}</button>
                  <button type="button" onClick={() => onDecision(row.field, "REJECTED")} className="min-h-10 cursor-pointer rounded-md border border-border bg-card px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30">{t("metadata_reconciliation.reject")}</button>
                  {row.items.some((item) => item.status === "NEW_ENTITY") ? <button type="button" onClick={() => onCreateEntity(row.field)} className="min-h-10 cursor-pointer rounded-md border border-cyan-200 bg-cyan-50 px-3 text-[12px] font-semibold text-cyan-700 transition-colors hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("metadata_reconciliation.create_entity")}</button> : null}
                </div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {draft.qualityWarnings.length ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Cảnh báo chất lượng">
          {draft.qualityWarnings.map((warning) => (
            <li key={warning} className="rounded-full bg-amber-50 px-2.5 py-1 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              {formatQualityWarning(warning)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DuplicateReviewPanel({ review, onAction }: { review: DuplicateReview; onAction: (action: string, candidate?: DuplicateReview["candidates"][number]) => void }) {
  const { t } = useI18n();
  const isNew = review.classification === "NEW_TITLE";
  return (
    <section className="space-y-3" aria-label={t("duplicate_intelligence.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] text-muted-foreground">{review.classification} · {Math.round(review.similarityScore * 100)}%</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {review.classification === "EXACT_DUPLICATE" && review.candidates[0] ? <button type="button" onClick={() => onAction("LINK_EXISTING_VARIANT", review.candidates[0])} className="min-h-9 rounded-md border border-cyan-200 bg-cyan-50 px-3 text-[12px] font-semibold text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("duplicate_intelligence.link_variant")}</button> : null}
          {review.classification === "SAME_EDITION" && review.candidates[0] ? <button type="button" onClick={() => onAction("CREATE_VARIANT_FOR_EDITION", review.candidates[0])} className="min-h-9 rounded-md border border-cyan-200 bg-cyan-50 px-3 text-[12px] font-semibold text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("duplicate_intelligence.create_variant")}</button> : null}
          {review.classification === "SAME_WORK_DIFFERENT_EDITION" && review.candidates[0] ? <button type="button" onClick={() => onAction("CREATE_NEW_EDITION", review.candidates[0])} className="min-h-9 rounded-md border border-cyan-200 bg-cyan-50 px-3 text-[12px] font-semibold text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("duplicate_intelligence.create_edition")}</button> : null}
          {isNew ? <button type="button" onClick={() => onAction("CREATE_NEW_TITLE")} className="min-h-9 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">{t("duplicate_intelligence.create_title")}</button> : <button type="button" onClick={() => onAction("DISMISS_WARNING")} className="min-h-9 rounded-md border border-border bg-card px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30">{t("duplicate_intelligence.dismiss")}</button>}
        </div>
      </div>
      <p className="text-[13px] leading-5 text-muted-foreground">{review.explanation.join(" ")}</p>
      {review.candidates.length ? <ul className="space-y-1.5" role="list">{review.candidates.slice(0, 3).map((candidate) => <li key={candidate.bookId} className="rounded-md border border-border bg-muted/[0.1] px-3 py-2.5 text-[13px]"><span className="font-semibold text-foreground">{candidate.title}</span> · {candidate.classification} · {Math.round(candidate.score * 100)}%</li>)}</ul> : null}
    </section>
  );
}

function CatalogDuplicateWarning({
  matches,
  confirmed,
  onConfirm,
}: {
  matches: DuplicateMatch[];
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
}) {
  if (!matches.length) return null;
  return (
    <section className="mt-6 border-y border-amber-200/80 py-4 dark:border-amber-500/20" aria-labelledby="catalog-duplicate-title">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id="catalog-duplicate-title" className="text-[14px] font-semibold text-foreground">Xác nhận trùng catalog</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">Các bản ghi sau có thể là cùng sách hoặc cùng ISBN.</p>
          <ul className="mt-3 divide-y divide-border border-y border-border text-[13px]" role="list">
            {matches.slice(0, 5).map((match) => (
              <li key={match.book.id} className="py-2.5">
                <span className="font-medium text-foreground">{match.book.title}</span>
                {match.book.author ? ` — ${match.book.author}` : ""}
                {match.book.isbn ? ` · ISBN ${match.book.isbn}` : ""}
                <span className="ml-1 text-muted-foreground">· {match.reason === "isbn" ? "trùng ISBN" : "trùng tên sách"}</span>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => onConfirm(event.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-amber-600"
            />
            <span>Tôi xác nhận đây vẫn là bản sách cần lưu, ví dụ một ấn bản hoặc đợt nhập khác.</span>
          </label>
        </div>
      </div>
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
  const shouldReduceMotion = useReducedMotion();
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
  const [duplicateDecisionResult, setDuplicateDecisionResult] = useState<DuplicateDecisionResult | null>(null);
  const [form, setForm] = useState<EditableBookForm>(EMPTY_FORM);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState<EnrichMode | null>(null);
  const [enrichResult, setEnrichResult] = useState<EnrichBookMetadataResponse | null>(null);

  const [catalogBooks, setCatalogBooks] = useState<CatalogBookLite[]>([]);
  const [confirmDuplicateSave, setConfirmDuplicateSave] = useState(false);
  const [activeReviewId, setActiveReviewId] = useState<"duplicate" | "authority" | "evidence" | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"book" | "review" | "ai">("book");
  const initializedTabForLookup = useRef<LookupBookByIsbnResponse | null>(null);

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
        fieldId: "isbn",
      },
      {
        label: "Nhan đề",
        detail: hasTitle ? "Đã có tên sách để catalog" : "Cần tên sách trước khi lưu",
        complete: hasTitle,
        fieldId: "title",
      },
      {
        label: "Tác giả",
        detail: hasAuthor ? "Có dữ liệu tác giả để tìm kiếm" : "Nên bổ sung tác giả nếu lookup thiếu",
        complete: hasAuthor,
        fieldId: "authors",
      },
      {
        label: "Mô tả",
        detail: hasDescription ? "Có mô tả hoặc đề xuất AI chờ duyệt" : "Có thể dùng AI để tạo mô tả",
        complete: hasDescription,
        fieldId: "description",
      },
    ];
  }, [form.authorsText, form.description, form.isbn, form.isbn10, form.isbn13, form.title, postIsbnSuggestions?.description]);
  const completeSignalCount = reviewSignals.filter((signal) => signal.complete).length;
  const authorityNeedsReview = Boolean(
    reconciliationDraft
      && (reconciliationDraft.decisions.length === 0 || reconciliationDraft.decisions.some((item) => item.status === "PENDING")),
  );
  const duplicateNeedsReview = Boolean(duplicateReview && duplicateReview.classification !== "NEW_TITLE");
  const evidenceNeedsReview = Boolean(lookupData?.conflicts?.length);
  const catalogDuplicateNeedsReview = duplicateMatches.length > 0 && !confirmDuplicateSave;
  const reviewIssueCount = [duplicateNeedsReview, authorityNeedsReview, evidenceNeedsReview, catalogDuplicateNeedsReview].filter(Boolean).length;

  useEffect(() => {
    if (duplicateNeedsReview) {
      setActiveReviewId("duplicate");
      return;
    }
    if (authorityNeedsReview) {
      setActiveReviewId("authority");
      return;
    }
    if (evidenceNeedsReview) {
      setActiveReviewId("evidence");
      return;
    }
    setActiveReviewId(null);
  }, [duplicateNeedsReview, authorityNeedsReview, evidenceNeedsReview, lookupData?.isbn]);

  useEffect(() => {
    if (!lookupData) {
      initializedTabForLookup.current = null;
      setActiveWorkspaceTab("book");
      return;
    }
    if (initializedTabForLookup.current === lookupData) return;
    initializedTabForLookup.current = lookupData;
    setActiveWorkspaceTab(reviewIssueCount > 0 ? "review" : "book");
  }, [lookupData, reviewIssueCount]);

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
    setDuplicateDecisionResult(null);
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
          const duplicate = await metadataIntelligenceService.checkDuplicate(buildDuplicateCheckMetadata({ lookup, normalizedMetadata: draft.normalized_metadata, form: mapLookupToForm(lookup) }));
          setDuplicateReview(duplicate);
          const draftNeedsReview = draft.decisions.length === 0 || draft.decisions.some((item) => item.status === "PENDING");
          const duplicateRequiresAction = duplicate.classification !== "NEW_TITLE";
          setActiveWorkspaceTab(draftNeedsReview || duplicateRequiresAction || Boolean(lookup.conflicts?.length) ? "review" : "book");
          initializedTabForLookup.current = lookup;
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
      const value = status === "ACCEPTED" ? reconciliationValueFromForm(field, form) : undefined;
      const decision = await metadataIntelligenceService.decideField(reconciliationDraft.id, field, status, value);
      setReconciliationDraft((current) => current ? {
        ...current,
        decisions: current.decisions.map((item) => item.field === field ? { ...item, status: decision.status, value: decision.value } : item),
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
      const result = await metadataIntelligenceService.decideDuplicate(duplicateReview.id, action, {
        ...(action === "LINK_EXISTING_VARIANT" && variantId ? { selectedVariantId: variantId } : {}),
        ...(["CREATE_VARIANT_FOR_EDITION", "CREATE_NEW_EDITION"].includes(action) && candidate ? { selectedBookId: candidate.bookId } : {}),
      });
      toast.success(action === "DISMISS_WARNING" ? "Đã ghi nhận quyết định bỏ qua cảnh báo duplicate" : "Đã lưu quyết định duplicate; chỉ metadata được duyệt mới được áp dụng.");
      setDuplicateReview(null);
      setDuplicateDecisionResult(result);
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
    if (reconciliationDraft?.decisions.some((item) => item.status === "PENDING")) {
      toast.error("Vui lòng hoàn tất các quyết định metadata trước khi lưu.");
      return;
    }
    if (duplicateReview && duplicateReview.classification !== "NEW_TITLE") {
      toast.error("Vui lòng xử lý duplicate review trước khi lưu.");
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

      let savedBookId: string;
      let appendSnapshot = false;
      if (reconciliationDraft) {
        const duplicateAction = duplicateDecisionResult?.review.decision;
        const result = await metadataIntelligenceService.applyReconciliationDraft(reconciliationDraft.id, {
          bookId: duplicateDecisionResult?.book?.id || duplicateDecisionResult?.review.selected_book_id || undefined,
          variantId: duplicateDecisionResult?.variant?.id || duplicateDecisionResult?.review.selected_variant_id || undefined,
          createEntities: createAuthorityEntities,
          finalMetadata: finalMetadataFromForm(form),
          duplicateReviewId: duplicateDecisionResult?.review.id,
        });
        savedBookId = result.book.id;
        appendSnapshot = duplicateAction !== "LINK_EXISTING_VARIANT";
      } else {
        const created = await bookService.createIncomplete({ isbn13: normalizedIsbn, title, price: 0, language: (form.language || "vi").trim() || "vi" });
        const payload = created?.data;
        if (!payload?.book_id) throw new Error("Không lấy được book id để cập nhật metadata");
        savedBookId = String(payload.book_id);
        appendSnapshot = Boolean(payload.created_new);
        await bookService.update(savedBookId, updatePayload);
      }
      toast.success("Đã lưu sách với metadata ISBN");

      // Keep the local catalog snapshot in sync so the duplicate check catches
      // this book if the user immediately tries to import it again this session.
      if (appendSnapshot) setCatalogBooks((prev) => [...prev, { id: savedBookId, title, author: authors[0] || "", isbn: normalizedIsbn, category: categories[0] || "" }]);

      setLookupData(null);
      setPostIsbnSuggestions(null);
      setReconciliationDraft(null);
      setCreateAuthorityEntities({});
      setDuplicateReview(null);
      setDuplicateDecisionResult(null);
      setForm(EMPTY_FORM);
      setIsbnInput("");
      setConfirmDuplicateSave(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lưu thông tin sách thất bại"));
    } finally {
      setSaving(false);
    }
  }

  function focusField(fieldId: string) {
    setActiveWorkspaceTab("book");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const field = document.getElementById(fieldId);
        field?.scrollIntoView({ behavior: shouldReduceMotion ? "auto" : "smooth", block: "center" });
        field?.focus({ preventScroll: true });
      });
    });
  }

  return (
    <PageWrapper className="mx-auto max-w-6xl space-y-6 pb-24">
      <FadeItem>
        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:shadow-none sm:p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">AI-assisted cataloging</p>
          <PageHeader
            className="mt-2"
            icon={Sparkles}
            title="Nhập sách qua AI"
            description="Quét mã vạch hoặc nhập ISBN để tra cứu metadata, sau đó AI tự tạo đề xuất mô tả, tóm tắt, từ khóa và thể loại cho admin duyệt."
            iconBg="bg-cyan-100 dark:bg-cyan-500/15"
            iconColor="text-cyan-600 dark:text-cyan-400"
            iconSize="lg"
          />
        </div>
      </FadeItem>

      <FadeItem>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <SectionCard
            icon={Search}
            title="Tra cứu ISBN"
            subtitle="Sau lookup, AI hoàn thiện metadata ở dạng đề xuất để admin chọn áp dụng"
            className="border-cyan-200/70 shadow-[0_4px_20px_rgba(8,145,178,0.06)] dark:border-cyan-500/20"
            headerClassName="border-b border-cyan-100/80 dark:border-cyan-500/15"
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
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-cyan-600 px-4 text-[13px] font-semibold text-white transition-[background-color,transform,box-shadow] duration-150 hover:bg-cyan-700 hover:shadow-[0_4px_12px_rgba(8,145,178,0.25)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none disabled:active:scale-100 dark:bg-cyan-500 dark:hover:bg-cyan-600"
                >
                  {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  <span>{lookupLoading ? lookupLoadingLabel : "Tra cứu"}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowScanner(true)}
                  disabled={lookupLoading}
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-indigo-200 bg-indigo-50 px-4 text-[13px] font-semibold text-indigo-700 transition-[background-color,transform] duration-150 hover:bg-indigo-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20"
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

          <div className="rounded-xl border border-border/80 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:shadow-none">
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

      <AnimatePresence mode="wait" initial={false}>
      {lookupLoading ? (
        <motion.div key="lookup-loading" initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }} transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}>
          <LookupSkeleton />
        </motion.div>
      ) : lookupData ? (
          <motion.div
            key={`lookup-result-${lookupData.isbn || isbnInput}`}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <section className="rounded-lg border border-border/80 bg-card p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)] sm:p-6 dark:shadow-none">
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

              <div className="space-y-6">
                <MetadataReadiness signals={reviewSignals} onFocusField={focusField} />

                <Tabs value={activeWorkspaceTab} onValueChange={(value) => setActiveWorkspaceTab(value as "book" | "review" | "ai")} className="gap-0">
                  <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 sm:gap-6" aria-label="Không gian làm việc nhập sách">
                    <TabsTrigger
                      value="book"
                      aria-label="Thông tin sách"
                      className="h-12 min-w-fit rounded-none border-x-0 border-b-2 border-t-0 border-transparent bg-transparent px-3 text-[13px] shadow-none data-[state=active]:border-cyan-500 data-[state=active]:bg-transparent data-[state=active]:text-cyan-700 data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-cyan-300"
                    >
                      <BookOpen className="h-4 w-4" aria-hidden="true" />
                      <span className="sm:hidden">Sách</span><span className="hidden sm:inline">Thông tin sách</span>
                      <StatusBadge label={`${completeSignalCount}/4`} variant={completeSignalCount === 4 ? "success" : "warning"} />
                    </TabsTrigger>
                    <TabsTrigger
                      value="review"
                      aria-label={`Kiểm duyệt, ${reviewIssueCount} mục cần xử lý`}
                      className="h-12 min-w-fit rounded-none border-x-0 border-b-2 border-t-0 border-transparent bg-transparent px-3 text-[13px] shadow-none data-[state=active]:border-cyan-500 data-[state=active]:bg-transparent data-[state=active]:text-cyan-700 data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-cyan-300"
                    >
                      <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                      <span>Kiểm duyệt</span>
                      <StatusBadge label={String(reviewIssueCount)} variant={reviewIssueCount ? "warning" : "success"} />
                    </TabsTrigger>
                    <TabsTrigger
                      value="ai"
                      aria-label={`AI hỗ trợ, ${aiSuggestionCount} đề xuất chờ duyệt`}
                      className="h-12 min-w-fit rounded-none border-x-0 border-b-2 border-t-0 border-transparent bg-transparent px-3 text-[13px] shadow-none data-[state=active]:border-violet-500 data-[state=active]:bg-transparent data-[state=active]:text-violet-700 data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent dark:data-[state=active]:text-violet-300"
                    >
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      <span>AI hỗ trợ</span>
                      <StatusBadge label={String(aiSuggestionCount)} variant={aiSuggestionCount ? "violet" : "neutral"} />
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="review" className="mt-0 pt-6">
                    <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}>
                      <div className="mb-5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-300">Kiểm duyệt catalog</p>
                        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
                          <div>
                            <h2 className="text-[20px] font-semibold tracking-tight text-foreground">{reviewIssueCount ? "Việc cần xử lý" : "Đã hoàn tất kiểm duyệt"}</h2>
                            <p className="mt-1 text-[13px] text-muted-foreground">Duyệt chuẩn hóa, trùng lặp và nguồn dữ liệu trước khi lưu.</p>
                          </div>
                          <StatusBadge label={reviewIssueCount ? `${reviewIssueCount} mục` : "An toàn"} variant={reviewIssueCount ? "warning" : "success"} />
                        </div>
                      </div>

                {(duplicateNeedsReview || authorityNeedsReview || evidenceNeedsReview) ? (
                  <section className="border-t border-border" aria-label="Hàng đợi kiểm duyệt">
                    {duplicateNeedsReview && duplicateReview ? (
                      <ReviewQueueItem
                        id="duplicate-review"
                        title="Kiểm tra trùng lặp và ấn bản"
                        description="Chọn cách xử lý trước khi tiếp tục lưu sách."
                        status={<StatusBadge label="Cần quyết định" variant="warning" />}
                        open={activeReviewId === "duplicate"}
                        onToggle={() => setActiveReviewId((current) => current === "duplicate" ? null : "duplicate")}
                      >
                        <DuplicateReviewPanel review={duplicateReview} onAction={(action, candidate) => void handleDuplicateAction(action, candidate)} />
                      </ReviewQueueItem>
                    ) : null}
                    {authorityNeedsReview && reconciliationDraft ? (
                      <ReviewQueueItem
                        id="authority-review"
                        title="Chuẩn hóa authority"
                        description="Duyệt tác giả, nhà xuất bản và thể loại theo catalog chuẩn."
                        status={<StatusBadge label="Cần duyệt" variant="warning" />}
                        open={activeReviewId === "authority"}
                        onToggle={() => setActiveReviewId((current) => current === "authority" ? null : "authority")}
                      >
                        <AuthorityReviewPanel draft={reconciliationDraft} onDecision={(field, status) => void handleAuthorityDecision(field, status)} onCreateEntity={handleCreateAuthorityEntity} />
                      </ReviewQueueItem>
                    ) : null}
                    {evidenceNeedsReview ? (
                      <ReviewQueueItem
                        id="evidence-review"
                        title="Xung đột nguồn ISBN"
                        description="So sánh giá trị được chọn với các nguồn xác nhận trước khi lưu."
                        status={<StatusBadge label={`${lookupData.conflicts?.length || 0} xung đột`} variant="warning" />}
                        open={activeReviewId === "evidence"}
                        onToggle={() => setActiveReviewId((current) => current === "evidence" ? null : "evidence")}
                      >
                        <IsbnIntelligencePanel lookup={lookupData} />
                      </ReviewQueueItem>
                    ) : null}
                  </section>
                ) : null}

                      {reviewIssueCount === 0 ? (
                        <div className="mb-6 flex items-start gap-3 border-y border-emerald-200/80 py-4 text-emerald-800 dark:border-emerald-500/20 dark:text-emerald-300" role="status">
                          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-[14px] font-semibold">Không còn mục cần duyệt</p>
                            <p className="mt-1 text-[13px] opacity-80">Authority, trùng lặp và dữ liệu nguồn đã sẵn sàng.</p>
                          </div>
                        </div>
                      ) : null}

                      {!evidenceNeedsReview ? (
                        <ReviewDisclosure id="isbn-evidence" title="Nguồn và đối chiếu ISBN" description="Xem nguồn xác nhận và độ tin cậy từng trường khi cần." badge={<StatusBadge label={sourceBadges.length ? `${sourceBadges.length} nguồn` : "Thủ công"} variant="neutral" />}>
                          <IsbnIntelligencePanel lookup={lookupData} />
                        </ReviewDisclosure>
                      ) : null}

                      <CatalogDuplicateWarning matches={duplicateMatches} confirmed={confirmDuplicateSave} onConfirm={setConfirmDuplicateSave} />
                    </motion.div>
                  </TabsContent>

                  <TabsContent value="book" className="mt-0 pt-6">
                    <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }} className="min-w-0">
                  <section className="border-t border-border pt-6" aria-labelledby="catalog-record-title">
                    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-300">Hồ sơ catalog</p>
                        <h2 id="catalog-record-title" className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">Thông tin ấn bản</h2>
                        <p className="mt-1 text-[14px] text-muted-foreground">Chỉnh sửa metadata trước khi áp dụng vào catalog.</p>
                      </div>
                      <StatusBadge label={`${completeSignalCount}/4 trường cốt lõi`} variant={completeSignalCount === 4 ? "success" : "warning"} />
                    </div>

              <div className="mb-4">
                <p className="text-[15px] font-semibold text-foreground">Thông tin cốt lõi</p>
                <p className="mt-1 text-[13px] text-muted-foreground">Dữ liệu dùng để nhận diện và phân loại sách.</p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
                  <Field id="isbn" className="sm:col-span-2" label="ISBN" mono required value={form.isbn} onChange={(v) => setForm((prev) => ({ ...prev, isbn: v }))} />
                  <Field id="title" className="sm:col-span-4" label="Tên sách" required value={form.title} onChange={(v) => setForm((prev) => ({ ...prev, title: v }))} />
                  <Field id="subtitle" className="sm:col-span-6" label="Tựa phụ" value={form.subtitle} onChange={(v) => setForm((prev) => ({ ...prev, subtitle: v }))} />
                  <Field id="authors" className="sm:col-span-3" label="Tác giả (cách nhau dấu phẩy)" value={form.authorsText} onChange={(v) => setForm((prev) => ({ ...prev, authorsText: v }))} />
                  <Field id="publisher" className="sm:col-span-3" label="Nhà xuất bản" value={form.publisher} onChange={(v) => setForm((prev) => ({ ...prev, publisher: v }))} />
                  <Field id="categories" className="sm:col-span-4" label="Thể loại (cách nhau dấu phẩy)" value={form.categoriesText} onChange={(v) => setForm((prev) => ({ ...prev, categoriesText: v }))} />
                  <Field id="language" className="sm:col-span-2" label="Ngôn ngữ" value={form.language} onChange={(v) => setForm((prev) => ({ ...prev, language: v }))} />
              </div>

              <div className="mt-8 grid grid-cols-1 gap-4 border-t border-border pt-6 md:grid-cols-2">
                <div className="md:col-span-2">
                  <p className="text-[15px] font-semibold text-foreground">Nội dung catalog</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">Mô tả giúp tìm kiếm và hỗ trợ chatbot.</p>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="description" className="mb-2 text-[12px] font-semibold text-foreground">Mô tả</Label>
                  <Textarea id="description" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} rows={5} className="resize-y bg-muted/[0.12] text-[14px] leading-6 focus-visible:bg-card" />
                </div>
                <div>
                  <Label htmlFor="summaryVi" className="mb-2 text-[12px] font-semibold text-foreground">Tóm tắt ngắn cho chatbot</Label>
                  <Textarea id="summaryVi" value={form.summaryVi} onChange={(e) => setForm((prev) => ({ ...prev, summaryVi: e.target.value }))} rows={2} placeholder="Tóm tắt 2-3 câu dùng cho AI chatbot..." className="bg-muted/[0.12] text-[14px] focus-visible:bg-card" />
                </div>
                <Field id="keywords" label="Từ khóa (cách nhau dấu phẩy)" value={form.keywordsText} onChange={(v) => setForm((prev) => ({ ...prev, keywordsText: v }))} />
              </div>

              <ReviewDisclosure id="additional-metadata" title="Thông tin bổ sung" description="ISBN-10/13, ngày xuất bản, số trang và URL ảnh bìa." badge={<span className="text-[12px] text-muted-foreground">Tùy chọn</span>}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="isbn13" label="ISBN13" mono value={form.isbn13} onChange={(v) => setForm((prev) => ({ ...prev, isbn13: v }))} />
                  <Field id="isbn10" label="ISBN10" mono value={form.isbn10} onChange={(v) => setForm((prev) => ({ ...prev, isbn10: v }))} />
                  <Field id="publishedDate" label="Ngày xuất bản" value={form.publishedDate} onChange={(v) => setForm((prev) => ({ ...prev, publishedDate: v }))} />
                  <Field id="pageCount" label="Số trang" value={form.pageCount} onChange={(v) => setForm((prev) => ({ ...prev, pageCount: v }))} />
                  <Field id="thumbnail" label="URL ảnh bìa" className="sm:col-span-2" value={form.thumbnail} onChange={(v) => setForm((prev) => ({ ...prev, thumbnail: v }))} />
                </div>
              </ReviewDisclosure>
                  </section>
                    </motion.div>
                  </TabsContent>

                  <TabsContent value="ai" className="mt-0 pt-6">
                    <motion.div initial={shouldReduceMotion ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}>
                {form.title.trim() ? (
                  <div>
                    <section aria-labelledby="ai-workspace-title">
                      <div className="mb-5 flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-300">AI hỗ trợ catalog</p>
                          <h2 id="ai-workspace-title" className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">Đề xuất và công cụ AI</h2>
                          <p className="mt-1 text-[13px] text-muted-foreground">{hasPostIsbnSuggestions ? "Xem trước, áp dụng hoặc tạo thêm đề xuất cho hồ sơ sách." : "Tạo đề xuất bổ sung khi metadata còn thiếu hoặc cần chuẩn hóa."}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {hasPostIsbnSuggestions && postIsbnSuggestions ? (
                          <span className="text-[12px] text-muted-foreground">
                            {postIsbnSuggestions.provider === "none" ? "AI không khả dụng" : `${postIsbnSuggestions.provider} · ${Math.round((postIsbnSuggestions.confidence || 0) * 100)}%`}
                          </span>
                        ) : null}
                          <StatusBadge label={aiSuggestionCount ? `${aiSuggestionCount} chờ duyệt` : "Chưa có"} variant={aiSuggestionCount ? "violet" : "neutral"} />
                        </div>
                      </div>
                  <div role="region" aria-label="Đề xuất AI" className="space-y-4">
                    <div className="border-b border-violet-200/70 pb-4 dark:border-violet-500/20">
                      <p className="mb-3 text-[13px] text-muted-foreground">Các công cụ chỉ tạo đề xuất; hồ sơ chỉ thay đổi khi bạn bấm áp dụng.</p>
                      <div aria-label="Công cụ AI" className="flex flex-wrap gap-2">
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
                      </div>
                    </div>

                    {hasPostIsbnSuggestions && postIsbnSuggestions ? (
                      <div className="border-t border-border pt-4">
                        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="text-[14px] font-semibold text-foreground">Đề xuất AI sau ISBN</p>
                            <p className="mt-1 text-[13px] text-muted-foreground">
                              Chọn từng mục hoặc áp dụng tất cả nếu nội dung phù hợp với sách.
                            </p>
                          </div>
                          {(postIsbnSuggestions.description || postIsbnSuggestions.summaryVi || postIsbnSuggestions.keywords.length > 0 || postIsbnSuggestions.categories.length > 0) ? (
                            <button
                              type="button"
                              onClick={applyAllPostIsbnSuggestions}
                              className="inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-violet-600 px-3.5 text-[12px] font-semibold text-white transition-[background-color,transform,box-shadow] duration-150 hover:bg-violet-700 hover:shadow-[0_4px_12px_rgba(124,58,237,0.22)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:bg-violet-500 dark:hover:bg-violet-600"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              Áp dụng tất cả
                            </button>
                          ) : null}
                        </div>

                        {postIsbnSuggestions.qualityWarnings.length > 0 ? (
                          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
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

                        <div className="divide-y divide-border border-y border-border">
                          <AiSuggestionRow
                            index={0}
                            title="Mô tả đã chuẩn hóa"
                            value={postIsbnSuggestions.description || ""}
                            onApply={() => applyPostIsbnSuggestion("description")}
                            icon={FileText}
                          />
                          <AiSuggestionRow
                            index={1}
                            title="Tóm tắt ngắn cho chatbot"
                            value={postIsbnSuggestions.summaryVi || ""}
                            onApply={() => applyPostIsbnSuggestion("summaryVi")}
                            icon={ClipboardCheck}
                          />
                          <AiSuggestionRow
                            index={2}
                            title="Từ khóa tìm kiếm"
                            value={postIsbnSuggestions.keywords.join(", ")}
                            onApply={() => applyPostIsbnSuggestion("keywords")}
                            icon={Hash}
                          />
                          <AiSuggestionRow
                            index={3}
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
                        initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}
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
                              className="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-[8px] bg-violet-600 px-3 text-[11px] font-semibold text-white transition-[background-color,transform] duration-150 hover:bg-violet-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:bg-violet-500 dark:hover:bg-violet-600"
                            >
                              Áp dụng
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setEnrichResult(null)}
                            className="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-[8px] border border-border px-3 text-[11px] font-semibold text-muted-foreground transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 dark:text-slate-400"
                          >
                            Đóng
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </div>
                    </section>
                  </div>
                ) : (
                  <div className="flex min-h-40 items-center justify-center border-y border-border py-8 text-center">
                    <div>
                      <Sparkles className="mx-auto h-6 w-6 text-violet-500" aria-hidden="true" />
                      <p className="mt-3 text-[14px] font-semibold text-foreground">Cần tên sách để dùng AI hỗ trợ</p>
                      <button type="button" onClick={() => focusField("title")} className="mt-2 cursor-pointer text-[13px] font-medium text-cyan-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:text-cyan-300">Bổ sung tên sách</button>
                    </div>
                  </div>
                )}
                    </motion.div>
                  </TabsContent>
                </Tabs>
              </div>

              <div className="sticky bottom-4 z-10 mt-6 flex flex-col gap-3 rounded-lg border border-border/80 bg-card/95 p-3 shadow-[0_8px_18px_rgba(15,23,42,0.1)] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:flex-row sm:items-center sm:justify-between dark:shadow-black/20">
                <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${completeSignalCount === 4 && reviewIssueCount === 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"}`}>
                    {completeSignalCount === 4 && reviewIssueCount === 0 ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
                  </div>
                  {reviewIssueCount > 0 ? (
                    <button type="button" onClick={() => setActiveWorkspaceTab("review")} className="cursor-pointer text-left font-medium text-amber-800 underline decoration-amber-300 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30 dark:text-amber-300">
                      {catalogDuplicateNeedsReview ? "Cần xác nhận trùng catalog trước khi lưu" : `Còn ${reviewIssueCount} mục kiểm duyệt cần xử lý`}
                    </button>
                  ) : (
                    <span>{completeSignalCount === 4 ? "Metadata đã sẵn sàng để lưu" : `Còn thiếu ${4 - completeSignalCount} trường cốt lõi trước khi lưu`}</span>
                  )}
                </div>
                <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLookupData(null);
                    setPostIsbnSuggestions(null);
                    setForm(EMPTY_FORM);
                    setIsbnInput("");
                  }}
                  disabled={saving}
                  className="cursor-pointer rounded-md border border-border bg-card px-4 py-2.5 text-[13px] font-semibold text-foreground transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
                >
                  Đặt lại
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || (duplicateMatches.length > 0 && !confirmDuplicateSave)}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-[background-color,transform,box-shadow] duration-150 hover:bg-emerald-700 hover:shadow-[0_5px_12px_rgba(5,150,105,0.2)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-emerald-600 disabled:hover:shadow-none disabled:active:scale-100 dark:bg-emerald-500 dark:hover:bg-emerald-600"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookCheck className="h-4 w-4" />}
                  {saving ? "Đang lưu" : "Lưu sách"}
                </button>
                </div>
              </div>
            </section>
          </motion.div>
        ) : (
          <motion.div
            key="lookup-empty"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
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
      </AnimatePresence>

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
