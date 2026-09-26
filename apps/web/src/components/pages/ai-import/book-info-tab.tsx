import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "./field";
import type { AiFieldCandidates, AiFieldKey, EditableBookForm } from "./types";
import type { PostIsbnAiSuggestions } from "@/services/ai";
import { splitCommaValues } from "./utils";

function FieldGroup({
  id,
  title,
  hint,
  actions,
  children,
}: {
  id: string;
  title: string;
  hint: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-x-8 gap-y-4 border-t border-border py-7 first:border-t-0 first:pt-0 last:pb-0 xl:grid-cols-[168px_minmax(0,1fr)]">
      <div className="flex items-start justify-between gap-3 xl:block">
        <div>
          <h3 id={id} className="text-[14px] font-semibold text-foreground">{title}</h3>
          <p className="mt-1 max-w-[46ch] text-[12px] leading-5 text-muted-foreground">{hint}</p>
        </div>
        {actions ? <div className="shrink-0 xl:mt-3">{actions}</div> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function SuggestionChips({ value }: { value: string }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {splitCommaValues(value).map((item, index) => (
        <li key={`${item}-${index}`}className="rounded-full border border-violet-200 bg-card px-2.5 py-0.5 text-[12px] text-violet-800 dark:border-violet-500/25 dark:text-violet-200">
          {item}
        </li>
      ))}
    </ul>
  );
}

/**
 * One consistent frame for every field AI can write: label and generate action
 * share a header row, the control sits below, and a pending suggestion unfolds
 * inside the same frame so it is read next to the value it would replace.
 * Violet is reserved for AI throughout this page.
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
  applyLabel = "Áp dụng",
  chips = false,
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
  applyLabel?: string;
  chips?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const shouldReduceMotion = useReducedMotion();
  const candidate = candidates[field];
  const isLoading = loading[field];
  const hasSuggestion = Boolean(candidate?.value.trim());

  return (
    <div className={`overflow-hidden rounded-lg border bg-card transition-colors focus-within:border-violet-300 dark:focus-within:border-violet-500/40 ${hasSuggestion ? "border-violet-200 dark:border-violet-500/25" : "border-border"} ${className}`}>
      <div className="flex min-h-10 items-center justify-between gap-2 py-1.5 pl-3.5 pr-2">
        <Label htmlFor={id} className="text-[12px] font-semibold text-foreground">{label}</Label>
        <button
          type="button"
          onClick={() => onRegenerate(field)}
          disabled={isLoading || disabled}
          title={disabled ? "Cần có tên sách để dùng AI" : undefined}
          className="inline-flex min-h-7 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-violet-700 transition-colors hover:bg-violet-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30 disabled:cursor-not-allowed disabled:opacity-45 dark:text-violet-300 dark:hover:bg-violet-500/10"
        >
          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : hasSuggestion ? <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />}
          {isLoading ? "Đang tạo…" : hasSuggestion ? "Tạo lại" : "Tạo bằng AI"}
        </button>
      </div>

      <div className="px-3.5 pb-3">{children}</div>

      <AnimatePresence initial={false}>
        {hasSuggestion ? (
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="border-t border-violet-200/70 bg-violet-50/60 px-3.5 py-3 dark:border-violet-500/15 dark:bg-violet-500/[0.06]">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-violet-700 dark:text-violet-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Đề xuất AI{candidate!.source === "postIsbn" ? " · từ ISBN" : ""}
              </p>
              <div className="mt-2">
                {chips ? (
                  <SuggestionChips value={candidate!.value} />
                ) : (
                  <p className="max-h-32 max-w-[72ch] overflow-y-auto whitespace-pre-wrap text-[13px] leading-6 text-violet-950/80 dark:text-violet-100/80">{candidate!.value}</p>
                )}
              </div>
              <div className="mt-3 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onApply(field)}
                  className="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-violet-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 dark:bg-violet-500 dark:hover:bg-violet-600"
                >
                  {applyLabel}
                </button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const bareInput = "border-none bg-transparent p-0 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent";

export function BookInfoTab({
  form,
  onFieldChange,
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
  const providerNote = hasPostIsbnSuggestions && postIsbnSuggestions
    ? postIsbnSuggestions.provider === "none"
      ? "AI không khả dụng"
      : `${postIsbnSuggestions.provider} · ${Math.round((postIsbnSuggestions.confidence || 0) * 100)}% tin cậy`
    : null;

  return (
    <div>
      <FieldGroup id="group-identity" title="Nhận diện" hint="Dùng để khớp ấn bản và kiểm tra trùng trong catalog.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
          <Field id="isbn" className="sm:col-span-2" label="ISBN" mono required value={form.isbn} onChange={(v) => onFieldChange("isbn", v)} />
          <Field id="title" className="sm:col-span-4" label="Tên sách" required inputClassName="font-medium" value={form.title} onChange={(v) => onFieldChange("title", v)} />
          <Field id="subtitle" className="sm:col-span-6" label="Tựa phụ" value={form.subtitle} onChange={(v) => onFieldChange("subtitle", v)} />
        </div>
      </FieldGroup>

      <FieldGroup id="group-people" title="Tác giả" hint="Nhiều người thì cách nhau bằng dấu phẩy.">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="authors" label="Tác giả" value={form.authorsText} onChange={(v) => onFieldChange("authorsText", v)} />
          <Field id="translator" label="Dịch giả" value={form.translatorText || ""} onChange={(v) => onFieldChange("translatorText", v)} />
        </div>
      </FieldGroup>

      <FieldGroup id="group-publishing" title="Xuất bản" hint="Thông tin ấn bản vật lý của cuốn sách đang nhập.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
          <Field id="publisher" className="col-span-2 sm:col-span-6" label="Nhà xuất bản" value={form.publisher} onChange={(v) => onFieldChange("publisher", v)} />
          <Field id="publishedDate" className="sm:col-span-2" label="Ngày xuất bản" value={form.publishedDate} onChange={(v) => onFieldChange("publishedDate", v)} />
          <Field id="pageCount" className="sm:col-span-2" label="Số trang" mono value={form.pageCount} onChange={(v) => onFieldChange("pageCount", v)} />
          <Field id="language" className="col-span-2 sm:col-span-2" label="Ngôn ngữ" value={form.language} onChange={(v) => onFieldChange("language", v)} />
          <Field id="isbn13" className="col-span-2 sm:col-span-3" label="ISBN-13" mono value={form.isbn13} onChange={(v) => onFieldChange("isbn13", v)} />
          <Field id="isbn10" className="col-span-2 sm:col-span-3" label="ISBN-10" mono value={form.isbn10} onChange={(v) => onFieldChange("isbn10", v)} />
        </div>
      </FieldGroup>

      <FieldGroup
        id="group-ai"
        title="Nội dung"
        hint="AI chỉ đề xuất. Xem trước rồi bấm Áp dụng — không có gì tự ghi đè."
        actions={(
          <div className="flex flex-wrap items-center gap-2 xl:flex-col xl:items-start">
            {aiSuggestionCount > 0 ? (
              <button
                type="button"
                onClick={onApplyAllFields}
                className="inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-violet-600 px-3 text-[12px] font-semibold text-white transition-colors hover:bg-violet-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-1 dark:bg-violet-500 dark:hover:bg-violet-600"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                Áp dụng {aiSuggestionCount} đề xuất
              </button>
            ) : null}
            <button
              type="button"
              onClick={onQualityCheck}
              disabled={qualityCheckLoading || noTitle}
              title={noTitle ? "Cần có tên sách để dùng AI" : undefined}
              className="inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              {qualityCheckLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              Kiểm tra chất lượng
            </button>
            {providerNote ? <span className="text-[11px] text-muted-foreground">{providerNote}</span> : null}
          </div>
        )}
      >
        {qualityCheckResult ? (
          <div
            role="status"
            className={`mb-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] ${qualityCheckResult.warnings.length === 0 ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-foreground"}`}
          >
            {qualityCheckResult.warnings.length === 0 ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              {qualityCheckResult.warnings.length === 0 ? (
                <p className="font-medium">Metadata đạt chất lượng tốt</p>
              ) : (
                <>
                  <p className="font-semibold">{qualityCheckResult.warnings.length} cảnh báo chất lượng</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                    {qualityCheckResult.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                  </ul>
                </>
              )}
            </div>
            <button type="button" onClick={onDismissQualityCheck} aria-label="Đóng kết quả kiểm tra" className="-m-1 cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <AiAssistedField
            id="description"
            label="Mô tả"
            field="description"
            candidates={aiFieldCandidates}
            loading={aiFieldLoading}
            disabled={noTitle}
            onRegenerate={onRegenerateField}
            onApply={onApplyField}
            applyLabel="Thay mô tả"
            className="md:col-span-2"
          >
            <Textarea id="description" value={form.description} onChange={(e) => onFieldChange("description", e.target.value)} rows={5} placeholder="Giới thiệu nội dung sách cho bạn đọc…" className={`min-h-28 max-h-72 resize-y overflow-y-auto leading-6 ${bareInput}`} />
          </AiAssistedField>

          <AiAssistedField
            id="summaryVi"
            label="Tóm tắt cho chatbot"
            field="summaryVi"
            candidates={aiFieldCandidates}
            loading={aiFieldLoading}
            disabled={noTitle}
            onRegenerate={onRegenerateField}
            onApply={onApplyField}
            applyLabel="Thay tóm tắt"
            className="md:col-span-2"
          >
            <Textarea id="summaryVi" value={form.summaryVi} onChange={(e) => onFieldChange("summaryVi", e.target.value)} rows={2} placeholder="2–3 câu, chatbot dùng để giới thiệu sách…" className={`min-h-14 resize-y leading-6 ${bareInput}`} />
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
            applyLabel="Thêm từ khóa"
            chips
          >
            <Input id="keywords" value={form.keywordsText} onChange={(e) => onFieldChange("keywordsText", e.target.value)} placeholder="Cách nhau bằng dấu phẩy" className={`h-7 ${bareInput}`} />
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
            applyLabel="Thêm thể loại"
            chips
          >
            <Input id="categories" value={form.categoriesText} onChange={(e) => onFieldChange("categoriesText", e.target.value)} placeholder="Cách nhau bằng dấu phẩy" className={`h-7 ${bareInput}`} />
          </AiAssistedField>
        </div>
      </FieldGroup>
    </div>
  );
}
