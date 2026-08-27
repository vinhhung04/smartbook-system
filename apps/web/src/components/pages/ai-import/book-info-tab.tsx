import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/status-badge";
import { Field } from "./field";
import { ReviewDisclosure } from "./review-queue-item";
import type { AiFieldCandidates, AiFieldKey, EditableBookForm } from "./types";
import type { PostIsbnAiSuggestions } from "@/services/ai";

/**
 * A field whose content can be AI-generated gets one consistent card — label
 * and "Tạo bằng AI" action live in a persistent header bar, the control sits
 * below, and a suggestion (when one exists) expands in the same card instead
 * of popping in as a separate box. The violet corner tag is the one visual
 * signal in this tab: it marks "AI can write this" wherever it appears, like
 * a classification tab on a library catalog card, matching the same violet
 * used for authority normalization in Kiểm duyệt catalog.
 */
function AiAssistedField({
  id,
  label,
  field,
  candidates,
  loading,
  disabled,
  onRegenerate,
  onApply,
  className = "",
  children,
}: {
  id: string;
  label: string;
  field: AiFieldKey;
  candidates: AiFieldCandidates;
  loading: Record<AiFieldKey, boolean>;
  disabled: boolean;
  onRegenerate: (field: AiFieldKey) => void;
  onApply: (field: AiFieldKey) => void;
  className?: string;
  children: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();
  const candidate = candidates[field];
  const isLoading = loading[field];
  const hasSuggestion = Boolean(candidate?.value.trim());

  return (
    <div className={`relative ${className}`}>
      <div className="pointer-events-none absolute -top-2.5 left-4 z-10 flex h-5 w-6 items-center justify-center rounded-t-md bg-violet-500 shadow-sm dark:bg-violet-400" aria-hidden="true">
        <Sparkles className="h-3 w-3 text-white" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/[0.25] py-2 pl-4 pr-3">
          <Label htmlFor={id} className="text-[12px] font-semibold text-foreground">{label}</Label>
          <button
            type="button"
            onClick={() => onRegenerate(field)}
            disabled={isLoading || disabled}
            title={disabled ? "Cần có tên sách để dùng AI" : undefined}
            className="inline-flex min-h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-violet-200 bg-card px-2.5 text-[11px] font-semibold text-violet-700 transition-[background-color,border-color] duration-150 hover:border-violet-300 hover:bg-violet-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-45 dark:border-violet-500/20 dark:text-violet-400 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/10"
          >
            {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : hasSuggestion ? <RefreshCw className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
            {isLoading ? "Đang tạo..." : hasSuggestion ? "Tạo lại" : "Tạo bằng AI"}
          </button>
        </div>

        <div className="p-3.5 pl-4">{children}</div>

        <AnimatePresence initial={false}>
          {hasSuggestion ? (
            <motion.div
              initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={shouldReduceMotion ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: "easeOut" }}
            >
              <div className="border-t border-violet-200/60 bg-violet-50/50 p-3.5 pl-4 dark:border-violet-500/15 dark:bg-violet-500/[0.05]">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                  <Sparkles className="h-3 w-3" />
                  Đề xuất AI {candidate!.source === "postIsbn" ? "· từ ISBN" : ""}
                </div>
                <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">{candidate!.value}</p>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onApply(field)}
                    className="inline-flex min-h-7 cursor-pointer items-center justify-center rounded-md bg-violet-600 px-2.5 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:bg-violet-500 dark:hover:bg-violet-600"
                  >
                    Áp dụng
                  </button>
                  <button
                    type="button"
                    onClick={() => onRegenerate(field)}
                    disabled={isLoading}
                    className="inline-flex min-h-7 cursor-pointer items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Tạo lại
                  </button>
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function BookInfoTab({
  form,
  onFieldChange,
  completeSignalCount,
  aiFieldCandidates,
  aiFieldLoading,
  onRegenerateField,
  onApplyField,
  onApplyAllFields,
  aiSuggestionCount,
  qualityCheckLoading,
  qualityCheckResult,
  onQualityCheck,
  onDismissQualityCheck,
  postIsbnSuggestions,
  hasPostIsbnSuggestions,
}: {
  form: EditableBookForm;
  onFieldChange: (field: keyof EditableBookForm, value: string) => void;
  completeSignalCount: number;
  aiFieldCandidates: AiFieldCandidates;
  aiFieldLoading: Record<AiFieldKey, boolean>;
  onRegenerateField: (field: AiFieldKey) => void;
  onApplyField: (field: AiFieldKey) => void;
  onApplyAllFields: () => void;
  aiSuggestionCount: number;
  qualityCheckLoading: boolean;
  qualityCheckResult: { provider: string; warnings: string[] } | null;
  onQualityCheck: () => void;
  onDismissQualityCheck: () => void;
  postIsbnSuggestions: PostIsbnAiSuggestions | null;
  hasPostIsbnSuggestions: boolean;
}) {
  const noTitle = !form.title.trim();

  return (
    <section aria-labelledby="catalog-record-title">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-300">Hồ sơ catalog</p>
          <h2 id="catalog-record-title" className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">Thông tin ấn bản</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">Trường có viền màu là trường AI có thể viết hộ — sửa tay hoặc bấm tạo, xem trước rồi mới áp dụng.</p>
        </div>
        <StatusBadge label={`${completeSignalCount}/4 trường cốt lõi`} variant={completeSignalCount === 4 ? "success" : "warning"} />
      </div>

      <div className="space-y-5">
        <SectionCard title="Thông tin cốt lõi" subtitle="Dữ liệu tra cứu được dùng để nhận diện sách — không phải nội dung AI tạo.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
            <Field id="isbn" className="sm:col-span-2" label="ISBN" mono required variant="underline" value={form.isbn} onChange={(v) => onFieldChange("isbn", v)} />
            <Field id="title" className="sm:col-span-4" label="Tên sách" required variant="underline" inputClassName="text-[16px]" value={form.title} onChange={(v) => onFieldChange("title", v)} />
            <Field id="subtitle" className="sm:col-span-6" label="Tựa phụ" variant="underline" value={form.subtitle} onChange={(v) => onFieldChange("subtitle", v)} />
            <Field id="authors" className="sm:col-span-3" label="Tác giả (cách nhau dấu phẩy)" variant="underline" value={form.authorsText} onChange={(v) => onFieldChange("authorsText", v)} />
            <Field id="publisher" className="sm:col-span-3" label="Nhà xuất bản" variant="underline" value={form.publisher} onChange={(v) => onFieldChange("publisher", v)} />
          </div>
        </SectionCard>

        <SectionCard
          title="Nội dung do AI hỗ trợ"
          subtitle="Mô tả, tóm tắt, từ khóa và thể loại — dùng AI để tạo nhanh, xem trước rồi mới áp dụng."
          actions={(
            <div className="flex items-center gap-2">
              {hasPostIsbnSuggestions && postIsbnSuggestions ? (
                <span className="hidden text-[11px] text-muted-foreground sm:inline">
                  {postIsbnSuggestions.provider === "none" ? "AI không khả dụng" : `${postIsbnSuggestions.provider} · ${Math.round((postIsbnSuggestions.confidence || 0) * 100)}%`}
                </span>
              ) : null}
              {aiSuggestionCount > 0 ? (
                <button
                  type="button"
                  onClick={onApplyAllFields}
                  className="inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-violet-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-violet-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 dark:bg-violet-500 dark:hover:bg-violet-600"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Áp dụng tất cả
                </button>
              ) : null}
              <button
                type="button"
                onClick={onQualityCheck}
                disabled={qualityCheckLoading || noTitle}
                title={noTitle ? "Cần có tên sách để dùng AI" : undefined}
                className="inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                {qualityCheckLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">Kiểm tra chất lượng</span>
              </button>
            </div>
          )}
        >
          {qualityCheckResult ? (
            <div className={`mb-4 flex items-start gap-2 rounded-md border px-3 py-2.5 text-[13px] ${qualityCheckResult.warnings.length === 0 ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}`}>
              <div className="flex-1">
                {qualityCheckResult.warnings.length === 0 ? (
                  <span className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="h-4 w-4" />Metadata đạt chất lượng tốt</span>
                ) : (
                  <>
                    <div className="mb-1 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />Cảnh báo chất lượng metadata</div>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {qualityCheckResult.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                    </ul>
                  </>
                )}
              </div>
              <button type="button" onClick={onDismissQualityCheck} aria-label="Đóng" className="cursor-pointer text-current/70 hover:text-current">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <AiAssistedField
              id="description"
              label="Mô tả"
              field="description"
              candidates={aiFieldCandidates}
              loading={aiFieldLoading}
              disabled={noTitle}
              onRegenerate={onRegenerateField}
              onApply={onApplyField}
              className="md:col-span-3"
            >
              <Textarea id="description" value={form.description} onChange={(e) => onFieldChange("description", e.target.value)} rows={4} className="resize-y border-none bg-transparent p-0 text-[14px] leading-6 shadow-none focus-visible:ring-0" />
            </AiAssistedField>

            <AiAssistedField
              id="summaryVi"
              label="Tóm tắt ngắn cho chatbot"
              field="summaryVi"
              candidates={aiFieldCandidates}
              loading={aiFieldLoading}
              disabled={noTitle}
              onRegenerate={onRegenerateField}
              onApply={onApplyField}
            >
              <Textarea id="summaryVi" value={form.summaryVi} onChange={(e) => onFieldChange("summaryVi", e.target.value)} rows={3} placeholder="Tóm tắt 2-3 câu dùng cho AI chatbot..." className="border-none bg-transparent p-0 text-[14px] leading-6 shadow-none focus-visible:ring-0" />
            </AiAssistedField>

            <AiAssistedField
              id="keywords"
              label="Từ khóa"
              field="keywords"
              candidates={aiFieldCandidates}
              loading={aiFieldLoading}
              disabled={noTitle}
              onRegenerate={onRegenerateField}
              onApply={onApplyField}
            >
              <Input id="keywords" value={form.keywordsText} onChange={(e) => onFieldChange("keywordsText", e.target.value)} placeholder="cách nhau dấu phẩy" className="border-none bg-transparent p-0 text-[14px] shadow-none focus-visible:ring-0" />
            </AiAssistedField>

            <AiAssistedField
              id="categories"
              label="Thể loại"
              field="categories"
              candidates={aiFieldCandidates}
              loading={aiFieldLoading}
              disabled={noTitle}
              onRegenerate={onRegenerateField}
              onApply={onApplyField}
            >
              <Input id="categories" value={form.categoriesText} onChange={(e) => onFieldChange("categoriesText", e.target.value)} placeholder="cách nhau dấu phẩy" className="border-none bg-transparent p-0 text-[14px] shadow-none focus-visible:ring-0" />
            </AiAssistedField>
          </div>
        </SectionCard>

        <ReviewDisclosure id="additional-metadata" title="Thông tin bổ sung" description="ISBN-10/13, ngôn ngữ, ngày xuất bản, số trang và URL ảnh bìa." badge={<span className="text-[12px] text-muted-foreground">Tùy chọn</span>}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="isbn13" label="ISBN13" mono variant="underline" value={form.isbn13} onChange={(v) => onFieldChange("isbn13", v)} />
            <Field id="isbn10" label="ISBN10" mono variant="underline" value={form.isbn10} onChange={(v) => onFieldChange("isbn10", v)} />
            <Field id="language" label="Ngôn ngữ" variant="underline" value={form.language} onChange={(v) => onFieldChange("language", v)} />
            <Field id="publishedDate" label="Ngày xuất bản" variant="underline" value={form.publishedDate} onChange={(v) => onFieldChange("publishedDate", v)} />
            <Field id="pageCount" label="Số trang" variant="underline" value={form.pageCount} onChange={(v) => onFieldChange("pageCount", v)} />
            <Field id="thumbnail" label="URL ảnh bìa" className="sm:col-span-2" variant="underline" value={form.thumbnail} onChange={(v) => onFieldChange("thumbnail", v)} />
          </div>
        </ReviewDisclosure>
      </div>
    </section>
  );
}
