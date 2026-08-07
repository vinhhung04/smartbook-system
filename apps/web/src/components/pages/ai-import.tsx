import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { BookCheck, BookOpen, Loader2, ScanBarcode, Search, Sparkles } from "lucide-react";
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
import { aiService, type LookupBookByIsbnResponse, type EnrichBookMetadataResponse, type EnrichMode } from "@/services/ai";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api";

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

// ── Small presentational helpers ────────────────────────────────────────────

function Field({
  id,
  label,
  value,
  onChange,
  mono,
  placeholder,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  mono?: boolean;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={mono ? "font-mono" : undefined}
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
  const [saving, setSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [lookupData, setLookupData] = useState<LookupBookByIsbnResponse | null>(null);
  const [form, setForm] = useState<EditableBookForm>(EMPTY_FORM);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [enrichLoading, setEnrichLoading] = useState<EnrichMode | null>(null);
  const [enrichResult, setEnrichResult] = useState<EnrichBookMetadataResponse | null>(null);

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

  const steps: WorkflowStep[] = [
    { id: "lookup", label: "Tra cứu ISBN", icon: Search, status: lookupData ? "completed" : "active" },
    { id: "edit", label: "Xem & chỉnh sửa", icon: BookCheck, status: lookupData ? "active" : "pending" },
  ];

  async function handleLookup(rawInput?: string) {
    const normalized = normalizeIsbnInput(rawInput ?? isbnInput);
    if (!normalized) {
      toast.error("Vui lòng nhập ISBN");
      return;
    }

    setLookupLoading(true);
    try {
      // Lookup nhanh: không chờ Ollama/Anthropic sinh summary
      const result = await aiService.lookupBookByIsbn({
        isbn: normalized,
        generateVietnameseSummary: false,
      });

      setIsbnInput(normalized);
      setLookupData(result);

      if (result.found) {
        setForm(mapLookupToForm(result));
        toast.success("Đã tìm thấy metadata sách");
      } else {
        setForm({
          ...EMPTY_FORM,
          isbn: result.isbn || normalized,
          isbn13: result.isbn13 || (normalized.length === 13 ? normalized : ""),
          isbn10: result.isbn10 || (normalized.length === 10 ? normalized : ""),
        });
        toast.info("Không tìm thấy metadata. Chuyển sang nhập tay.");
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Tra cứu ISBN thất bại"));
    } finally {
      setLookupLoading(false);
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

      await bookService.update(String(payload.book_id), updatePayload);
      toast.success("Đã lưu sách với metadata ISBN");

      setLookupData(null);
      setForm(EMPTY_FORM);
      setIsbnInput("");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Lưu thông tin sách thất bại"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-cyan-600 dark:text-cyan-400">
          AI-assisted cataloging
        </p>
        <div className="mt-2">
          <PageHeader
            icon={Sparkles}
            title="Nhập sách qua AI"
            description="Quét mã vạch hoặc nhập ISBN để tự động điền metadata, sau đó dùng công cụ AI để hoàn thiện mô tả."
            iconBg="bg-gradient-to-br from-cyan-100 to-violet-100 dark:from-cyan-500/15 dark:to-violet-500/15"
            iconColor="text-cyan-600 dark:text-cyan-400"
          />
        </div>
      </FadeItem>

      <FadeItem>
        <div className="rounded-xl border border-border bg-card p-4">
          <WorkflowStepper steps={steps} compact />
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard
          icon={Search}
          title="Tra cứu ISBN"
          subtitle="Hỗ trợ scanner có khoảng trắng/dấu gạch ngang — hệ thống sẽ tự động chuẩn hóa"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-500" />
              <Input
                value={isbnInput}
                onChange={(event) => setIsbnInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleLookup();
                  }
                }}
                placeholder="Nhập hoặc quét ISBN-10 / ISBN-13"
                className="h-11 border-2 border-cyan-300/40 bg-gradient-to-r from-cyan-50/30 to-blue-50/30 pl-10 pr-4 text-[13px] focus-visible:border-cyan-400/60 focus-visible:ring-cyan-500/10 dark:border-cyan-500/20"
              />
            </div>

            <button
              onClick={() => void handleLookup()}
              disabled={lookupLoading}
              className="inline-flex cursor-pointer items-center gap-2 rounded-[12px] bg-gradient-to-r from-cyan-600 to-violet-600 px-4 py-2.5 text-[13px] font-semibold text-white transition-transform duration-150 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
            >
              {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {lookupLoading ? "Đang tra cứu" : "Tra cứu"}
            </button>

            <button
              onClick={() => setShowScanner(true)}
              disabled={lookupLoading}
              className="inline-flex cursor-pointer items-center gap-2 rounded-[12px] border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-[13px] font-semibold text-indigo-700 transition-colors duration-150 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-400 dark:hover:bg-indigo-500/20"
            >
              <ScanBarcode className="h-4 w-4" />
              Quét camera
            </button>
          </div>
        </SectionCard>
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
                  <StatusBadge label={`Tin cậy ${confidenceText}`} variant={confidenceVariant} dot />
                  {sourceBadges.length > 0
                    ? sourceBadges.map((s) => <StatusBadge key={s.key} label={s.label} variant={s.variant} />)
                    : <StatusBadge label="Thủ công" variant="neutral" />}
                </div>
              }
            >
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

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
                {/* Cover preview + live caption */}
                <div className="mx-auto w-full max-w-[200px] space-y-3 lg:mx-0">
                  <motion.div
                    key={form.thumbnail}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className="aspect-[3/4] overflow-hidden rounded-xl border border-border shadow-sm"
                  >
                    <CoverPreview key={form.thumbnail} src={form.thumbnail} alt={form.title ? `Bìa sách ${form.title}` : "Ảnh bìa sách"} />
                  </motion.div>
                  <div className="text-center lg:text-left">
                    <p className="line-clamp-2 text-[13px] font-semibold text-foreground">{form.title || "Chưa có tên sách"}</p>
                    {form.authorsText && <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{form.authorsText}</p>}
                  </div>
                </div>

                {/* Editable short fields */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field id="isbn" label="ISBN" mono value={form.isbn} onChange={(v) => setForm((prev) => ({ ...prev, isbn: v }))} />
                  <Field id="title" label="Tên sách" value={form.title} onChange={(v) => setForm((prev) => ({ ...prev, title: v }))} />
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
                  <Label htmlFor="description" className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mô tả</Label>
                  <Textarea id="description" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} rows={4} />
                </div>
                <div>
                  <Label htmlFor="summaryVi" className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tóm tắt ngắn (summary_vi)</Label>
                  <Textarea
                    id="summaryVi"
                    value={form.summaryVi}
                    onChange={(e) => setForm((prev) => ({ ...prev, summaryVi: e.target.value }))}
                    rows={2}
                    placeholder="Tóm tắt 2-3 câu dùng cho AI chatbot..."
                  />
                </div>
                <Field id="keywords" label="Từ khóa (cách nhau dấu phẩy)" value={form.keywordsText} onChange={(v) => setForm((prev) => ({ ...prev, keywordsText: v }))} />

                {/* AI Tools section */}
                {form.title.trim() && (
                  <div className="rounded-[12px] border border-violet-100 bg-violet-50/40 p-4 dark:border-violet-500/20 dark:bg-violet-500/5">
                    <div className="mb-2.5 flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-500/15">
                        <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
                      </div>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-violet-600 dark:text-violet-400">Công cụ AI</span>
                    </div>

                    {!form.description.trim() ? (
                      <button
                        onClick={() => void handleGenerateDescription()}
                        disabled={summaryLoading}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-violet-200 bg-card px-3 py-1.5 text-[11px] font-semibold text-violet-700 transition-colors hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-500/20 dark:text-violet-400 dark:hover:bg-violet-500/10"
                      >
                        {summaryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {summaryLoading ? "Đang tạo mô tả..." : "Tạo mô tả AI"}
                      </button>
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
                          <button
                            key={mode}
                            onClick={() => void handleEnrichMetadata(mode)}
                            disabled={!!enrichLoading || summaryLoading}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-violet-200 bg-card px-3 py-1.5 text-[11px] font-semibold text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-violet-500/20 dark:text-violet-400 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/10"
                          >
                            {enrichLoading === mode
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <Sparkles className="h-3 w-3" />}
                            {enrichLoading === mode ? "Đang xử lý..." : label}
                          </button>
                        ))}
                      </div>
                    )}

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
                            ? <p className="mb-2 font-medium text-emerald-600 dark:text-emerald-400">Metadata đạt chất lượng tốt ✓</p>
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
                              onClick={applyEnrichResult}
                              className="cursor-pointer rounded-[8px] bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600"
                            >
                              Áp dụng
                            </button>
                          )}
                          <button
                            onClick={() => setEnrichResult(null)}
                            className="cursor-pointer rounded-[8px] border border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-muted dark:text-slate-400"
                          >
                            Đóng
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setLookupData(null);
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
                  disabled={saving}
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
              Quét mã vạch hoặc nhập ISBN ở trên — AI sẽ tự động tra cứu và điền đầy đủ metadata cho bạn.
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
