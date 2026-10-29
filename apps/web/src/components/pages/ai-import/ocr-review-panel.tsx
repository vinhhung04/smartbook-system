import { useState, type ComponentType } from "react";
import {
  AlertTriangle, CheckCheck, CircleDashed, Eye, FileSearch, GitCompareArrows, Globe, Info, PencilLine, ScanText, Sparkles, X, XCircle,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  describeOcrCode, formatUsd, OCR_FIELD_FOR_FORM, OCR_FIELD_LABELS, OCR_READING_LABELS, OCR_SLOTS, OCR_STATUS_META,
  ocrSourceLabel, safeProposalCount, singleSourceProposals,
} from "@/lib/book-ocr";
import type { BookOcrScanResult, OcrFieldStatus, OcrImageKind, OcrProposal } from "@/services/book-ocr";
import type { EditableBookForm } from "./types";
import type { OcrSlots } from "./use-book-ocr";

// "isbn13" mirrors "isbn" (same canonical value) and is applied together with it.
const ROW_ORDER = ["isbn", "isbn10", "title", "subtitle", "authorsText", "translatorText", "publisher", "publishedDate",
  "pageCount", "language", "categoriesText", "description"] as const;
const EXTRA_READINGS = ["distributor", "editionStatement", "printYear", "copyrightYear", "coverPrice"] as const;
const DECISION_STATUSES: OcrFieldStatus[] = ["CONFLICTED", "REVIEW_REQUIRED", "INVALID"];

const LOOKUP_STATUS_TEXT: Record<BookOcrScanResult["isbnLookup"]["status"], string> = {
  FOUND: "đã tìm thấy bản ghi — từng trường được đối chiếu bên dưới",
  NOT_FOUND: "không tìm thấy bản ghi; dữ liệu chỉ đến từ ảnh",
  SKIPPED_NO_VALID_ISBN: "chưa tra cứu vì ảnh không có ISBN hợp lệ",
  SKIPPED_ISBN_CONFLICT: "chưa tra cứu vì các ảnh ghi ISBN khác nhau",
  TIMEOUT: "quá thời gian; bạn có thể tra cứu ISBN thủ công ở ô phía trên",
  ERROR: "lỗi; bạn có thể tra cứu ISBN thủ công ở ô phía trên",
  DISABLED: "không khả dụng",
};

// Icon per backend status so the state reads without color; labels/tones come from OCR_STATUS_META.
const STATUS_ICON: Record<OcrFieldStatus, ComponentType<{ className?: string }>> = {
  CORROBORATED: CheckCheck,
  EXTRACTED: ScanText,
  LOOKUP_ONLY: Globe,
  REVIEW_REQUIRED: Eye,
  CONFLICTED: GitCompareArrows,
  INVALID: XCircle,
  INFERRED: Sparkles,
  MISSING: CircleDashed,
};

const TONE_CHIP: Record<string, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  neutral: "border-border bg-muted/60 text-muted-foreground",
};

function StatusChip({ status }: { status: OcrFieldStatus }) {
  const meta = OCR_STATUS_META[status];
  const Icon = STATUS_ICON[status];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium ${TONE_CHIP[meta.tone] ?? TONE_CHIP.neutral}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function fieldsForApply(formField: string): Array<keyof EditableBookForm> {
  return (formField === "isbn" ? ["isbn", "isbn13"] : [formField]) as Array<keyof EditableBookForm>;
}

function ValueBlock({ label, value, emphasis = false, clamp = false }: { label: string; value: string; emphasis?: boolean; clamp?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg px-3 py-2 ${emphasis ? "bg-violet-50/70 dark:bg-violet-500/[0.07]" : "bg-muted/40"}`}>
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={`mt-0.5 whitespace-pre-wrap break-words text-[13px] ${value ? "text-foreground" : "italic text-muted-foreground"} ${clamp ? "line-clamp-4" : ""}`}>
        {value || "(trống)"}
      </p>
    </div>
  );
}

function ProposalRow({
  proposal, result, form, edited, disabled, onApply,
}: {
  proposal: OcrProposal;
  result: BookOcrScanResult;
  form: EditableBookForm;
  edited: boolean;
  disabled: boolean;
  onApply: (fields: Array<keyof EditableBookForm>, value: string, label: string) => void;
}) {
  const label = OCR_FIELD_LABELS[proposal.formField] || proposal.formField;
  const ocrField = OCR_FIELD_FOR_FORM[proposal.formField];
  const observations = ocrField ? result.fields[ocrField]?.observations || [] : [];
  const current = String(form[proposal.formField as keyof EditableBookForm] ?? "");
  const fields = fieldsForApply(proposal.formField);
  const showComparison = proposal.ocrValue && proposal.lookupValue && proposal.ocrValue !== proposal.lookupValue;
  const isConflict = proposal.status === "CONFLICTED";
  const inUse = Boolean(proposal.value) && current === proposal.value;
  const needsDecision = DECISION_STATUSES.includes(proposal.status);
  // Readings that differ only in Vietnamese marks: every spelling is a one-click choice, not just the proposed one.
  const choices = isConflict ? proposal.options
    : proposal.reasons.some((reason) => reason.endsWith("DIACRITICS_DIFFER"))
      ? proposal.options.filter((option) => option.value !== proposal.value) : [];
  const reasons = proposal.reasons.filter((reason) => !["LOOKUP_AGREES", "LOOKUP_RECORD_FOUND"].includes(reason));
  const long = proposal.formField === "description";

  return (
    <li
      className={`rounded-xl border p-3.5 ${needsDecision ? "border-amber-200 bg-amber-50/30 dark:border-amber-500/25 dark:bg-amber-500/[0.04]" : "border-border bg-card"}`}
      data-testid={`ocr-row-${proposal.formField}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13.5px] font-semibold text-foreground">{label}</span>
        <StatusChip status={proposal.status} />
        {proposal.source ? <span className="text-[11.5px] text-muted-foreground">Nguồn: {ocrSourceLabel(proposal.source)}</span> : null}
        {inUse ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCheck className="h-3 w-3" aria-hidden="true" /> Đang dùng trong biểu mẫu
          </span>
        ) : null}
      </div>

      {isConflict ? (
        <p className="mt-2 text-[12.5px] text-foreground/85">Các nguồn ghi khác nhau — không có giá trị nào được tự chọn. Hãy so với sách thật rồi chọn:</p>
      ) : proposal.value && !inUse ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <ValueBlock label="AI đề xuất" value={proposal.value} emphasis clamp={long} />
          <ValueBlock label={edited ? "Trong biểu mẫu (bạn đã sửa)" : "Trong biểu mẫu"} value={current} clamp={long} />
        </div>
      ) : proposal.value ? (
        <p className={`mt-1.5 whitespace-pre-wrap break-words text-[13px] text-foreground ${long ? "line-clamp-4" : ""}`}>{proposal.value}</p>
      ) : null}

      {showComparison && !isConflict ? (
        <dl className="mt-2 grid gap-1 text-[12px] text-muted-foreground sm:grid-cols-2">
          <div><dt className="inline font-medium">Ảnh: </dt><dd className="inline break-words">{proposal.ocrValue}</dd></div>
          <div><dt className="inline font-medium">Tra cứu ISBN: </dt><dd className="inline break-words">{proposal.lookupValue}</dd></div>
        </dl>
      ) : null}

      {reasons.length ? (
        <ul className="mt-2 space-y-0.5 text-[12px] text-amber-800 dark:text-amber-300">
          {reasons.map((reason) => (
            <li key={reason} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />{describeOcrCode(reason)}</li>
          ))}
        </ul>
      ) : null}

      {choices.length ? (
        <div role="group" aria-label={`Các giá trị đọc được cho ${label.toLowerCase()}`} className="mt-2.5 grid gap-2 sm:grid-cols-2">
          {choices.map((option) => {
            const chosen = current === option.value;
            return (
              <button
                key={`${option.source}-${option.value}`}
                type="button"
                disabled={disabled}
                onClick={() => onApply(fields, option.value, label)}
                aria-pressed={chosen}
                className={`flex min-h-11 w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55 ${
                  chosen ? "border-primary/50 bg-primary/5" : "border-border bg-card hover:bg-muted"
                }`}
              >
                <span className="max-w-full break-words text-[13px] font-medium text-foreground">Dùng “{option.value}”</span>
                <span className="text-[11.5px] text-muted-foreground">({ocrSourceLabel(option.source)}){chosen ? " · đang dùng" : ""}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {observations.length ? (
        <details className="group mt-2.5 text-[12px]">
          <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-md font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">Bằng chứng từ ảnh ({observations.length})</summary>
          <ul className="mt-2 space-y-2">
            {observations.map((observation, index) => (
              <li key={`${observation.source}-${index}`} className="rounded-lg bg-muted/50 p-2.5">
                <p className="font-medium text-foreground">{ocrSourceLabel(observation.source)} {observation.valid ? "" : "· không dùng"}</p>
                <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-primary/40 pl-2 text-muted-foreground">
                  {observation.observedText || "(đoạn giới thiệu được chép nguyên văn)"}
                </blockquote>
                {observation.issues.length ? (
                  <p className="mt-1 text-red-700 dark:text-red-400">{observation.issues.map((issue) => describeOcrCode(issue)).join("; ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {edited && (proposal.value || isConflict) ? (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
          <PencilLine className="h-3 w-3" aria-hidden="true" /> Bạn đã sửa trường này — chỉ thay đổi khi bạn bấm áp dụng.
        </p>
      ) : null}

      {proposal.value && !inUse ? (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onApply(fields, proposal.value!, label)}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-violet-300 bg-card px-3 text-[12.5px] font-semibold text-violet-700 transition-colors hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55 dark:border-violet-500/40 dark:text-violet-300 dark:hover:bg-violet-500/10"
          >
            Áp dụng {label.toLowerCase()}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function OcrReviewPanel({
  result, stale, slots, form, userEdited, onApply, onApplySafe, onApplySingleSource, onDismiss,
}: {
  result: BookOcrScanResult;
  /** The photos changed after this scan: the result is shown for reference only, never applied. */
  stale: boolean;
  slots: OcrSlots;
  form: EditableBookForm;
  userEdited: ReadonlySet<string>;
  onApply: (fields: Array<keyof EditableBookForm>, value: string, label: string) => void;
  onApplySafe: () => void;
  /** Accept every single-photo reading at once (staff compared them with the book). */
  onApplySingleSource: () => void;
  onDismiss: () => void;
}) {
  const [viewing, setViewing] = useState<OcrImageKind | null>(null);
  const rows = ROW_ORDER.map((field) => result.proposals[field]).filter(Boolean);
  const shown = rows.filter((proposal) => proposal.status !== "MISSING" || proposal.options.length);
  const missing = rows.filter((proposal) => !shown.includes(proposal)).map((proposal) => OCR_FIELD_LABELS[proposal.formField]);
  const needsDecision = shown.filter((proposal) => DECISION_STATUSES.includes(proposal.status));
  const settled = shown.filter((proposal) => !needsDecision.includes(proposal));
  const safeCount = safeProposalCount(Object.fromEntries(shown.map((proposal) => [proposal.formField, proposal])));
  const singleSource = singleSourceProposals(Object.fromEntries(shown.map((proposal) => [proposal.formField, proposal])), userEdited)
    .filter((proposal) => form[proposal.formField as keyof EditableBookForm] !== proposal.value);
  const extras = EXTRA_READINGS.map((field) => [field, result.metadata[field]] as const).filter(([, value]) => value);
  const { usage } = result;
  const viewingSlot = viewing ? slots[viewing] : undefined;
  const corroborated = shown.filter((proposal) => proposal.status === "CORROBORATED").length;

  const renderRow = (proposal: OcrProposal) => (
    <ProposalRow key={proposal.formField} proposal={proposal} result={result} form={form}
      edited={fieldsForApply(proposal.formField).some((field) => userEdited.has(field))} disabled={stale} onApply={onApply} />
  );

  return (
    <section aria-label="Kết quả AI OCR" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[14.5px] font-semibold text-foreground"><FileSearch className="h-4 w-4 text-primary" aria-hidden="true" /> Kết quả đọc ảnh</h3>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Tra cứu ISBN{result.isbnLookup.isbn ? ` ${result.isbnLookup.isbn}` : ""}: {LOOKUP_STATUS_TEXT[result.isbnLookup.status]}
          </p>
        </div>
        <button type="button" onClick={onDismiss} aria-label="Đóng kết quả OCR" className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border text-center">
        <div className="bg-card px-2 py-2.5">
          <dt className="text-[11.5px] text-muted-foreground">Cần quyết định</dt>
          <dd className={`text-[18px] font-semibold tabular-nums ${needsDecision.length ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>{needsDecision.length}</dd>
        </div>
        <div className="bg-card px-2 py-2.5">
          <dt className="text-[11.5px] text-muted-foreground">Đã đối chiếu</dt>
          <dd className="text-[18px] font-semibold tabular-nums text-foreground">{corroborated}</dd>
        </div>
        <div className="bg-card px-2 py-2.5">
          <dt className="text-[11.5px] text-muted-foreground">Không thấy</dt>
          <dd className="text-[18px] font-semibold tabular-nums text-foreground">{missing.length}</dd>
        </div>
      </dl>

      {stale ? (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-300/70 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Ảnh đã thay đổi sau lần quét này — kết quả bên dưới thuộc bộ ảnh trước và không thể áp dụng. Bấm “Quét và trích xuất bằng AI” để đọc bộ ảnh mới.</span>
        </div>
      ) : null}

      {stale ? null : (
        <div className="flex flex-wrap gap-2">
          {OCR_SLOTS.filter(({ kind }) => slots[kind] && result.images.some((image) => image.kind === kind)).map(({ kind, label }) => (
            <button key={kind} type="button" onClick={() => setViewing(kind)} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border p-1.5 pr-3 text-[12px] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
              <img src={slots[kind]!.url} alt="" className="h-10 w-8 rounded object-cover" />
              <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" aria-hidden="true" /> Xem lại {label.toLowerCase()}</span>
            </button>
          ))}
        </div>
      )}

      <details className="rounded-xl bg-muted/40 px-3.5 py-2.5 text-[12px] text-muted-foreground">
        <summary className="flex min-h-7 cursor-pointer items-center gap-1.5 font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          <Info className="h-3.5 w-3.5" aria-hidden="true" /> Các trạng thái nghĩa là gì?
        </summary>
        <p className="mt-2 leading-relaxed">
          “Đọc từ ảnh” nghĩa là AI chép được giá trị kèm đoạn chữ làm bằng chứng — đó là bản chép của AI, vẫn có thể sai dấu hoặc sai số.
          “Đã đối chiếu” nghĩa là hai nguồn độc lập (hai ảnh, ảnh + mã vạch, hoặc tra cứu ISBN) khớp nhau, kể cả dấu tiếng Việt.
          Trường bạn đã tự sửa không bao giờ bị ghi đè tự động.
        </p>
        <p className="mt-2">
          Lần quét: model {usage.model || "—"} · {usage.imageCount} ảnh · {(usage.latencyMs / 1000).toFixed(1)} s ·{" "}
          {usage.promptTokens + usage.completionTokens} tokens · chi phí {formatUsd(usage.costUsd)}
          {usage.cacheHit ? " · dùng lại kết quả trước (không tốn phí)" : ""}
          {usage.fallbackUsed ? " · đã dùng model dự phòng" : ""}
        </p>
      </details>

      {result.warnings.length ? (
        <details className="text-[12px]">
          <summary className="inline-flex min-h-8 cursor-pointer items-center font-medium text-amber-800 focus-visible:outline-2 focus-visible:outline-ring dark:text-amber-300">{result.warnings.length} cảnh báo khi đọc ảnh</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {result.warnings.map((warning) => <li key={warning}>• {describeOcrCode(warning)}</li>)}
          </ul>
        </details>
      ) : null}

      {needsDecision.length ? (
        <div className="space-y-2">
          <h4 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-amber-800 dark:text-amber-300">Cần bạn quyết định</h4>
          <ul className="space-y-2">{needsDecision.map(renderRow)}</ul>
        </div>
      ) : null}
      {settled.length ? (
        <div className="space-y-2">
          <h4 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Các trường còn lại</h4>
          <ul className="space-y-2">{settled.map(renderRow)}</ul>
        </div>
      ) : null}

      {missing.length ? <p className="text-[12px] text-muted-foreground">Không thấy trong ảnh: {missing.join(", ")}. Hãy nhập tay nếu cần.</p> : null}

      {extras.length || result.otherCodes.length ? (
        <div className="rounded-xl border border-dashed border-border p-3 text-[12px]">
          <p className="font-medium text-foreground">Thông tin khác đọc được (không tự điền vào biểu mẫu)</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {extras.map(([field, value]) => <li key={field}>{OCR_READING_LABELS[field]}: {String(value)}</li>)}
            {result.otherCodes.map((code) => (
              <li key={`${code.source}-${code.value}`}>Mã khác ISBN ({ocrSourceLabel(code.source)}{code.label ? `, ${code.label}` : ""}): {code.value}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Trường an toàn = đã đối chiếu hai nguồn, hoặc trường ít rủi ro đọc từ một ảnh. Tên sách, tựa phụ, tác giả, NXB, năm, ISBN và mô tả
          chỉ đọc từ một ảnh cần bạn xác nhận. Trường bạn đã sửa được giữ nguyên.
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onApplySafe}
            disabled={!safeCount || stale}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" /> Áp dụng các trường an toàn ({safeCount})
          </button>
          {singleSource.length ? (
            <button
              type="button"
              onClick={onApplySingleSource}
              disabled={stale}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-center text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
            >
              Đã so với sách — áp dụng {singleSource.length} giá trị đọc từ một ảnh
            </button>
          ) : null}
        </div>
      </div>

      <Dialog open={viewing !== null} onOpenChange={(open) => { if (!open) setViewing(null); }}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-3xl">
          <DialogTitle>{OCR_SLOTS.find((slot) => slot.kind === viewing)?.label}</DialogTitle>
          <DialogDescription>Ảnh đã gửi cho AI — so sánh với các giá trị đề xuất.</DialogDescription>
          {viewingSlot ? <img src={viewingSlot.url} alt={`Ảnh ${OCR_SLOTS.find((slot) => slot.kind === viewing)?.label.toLowerCase()}`} className="max-h-[70vh] w-full rounded-lg object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
