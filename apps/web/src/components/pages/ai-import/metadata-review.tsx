import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CrossLookup, LookupBookByIsbnResponse, PostIsbnAiSuggestions } from "@/services/ai";
import { CrossLookupField } from "./cross-lookup-card";
import { CoverPreview, type FieldOrigin } from "./field";
import { FieldProvenance, FieldStateLabel } from "./field-provenance";
import { FIELD_FILTERS, fieldState, type FieldFilter } from "./field-review-model";
import { AiField, AiReviewStrip, AiSuggestionPanel, type AiFieldCopy, type AiReviewItem } from "./ai-suggestion";
import { AI_FIELD_NOUN, AI_FORM_FIELD, qualityCheckBasis, type AiAppliedChange, type AiFieldCandidates, type AiFieldKey, type EditableBookForm, type QualityCheckResult } from "./types";
import { normalizeForCompare, planBulkAiApply, resolveBookCodes, splitCommaValues, type BulkHoldReason } from "./utils";

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

const HOLD_REASON: Record<BulkHoldReason, string> = {
  edited: "bạn đã sửa hoặc chọn giá trị khác",
  stale: "trường đã đổi sau khi AI viết",
  replaces: "sẽ thay nội dung đang có",
  newCategories: "chỉ có thể loại chưa có trong danh mục",
};

/** Which field a quality warning is about, so the warning can take the user there. */
const WARNING_FIELD: Array<[RegExp, string]> = [
  [/mô tả/i, "description"], [/tác giả/i, "authors"], [/nhà xuất bản/i, "publisher"], [/thể loại/i, "categories"],
];

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

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
  crossLookup, crossOpen = false, onCrossToggle, onCrossApply,
}: {
  /** EAN-13 <-> ISBN cross lookup, shown under the field it fills (ISBN-13, or the barcode). */
  crossLookup?: CrossLookup | null;
  crossOpen?: boolean;
  onCrossToggle: () => void;
  /** Puts a chosen code in its field: the page's explicit-choice handler. */
  onCrossApply: (patch: Partial<EditableBookForm>, label: string) => void;
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
  qualityCheckResult: QualityCheckResult | null;
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
  const allFields: FormKey[] = ["isbn", "isbn13", "isbn10", "internalBarcode", "title", "subtitle", "authorsText", "translatorText", "publisher", "publishedDate",
    "pageCount", "language", "description", "summaryVi", "categoriesText", "keywordsText", "thumbnail"];
  const counts = Object.fromEntries(FIELD_FILTERS.map(({ id }) => [id, allFields.filter((f) => id === "all" || stateOf(f).filters.has(id)).length])) as Record<FieldFilter, number>;
  // A code typed into the field of another kind (e.g. an 893... EAN as ISBN-13) is flagged at once.
  const codes = resolveBookCodes(form);
  const errors: Partial<Record<FormKey, string>> = {
    ...codes.errors,
    ...(showRequired && !codes.hasCode && !codes.errors.isbn ? { isbn: "Cần ISBN hoặc mã vạch EAN-13 để lưu sách" } : {}),
    ...(showRequired && noTitle ? { title: "Cần tên sách để lưu" } : {}),
  };
  // No model name and no self-rated score: neither helps a librarian decide; reading the text does.
  const providerNote = hasPostIsbnSuggestions && postIsbnSuggestions
    ? postIsbnSuggestions.provider === "none" ? "AI không khả dụng lúc tra cứu." : "AI viết từ metadata đã tra cứu; đọc lại trước khi dùng."
    : null;

  // The EAN-13 <-> ISBN cross lookup under the field it fills, like a field's value comparison.
  const renderCrossLookup = (direction: CrossLookup["direction"], current: string) => {
    if (!crossLookup || crossLookup.direction !== direction) return null;
    if (direction === "ISBN_TO_EAN" && crossLookup.status === "NOT_FOUND") return null; // the usual case: nothing to say
    return <CrossLookupField cross={crossLookup} current={current} open={crossOpen} onToggle={onCrossToggle} onApply={onCrossApply} />;
  };

  // A render helper, not a component: a component declared here would remount the inputs on every keystroke.
  const renderRow =({ field, id, label, required, mono, inputMode, hint, extra }: {
    field: FormKey; id: string; label: string; required?: boolean; mono?: boolean; inputMode?: "numeric" | "text"; hint?: string; extra?: ReactNode;
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
          {extra}
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
  // What one click on the bulk action would do, and what it leaves for the user (planBulkAiApply).
  const bulk = planBulkAiApply({ form, candidates: aiFieldCandidates, applied: aiApplied, edited: userEdited, existingCategories });
  const bulkSafe = bulk.apply.filter(({ field }) => pendingAi.includes(field)).map(({ field, added }) =>
    AI_COPY[field].kind === "text" ? `${String(form[AI_FORM_FIELD[field]] ?? "").trim() ? "thay" : "điền"} ${AI_FIELD_NOUN[field]}` : `thêm ${added} ${AI_FIELD_NOUN[field]}`);
  const bulkHeld = bulk.held.filter(({ field }) => pendingAi.includes(field)).map(({ field, reason }) => `${AI_FIELD_NOUN[field]} (${HOLD_REASON[reason]})`);
  const isStale = (field: AiFieldKey) => {
    const candidate = aiFieldCandidates[field];
    return Boolean(candidate?.value.trim() && !aiApplied[field] && String(form[AI_FORM_FIELD[field]] ?? "") !== candidate.basis);
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
            existingCategories={field === "categories" ? existingCategories : undefined} disabled={noTitle} stale={isStale(field)}
            onApply={(selected) => onApplyField(field, selected)} onUndo={() => onUndoAiField(field)}
            onDismiss={() => onDismissAiField(field)} onRegenerate={() => onRegenerateField(field)} />
        )}>
        {children}
      </AiField>
    );
  };
  const identityFields: FormKey[] = ["isbn", "isbn13", "isbn10", "internalBarcode", "title", "subtitle", "authorsText", "translatorText", "publisher", "publishedDate", "pageCount", "language"];
  const contentFields: FormKey[] = ["description", "summaryVi", "categoriesText", "keywordsText"];
  const nothingVisible = !allFields.some(visible);
  const qualityOutdated = Boolean(qualityCheckResult && !qualityCheckResult.error && qualityCheckResult.basis !== qualityCheckBasis(form));

  // One always-mounted live region: a suggestion that lands, or a finished check, is said
  // once (a region inserted already holding its text is often not announced at all).
  const [announcement, setAnnouncement] = useState("");
  const seenCandidates = useRef<Partial<Record<AiFieldKey, string>>>({});
  const candidateKey = aiKeys.map((key) => aiFieldCandidates[key]?.value || "").join("\u0000");
  useEffect(() => {
    const fresh = aiKeys.filter((key) => {
      const value = aiFieldCandidates[key]?.value || "";
      const changed = value && value !== seenCandidates.current[key];
      seenCandidates.current[key] = value;
      return changed;
    });
    if (fresh.length) setAnnouncement(`Có đề xuất AI mới cho ${fresh.map((key) => AI_FIELD_NOUN[key]).join(", ")}. Chưa áp dụng.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- candidateKey is the change signal
  }, [candidateKey]);
  useEffect(() => {
    if (!qualityCheckResult) return;
    setAnnouncement(qualityCheckResult.error ? `Kiểm tra chất lượng lỗi: ${qualityCheckResult.error}`
      : qualityCheckResult.warnings.length ? `Kiểm tra chất lượng xong: ${qualityCheckResult.warnings.length} cảnh báo.` : "Kiểm tra chất lượng xong: không có cảnh báo.");
  }, [qualityCheckResult]);

  const goToField = (id: string) => {
    const element = document.getElementById(id);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus({ preventScroll: true });
  };

  return (
    <div className="space-y-5">
      <p className="sr-only" aria-live="polite">{announcement}</p>
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
        <Group id="group-identity" title="Thông tin định danh" hint="Cần ISBN hoặc mã vạch EAN-13, và tên sách; dùng để khớp ấn bản và kiểm tra trùng. Nhiều người thì cách nhau bằng dấu phẩy.">
          {renderRow({ field: "isbn", id: "isbn", label: "ISBN / EAN-13", required: true, mono: true, hint: "Mã in trên sách dùng để tra cứu. Mã EAN-13 bán lẻ (vd. 893…) không phải ISBN: được lưu ở ô mã vạch." })}
          {renderRow({ field: "isbn13", id: "isbn13", label: "ISBN-13", mono: true, extra: renderCrossLookup("EAN_TO_ISBN", form.isbn13) })}
          {renderRow({ field: "isbn10", id: "isbn10", label: "ISBN-10", mono: true })}
          {renderRow({ field: "internalBarcode", id: "internalBarcode", label: "Mã vạch EAN-13", mono: true, hint: "EAN-13 bán lẻ in dưới mã vạch. Để trống thì ISBN-13 được dùng làm mã vạch.",
            extra: renderCrossLookup("ISBN_TO_EAN", form.internalBarcode) })}
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
        <Group id="group-content" title="Mô tả và phân loại" hint="AI chỉ đề xuất: đọc đề xuất ở từng trường rồi chọn Dùng, Thay hoặc Thêm. Áp dụng hàng loạt bỏ qua trường bạn đã sửa."
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={onQualityCheck} disabled={qualityCheckLoading || noTitle} title={noTitle ? "Cần có tên sách để dùng AI" : undefined}
                className="inline-flex min-h-9 pointer-coarse:min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring">
                {qualityCheckLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                Kiểm tra chất lượng
              </button>
            </div>
          )}>
          <AiReviewStrip items={aiReviewItems} note={providerNote} safe={bulkSafe} held={bulkHeld} onApplyAll={onApplyAllFields} onUndoAll={onUndoAllAiFields} />
          {qualityCheckResult ? (
            <div className={`mb-2 mt-3 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] ${
              qualityCheckResult.error ? "border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10"
                : qualityCheckResult.warnings.length === 0 ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-warning/30 bg-warning/10"}`}>
              {qualityCheckResult.error ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
                : qualityCheckResult.warnings.length === 0
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />}
              <div className="min-w-0 flex-1 text-foreground">
                {qualityCheckResult.error ? (
                  <><p className="font-medium">Chưa kiểm tra được chất lượng</p><p className="mt-0.5 text-muted-foreground">{qualityCheckResult.error}</p></>
                ) : qualityCheckResult.warnings.length === 0 ? (
                  <><p className="font-medium">Không có cảnh báo chất lượng</p><p className="mt-0.5 text-muted-foreground">Kiểm tra theo quy tắc, không bảo đảm metadata đúng — vẫn nên so với sách thật.</p></>
                ) : (
                  <><p className="font-semibold">{qualityCheckResult.warnings.length} cảnh báo chất lượng (không chặn việc lưu)</p>
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      {qualityCheckResult.warnings.map((warning, index) => {
                        const target = WARNING_FIELD.find(([pattern]) => pattern.test(warning))?.[1];
                        return (
                          <li key={`${warning}-${index}`} className="flex flex-wrap items-center gap-x-2">
                            <span>{warning}</span>
                            {target ? (
                              <button type="button" onClick={() => goToField(target)}
                                className="inline-flex min-h-8 pointer-coarse:min-h-[44px] cursor-pointer items-center rounded px-1 text-[12.5px] font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
                                Xem trường<span className="sr-only"> liên quan</span>
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul></>
                )}
                {!qualityCheckResult.error ? (
                  <p className={`mt-1.5 text-[12px] ${qualityOutdated ? "font-medium text-[#92400e] dark:text-amber-300" : "text-muted-foreground"}`}>
                    Kiểm tra lúc {timeOf(qualityCheckResult.checkedAt)}{qualityOutdated ? ". Nội dung đã đổi sau đó: bấm Kiểm tra chất lượng để kiểm lại." : "."}
                  </p>
                ) : null}
              </div>
              <button type="button" onClick={onDismissQualityCheck} aria-label="Đóng kết quả kiểm tra" className="-m-1 cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 py-4">
            <div hidden={!visible("description")} data-field-row="description">
              {renderAiField({ field: "description", id: "description", label: "Mô tả", formField: "description", children: (
                <Textarea id="description" aria-describedby="description-state" value={form.description} onChange={(e) => onFieldChange("description", e.target.value)} rows={5} placeholder="Giới thiệu nội dung sách cho bạn đọc…"
                  className="min-h-28 max-h-72 resize-y overflow-y-auto border-none bg-transparent p-0 text-[14px] leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent" />
              ) })}
              <FieldProvenance field="description" label="Mô tả" lookup={lookup} value={form.description} aiWritten={Boolean(aiApplied.description)} onChoose={(value) => onFieldChange("description", value)} />
            </div>
            <div hidden={!visible("summaryVi")} data-field-row="summaryVi">
              {renderAiField({ field: "summaryVi", id: "summaryVi", label: "Tóm tắt tiếng Việt", formField: "summaryVi", children: (
                <Textarea id="summaryVi" aria-describedby="summaryVi-state" value={form.summaryVi} onChange={(e) => onFieldChange("summaryVi", e.target.value)} rows={2} placeholder="2–3 câu, chatbot dùng để giới thiệu sách…"
                  className="min-h-14 resize-y border-none bg-transparent p-0 text-[14px] leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent" />
              ) })}
            </div>
            <div hidden={!visible("categoriesText")} data-field-row="categoriesText">
              {renderAiField({ field: "categories", id: "categories", label: "Thể loại", formField: "categoriesText", children: (
                <Input id="categories" aria-describedby="categories-state" value={form.categoriesText} onChange={(e) => onFieldChange("categoriesText", e.target.value)} placeholder="Cách nhau bằng dấu phẩy"
                  className="h-8 pointer-coarse:min-h-[44px] border-none bg-transparent p-0 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent" />
              ) })}
              <FieldProvenance field="categoriesText" label="Thể loại" lookup={lookup} value={form.categoriesText} aiWritten={Boolean(aiApplied.categories)} onChoose={(value) => onFieldChange("categoriesText", value)} />
            </div>
            <div hidden={!visible("keywordsText")} data-field-row="keywordsText">
              {renderAiField({ field: "keywords", id: "keywords", label: "Từ khóa", formField: "keywordsText", children: (
                <Input id="keywords" aria-describedby="keywords-state" value={form.keywordsText} onChange={(e) => onFieldChange("keywordsText", e.target.value)} placeholder="Cách nhau bằng dấu phẩy"
                  className="h-8 pointer-coarse:min-h-[44px] border-none bg-transparent p-0 text-[14px] shadow-none focus-visible:ring-0 dark:bg-transparent" />
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
