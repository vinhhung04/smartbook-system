import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { LookupBookByIsbnResponse, PostIsbnAiSuggestions } from "@/services/ai";
import { CoverPreview, type FieldOrigin } from "./field";
import { FieldProvenance, FieldStateLabel } from "./field-provenance";
import { FIELD_FILTERS, fieldState, type FieldFilter } from "./field-review-model";
import { AiField, AiReviewStrip, AiSuggestionPanel, type AiFieldCopy, type AiReviewItem } from "./ai-suggestion";
import { AI_FORM_FIELD, type AiAppliedChange, type AiFieldCandidates, type AiFieldKey, type EditableBookForm } from "./types";
import { normalizeForCompare, normalizeIsbnInput, splitCommaValues } from "./utils";

const AI_COPY: Record<AiFieldKey, AiFieldCopy> = {
  description: { noun: "mô tả", kind: "text" },
  summaryVi: { noun: "tóm tắt", kind: "text" },
  keywords: { noun: "từ khóa", kind: "chips" },
  categories: { noun: "thể loại", kind: "chips" },
};

type FormKey = keyof EditableBookForm;

const AI_FIELD_FOR: Partial<Record<FormKey, AiFieldKey>> = {
  description: "description", summaryVi: "summaryVi", keywordsText: "keywords", categoriesText: "categories",
};

const inputClass = "min-h-11 border-border/80 bg-muted/[0.12] text-[14px] shadow-none transition-colors focus-visible:bg-card";

function Group({ id, title, hint, actions, children }: { id: string; title: string; hint: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-1 pt-5 sm:px-6">
        <div className="min-w-0">
          <h3 id={id} className="text-[15px] font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 max-w-[62ch] text-[12.5px] leading-5 text-muted-foreground">{hint}</p>
        </div>
        {actions ? <div className="min-w-0 max-w-full">{actions}</div> : null}
      </div>
      <div className="min-w-0 px-5 pb-3 sm:px-6">{children}</div>
    </section>
  );
}

export function MetadataReview({
  form, onFieldChange, lookup, userEdited, origins, showRequired, filter, onFilterChange,
  aiFieldCandidates, aiFieldLoading, aiFieldErrors, aiApplied, aiDismissed, existingCategories, onRegenerateField, onApplyField, onApplyAllFields,
  onUndoAiField, onUndoAllAiFields, onDismissAiField,
  qualityCheckLoading, qualityCheckResult, onQualityCheck, onDismissQualityCheck, postIsbnSuggestions, hasPostIsbnSuggestions,
}: {
  form: EditableBookForm;
  /** The page's own field handler: marks the field as the user's and updates the form. */
  onFieldChange: (field: FormKey, value: string) => void;
  lookup: LookupBookByIsbnResponse | null;
  userEdited: ReadonlySet<string>;
  origins: Partial<Record<FormKey, FieldOrigin>>;
  showRequired: boolean;
  filter: FieldFilter;
  onFilterChange: (filter: FieldFilter) => void;
  aiFieldCandidates: AiFieldCandidates;
  aiFieldLoading: Record<AiFieldKey, boolean>;
  onRegenerateField: (field: AiFieldKey) => void;
  aiFieldErrors: Partial<Record<AiFieldKey, string>>;
  aiApplied: Partial<Record<AiFieldKey, AiAppliedChange>>;
  /** Suggestions the user skipped, so the review count stays honest. */
  aiDismissed: Partial<Record<AiFieldKey, true>>;
  existingCategories: string[];
  /** Chips fields take the chips the user kept; text fields replace the value. */
  onApplyField: (field: AiFieldKey, selected?: string[]) => void;
  onApplyAllFields: () => void;
  onUndoAiField: (field: AiFieldKey) => void;
  onUndoAllAiFields: () => void;
  onDismissAiField: (field: AiFieldKey) => void;
  qualityCheckLoading: boolean;
  qualityCheckResult: { provider: string; warnings: string[] } | null;
  onQualityCheck: () => void;
  onDismissQualityCheck: () => void;
  postIsbnSuggestions: PostIsbnAiSuggestions | null;
  hasPostIsbnSuggestions: boolean;
}) {
  const noTitle = !form.title.trim();
  const stateOf = (field: FormKey) => fieldState({
    field, lookup, value: String(form[field] ?? ""), origin: origins[field], edited: userEdited.has(field),
    hasAiSuggestion: Boolean(AI_FIELD_FOR[field] && aiFieldCandidates[AI_FIELD_FOR[field]!]?.value.trim()),
    aiApplied: Boolean(AI_FIELD_FOR[field] && aiApplied[AI_FIELD_FOR[field]!]),
  });
  const visible = (field: FormKey) => filter === "all" || stateOf(field).filters.has(filter);
  const allFields: FormKey[] = ["isbn", "isbn13", "isbn10", "title", "subtitle", "authorsText", "translatorText", "publisher", "publishedDate",
    "pageCount", "language", "description", "summaryVi", "categoriesText", "keywordsText", "thumbnail"];
  const counts = Object.fromEntries(FIELD_FILTERS.map(({ id }) => [id, allFields.filter((f) => id === "all" || stateOf(f).filters.has(id)).length])) as Record<FieldFilter, number>;
  const errors: Partial<Record<FormKey, string>> = {
    ...(showRequired && !normalizeIsbnInput(form.isbn) ? { isbn: "Cần ISBN để lưu sách" } : {}),
    ...(showRequired && noTitle ? { title: "Cần tên sách để lưu" } : {}),
  };
  const providerNote = hasPostIsbnSuggestions && postIsbnSuggestions
    ? postIsbnSuggestions.provider === "none" ? "AI không khả dụng lúc tra cứu." : `Do ${postIsbnSuggestions.provider} viết; AI tự đánh giá ${Math.round((postIsbnSuggestions.confidence || 0) * 100)}%, đây không phải độ chính xác.`
    : null;

  // A render helper, not a component: a component declared here would remount the inputs on every keystroke.
  const renderRow = ({ field, id, label, required, mono, inputMode, hint }: {
    field: FormKey; id: string; label: string; required?: boolean; mono?: boolean; inputMode?: "numeric" | "text"; hint?: string;
  }) => {
    const error = errors[field];
    const errorId = `${id}-error`;
    return (
      <div key={field} hidden={!visible(field)} data-field-row={field} className="grid gap-x-6 gap-y-1.5 border-t border-border/70 py-4 first:border-t-0 md:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="min-w-0 md:pt-2.5">
          <Label htmlFor={id} className="text-[13px] font-semibold text-foreground">
            {label}{required ? <span className="text-destructive" aria-hidden="true">*</span> : null}
          </Label>
          <div className="mt-0.5"><FieldStateLabel state={stateOf(field)} /></div>
        </div>
        <div className="min-w-0">
          <Input id={id} value={String(form[field] ?? "")} onChange={(event) => onFieldChange(field, event.target.value)} inputMode={inputMode}
            aria-required={required || undefined} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
            className={`${inputClass} ${mono ? "font-mono tabular-nums" : ""} ${field === "title" ? "font-medium" : ""} ${error ? "border-red-400 dark:border-red-500/60" : ""}`} />
          {hint ? <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p> : null}
          {error ? (
            <p id={errorId} role="alert" className="mt-1 flex items-center gap-1 text-[12px] text-red-700 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{error}
            </p>
          ) : null}
          <FieldProvenance field={field} label={label} lookup={lookup} value={String(form[field] ?? "")} onChoose={(value) => onFieldChange(field, value)} />
        </div>
      </div>
    );
  }

  const aiKeys = Object.keys(AI_COPY) as AiFieldKey[];
  const pendingAi = aiKeys.filter((key) => aiFieldCandidates[key]?.value.trim() && !aiApplied[key] && !aiFieldLoading[key] && !aiFieldErrors[key]);
  const describeAi = (key: AiFieldKey) => {
    const current = String(form[AI_FORM_FIELD[key]] ?? "");
    if (AI_COPY[key].kind === "text") return `${current.trim() ? "thay" : "điền"} ${AI_COPY[key].noun}`;
    const present = new Set(splitCommaValues(current).map(normalizeForCompare));
    const fresh = splitCommaValues(aiFieldCandidates[key]?.value || "").filter((chip) => !present.has(normalizeForCompare(chip))).length;
    return fresh ? `thêm ${fresh} ${AI_COPY[key].noun}` : `${AI_COPY[key].noun} (đã có đủ)`;
  };
  // One item per suggestion this lookup produced: waiting, applied (Undo is on the field) or skipped.
  const aiReviewItems: AiReviewItem[] = aiKeys.flatMap((key): AiReviewItem[] => {
    if (aiApplied[key]) return [{ key, state: "applied" as const, action: AI_COPY[key].kind === "text" ? `${AI_COPY[key].noun} mới` : AI_COPY[key].noun }];
    if (aiDismissed[key]) return [{ key, state: "dismissed" as const, action: AI_COPY[key].noun }];
    if (pendingAi.includes(key)) return [{ key, state: "pending" as const, action: describeAi(key) }];
    return [];
  });

  // A render helper (not a component), so the controls inside keep their identity between renders.
  const renderAiField = ({ field, id, label, formField, children }: { field: AiFieldKey; id: string; label: string; formField: FormKey; children: ReactNode }) => {
    const candidate = aiFieldCandidates[field];
    const applied = aiApplied[field];
    return (
      <AiField id={id} label={label} status={<FieldStateLabel state={stateOf(formField)} />} generating={aiFieldLoading[field]}
        hasSuggestion={Boolean(candidate?.value.trim())} disabled={noTitle} onGenerate={() => onRegenerateField(field)}
        appliedKey={applied ? applied.applied : undefined}
        suggestion={(
          <AiSuggestionPanel key={candidate?.value || "none"} copy={AI_COPY[field]} candidate={candidate} loading={aiFieldLoading[field]}
            error={aiFieldErrors[field]} applied={applied} currentValue={String(form[formField] ?? "")}
            existingCategories={field === "categories" ? existingCategories : undefined} disabled={noTitle}
            onApply={(selected) => onApplyField(field, selected)} onUndo={() => onUndoAiField(field)}
            onDismiss={() => onDismissAiField(field)} onRegenerate={() => onRegenerateField(field)} />
        )}>
        {children}
      </AiField>
    );
  };
  const identityFields: FormKey[] = ["isbn", "isbn13", "isbn10", "title", "subtitle", "authorsText", "translatorText", "publisher", "publishedDate", "pageCount", "language"];
  const contentFields: FormKey[] = ["description", "summaryVi", "categoriesText", "keywordsText"];
  const nothingVisible = !allFields.some(visible);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold text-foreground">Kiểm duyệt metadata</h2>
          <p className="mt-0.5 max-w-[64ch] text-[12.5px] leading-5 text-muted-foreground">
            Giá trị đang điền là giá trị hệ thống chọn. Mở bằng chứng để xem từng nguồn và chọn giá trị khác — không có gì tự ghi đè trường bạn đã sửa.
          </p>
        </div>
      </div>
      <div role="group" aria-label="Lọc trường metadata" className="flex flex-wrap gap-1.5">
        {FIELD_FILTERS.map(({ id, label }) => (
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => onFilterChange(id)} disabled={id !== "all" && !counts[id]}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45 aria-pressed:border-primary/40 aria-pressed:bg-primary/10 aria-pressed:text-primary">
            {label}<span className="tabular-nums">{counts[id]}</span>
          </button>
        ))}
      </div>
      {nothingVisible ? <p className="text-[13px] text-muted-foreground">Không có trường nào khớp bộ lọc này.</p> : null}

      <div hidden={!identityFields.some(visible)}>
        <Group id="group-identity" title="Thông tin định danh" hint="ISBN và tên sách là bắt buộc; dùng để khớp ấn bản và kiểm tra trùng. Nhiều người thì cách nhau bằng dấu phẩy.">
          {renderRow({ field: "isbn", id: "isbn", label: "ISBN", required: true, mono: true, hint: "Mã dùng để lưu và làm mã vạch nội bộ." })}
          {renderRow({ field: "isbn13", id: "isbn13", label: "ISBN-13", mono: true })}
          {renderRow({ field: "isbn10", id: "isbn10", label: "ISBN-10", mono: true })}
          {renderRow({ field: "title", id: "title", label: "Tên sách", required: true })}
          {renderRow({ field: "subtitle", id: "subtitle", label: "Tựa phụ" })}
          {renderRow({ field: "authorsText", id: "authors", label: "Tác giả" })}
          {renderRow({ field: "translatorText", id: "translator", label: "Dịch giả" })}
          {renderRow({ field: "publisher", id: "publisher", label: "Nhà xuất bản" })}
          {renderRow({ field: "publishedDate", id: "publishedDate", label: "Năm xuất bản" })}
          {renderRow({ field: "pageCount", id: "pageCount", label: "Số trang", mono: true, inputMode: "numeric" })}
          {renderRow({ field: "language", id: "language", label: "Ngôn ngữ" })}
        </Group>
      </div>

      <div hidden={!contentFields.some(visible)}>
        <Group id="group-content" title="Mô tả và phân loại" hint="Trợ lý AI chỉ đề xuất. Xem trước rồi bấm Áp dụng — không có gì tự ghi đè nội dung bạn đã viết."
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onQualityCheck} disabled={qualityCheckLoading || noTitle} title={noTitle ? "Cần có tên sách để dùng AI" : undefined}
                className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                {qualityCheckLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                Kiểm tra chất lượng
              </button>
            </div>
          )}>
          <AiReviewStrip items={aiReviewItems} note={providerNote} onApplyAll={onApplyAllFields} onUndoAll={onUndoAllAiFields} />
          {qualityCheckResult ? (
            <div role="status" className={`mb-2 mt-3 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] ${qualityCheckResult.warnings.length === 0 ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-warning/30 bg-warning/10"}`}>
              {qualityCheckResult.warnings.length === 0
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />}
              <div className="min-w-0 flex-1 text-foreground">
                {qualityCheckResult.warnings.length === 0 ? (
                  <><p className="font-medium">AI không đưa ra cảnh báo chất lượng nào</p><p className="mt-0.5 text-muted-foreground">Điều này không bảo đảm metadata đúng — vẫn nên so với sách thật.</p></>
                ) : (
                  <><p className="font-semibold">{qualityCheckResult.warnings.length} cảnh báo chất lượng (không chặn việc lưu)</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">{qualityCheckResult.warnings.map((w, i) => <li key={`${w}-${i}`}>{w}</li>)}</ul></>
                )}
              </div>
              <button type="button" onClick={onDismissQualityCheck} aria-label="Đóng kết quả kiểm tra" className="-m-1 cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 py-4">
            <div hidden={!visible("description")} data-field-row="description">
              {renderAiField({ field: "description", id: "description", label: "Mô tả", formField: "description", children: (
                <Textarea id="description" value={form.description} onChange={(e) => onFieldChange("description", e.target.value)} rows={5} placeholder="Giới thiệu nội dung sách cho bạn đọc…"
                  className="min-h-28 max-h-72 resize-y overflow-y-auto border-none bg-transparent p-0 text-[14px] leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent" />
              ) })}
              <FieldProvenance field="description" label="Mô tả" lookup={lookup} value={form.description} onChoose={(value) => onFieldChange("description", value)} />
            </div>
            <div hidden={!visible("summaryVi")} data-field-row="summaryVi">
              {renderAiField({ field: "summaryVi", id: "summaryVi", label: "Tóm tắt tiếng Việt", formField: "summaryVi", children: (
                <Textarea id="summaryVi" value={form.summaryVi} onChange={(e) => onFieldChange("summaryVi", e.target.value)} rows={2} placeholder="2–3 câu, chatbot dùng để giới thiệu sách…"
                  className="min-h-14 resize-y border-none bg-transparent p-0 text-[14px] leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent" />
              ) })}
            </div>
            <div hidden={!visible("categoriesText")} data-field-row="categoriesText">
              {renderAiField({ field: "categories", id: "categories", label: "Thể loại", formField: "categoriesText", children: (
                <Input id="categories" value={form.categoriesText} onChange={(e) => onFieldChange("categoriesText", e.target.value)} placeholder="Cách nhau bằng dấu phẩy"
                  className="h-8 border-none bg-transparent p-0 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent" />
              ) })}
              <FieldProvenance field="categoriesText" label="Thể loại" lookup={lookup} value={form.categoriesText} onChoose={(value) => onFieldChange("categoriesText", value)} />
            </div>
            <div hidden={!visible("keywordsText")} data-field-row="keywordsText">
              {renderAiField({ field: "keywords", id: "keywords", label: "Từ khóa", formField: "keywordsText", children: (
                <Input id="keywords" value={form.keywordsText} onChange={(e) => onFieldChange("keywordsText", e.target.value)} placeholder="Cách nhau bằng dấu phẩy"
                  className="h-8 border-none bg-transparent p-0 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent" />
              ) })}
            </div>
          </div>
        </Group>
      </div>

      <div hidden={!visible("thumbnail")}>
        <Group id="group-cover" title="Ảnh bìa" hint="Ảnh lấy từ nguồn tra cứu, hoặc dán URL ảnh khác. Ảnh chỉ được lưu cùng sách khi bạn bấm Lưu.">
          <div className="grid gap-5 py-4 sm:grid-cols-[8rem_minmax(0,1fr)]" data-field-row="thumbnail">
            <div className="aspect-[2/3] w-28 overflow-hidden rounded-md border border-border/70 bg-muted sm:w-32">
              <CoverPreview key={form.thumbnail} src={form.thumbnail} alt={form.title ? `Bìa sách ${form.title}` : "Ảnh bìa sách"} />
            </div>
            <div className="min-w-0">
              <Label htmlFor="thumbnail" className="text-[13px] font-semibold text-foreground">URL ảnh bìa</Label>
              <div className="mt-0.5"><FieldStateLabel state={stateOf("thumbnail")} /></div>
              <Input id="thumbnail" value={form.thumbnail} onChange={(e) => onFieldChange("thumbnail", e.target.value)} placeholder="https://…" className={`mt-2 ${inputClass}`} />
              <FieldProvenance field="thumbnail" label="Ảnh bìa" lookup={lookup} value={form.thumbnail} onChoose={(value) => onFieldChange("thumbnail", value)}
                preview={(value) => (
                  <div className="flex items-center gap-3">
                    <div className="aspect-[2/3] w-12 shrink-0 overflow-hidden rounded border border-border/70 bg-muted"><CoverPreview src={value} alt="Ảnh bìa ứng viên" /></div>
                    <p className="min-w-0 break-all text-[12px] text-muted-foreground">{value}</p>
                  </div>
                )} />
            </div>
          </div>
        </Group>
      </div>
    </div>
  );
}
