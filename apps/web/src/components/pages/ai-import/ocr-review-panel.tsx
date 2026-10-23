import { useState } from "react";
import { AlertTriangle, CheckCheck, Eye, FileSearch, Info, X } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  describeOcrCode, formatUsd, OCR_FIELD_FOR_FORM, OCR_FIELD_LABELS, OCR_READING_LABELS, OCR_SLOTS, OCR_STATUS_META,
  ocrSourceLabel, safeProposalCount, singleSourceProposals,
} from "@/lib/book-ocr";
import type { BookOcrScanResult, OcrImageKind, OcrProposal } from "@/services/book-ocr";
import type { EditableBookForm } from "./types";
import type { OcrSlots } from "./use-book-ocr";

// "isbn13" mirrors "isbn" (same canonical value) and is applied together with it.
const ROW_ORDER = ["isbn", "isbn10", "title", "subtitle", "authorsText", "translatorText", "publisher", "publishedDate",
  "pageCount", "language", "categoriesText", "description"] as const;
const EXTRA_READINGS = ["distributor", "editionStatement", "printYear", "copyrightYear", "coverPrice"] as const;

const LOOKUP_STATUS_TEXT: Record<BookOcrScanResult["isbnLookup"]["status"], string> = {
  FOUND: "đã tìm thấy bản ghi — từng trường được đối chiếu bên dưới",
  NOT_FOUND: "không tìm thấy bản ghi; dữ liệu chỉ đến từ ảnh",
  SKIPPED_NO_VALID_ISBN: "chưa tra cứu vì ảnh không có ISBN hợp lệ",
  SKIPPED_ISBN_CONFLICT: "chưa tra cứu vì các ảnh ghi ISBN khác nhau",
  TIMEOUT: "quá thời gian; bạn có thể tra cứu ISBN thủ công ở ô phía trên",
  ERROR: "lỗi; bạn có thể tra cứu ISBN thủ công ở ô phía trên",
  DISABLED: "không khả dụng",
};

function fieldsForApply(formField: string): Array<keyof EditableBookForm> {
  return (formField === "isbn" ? ["isbn", "isbn13"] : [formField]) as Array<keyof EditableBookForm>;
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
  const meta = OCR_STATUS_META[proposal.status];
  const ocrField = OCR_FIELD_FOR_FORM[proposal.formField];
  const observations = ocrField ? result.fields[ocrField]?.observations || [] : [];
  const current = form[proposal.formField as keyof EditableBookForm] ?? "";
  const fields = fieldsForApply(proposal.formField);
  const showComparison = proposal.ocrValue && proposal.lookupValue && proposal.ocrValue !== proposal.lookupValue;
  const isConflict = proposal.status === "CONFLICTED";
  // Readings that differ only in Vietnamese marks: every spelling is a one-click choice, not just the proposed one.
  const choices = isConflict ? proposal.options
    : proposal.reasons.some((reason) => reason.endsWith("DIACRITICS_DIFFER"))
      ? proposal.options.filter((option) => option.value !== proposal.value) : [];

  return (
    <li className="rounded-[10px] border border-border/80 p-3" data-testid={`ocr-row-${proposal.formField}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-foreground">{label}</span>
        <StatusBadge label={meta.label} variant={meta.tone} />
        {proposal.source ? <span className="text-[11px] text-muted-foreground">Nguồn: {ocrSourceLabel(proposal.source)}</span> : null}
        {proposal.value && current === proposal.value ? <StatusBadge label="Đang dùng trong biểu mẫu" variant="success" /> : null}
      </div>

      {proposal.value ? (
        <p className={`mt-1.5 whitespace-pre-wrap break-words text-[13px] text-foreground ${proposal.formField === "description" ? "line-clamp-4" : ""}`}>{proposal.value}</p>
      ) : isConflict ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground">Các nguồn ghi khác nhau — không có giá trị nào được tự chọn. Hãy so với sách thật rồi chọn:</p>
      ) : null}

      {showComparison && !isConflict ? (
        <dl className="mt-1.5 grid gap-1 text-[12px] text-muted-foreground sm:grid-cols-2">
          <div><dt className="inline font-medium">Ảnh: </dt><dd className="inline break-words">{proposal.ocrValue}</dd></div>
          <div><dt className="inline font-medium">Tra cứu ISBN: </dt><dd className="inline break-words">{proposal.lookupValue}</dd></div>
        </dl>
      ) : null}

      {proposal.reasons.length ? (
        <ul className="mt-1.5 space-y-0.5 text-[11px] text-amber-700 dark:text-amber-400">
          {proposal.reasons.filter((reason) => !["LOOKUP_AGREES", "LOOKUP_RECORD_FOUND"].includes(reason)).map((reason) => (
            <li key={reason}>• {describeOcrCode(reason)}</li>
          ))}
        </ul>
      ) : null}

      {observations.length ? (
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer font-medium text-cyan-700 dark:text-cyan-300">Bằng chứng từ ảnh ({observations.length})</summary>
          <ul className="mt-2 space-y-2">
            {observations.map((observation, index) => (
              <li key={`${observation.source}-${index}`} className="rounded-[8px] bg-muted/50 p-2">
                <p className="font-medium">{ocrSourceLabel(observation.source)} {observation.valid ? "" : "· không dùng"}</p>
                <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-cyan-400/60 pl-2 text-muted-foreground">
                  {observation.observedText || "(đoạn giới thiệu được chép nguyên văn)"}
                </blockquote>
                {observation.issues.length ? (
                  <p className="mt-1 text-destructive">{observation.issues.map((issue) => describeOcrCode(issue)).join("; ")}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {edited && (proposal.value || isConflict) ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Bạn đã sửa trường này — chỉ thay đổi khi bạn bấm áp dụng.</p>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-2">
        {proposal.value && current !== proposal.value ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onApply(fields, proposal.value!, label)}
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[8px] border border-cyan-300 px-3 text-[12px] font-semibold text-cyan-700 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-500/30 dark:text-cyan-300 dark:hover:bg-cyan-500/10"
          >
            Áp dụng {label.toLowerCase()}
          </button>
        ) : null}
        {choices.map((option) => (
          <button
            key={`${option.source}-${option.value}`}
            type="button"
            disabled={disabled}
            onClick={() => onApply(fields, option.value, label)}
            className="inline-flex min-h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-[8px] border border-border px-3 text-left text-[12px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="truncate">Dùng “{option.value}”</span>
            <span className="shrink-0 text-muted-foreground">({ocrSourceLabel(option.source)})</span>
          </button>
        ))}
      </div>
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
  const needsDecision = shown.filter((proposal) => ["CONFLICTED", "REVIEW_REQUIRED", "INVALID"].includes(proposal.status)).length;
  const safeCount = safeProposalCount(Object.fromEntries(shown.map((proposal) => [proposal.formField, proposal])));
  const singleSource = singleSourceProposals(Object.fromEntries(shown.map((proposal) => [proposal.formField, proposal])), userEdited)
    .filter((proposal) => form[proposal.formField as keyof EditableBookForm] !== proposal.value);
  const extras = EXTRA_READINGS.map((field) => [field, result.metadata[field]] as const).filter(([, value]) => value);
  const { usage } = result;
  const viewingSlot = viewing ? slots[viewing] : undefined;

  return (
    <section aria-label="Kết quả AI OCR" className="space-y-4 rounded-2xl border border-cyan-200/70 bg-card p-4 sm:p-5 dark:border-cyan-500/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><FileSearch className="h-4 w-4 text-cyan-600" /> Kết quả đọc ảnh</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Model {usage.model || "—"} · {usage.imageCount} ảnh · {(usage.latencyMs / 1000).toFixed(1)} s ·{" "}
            {usage.promptTokens + usage.completionTokens} tokens · chi phí {formatUsd(usage.costUsd)}
            {usage.cacheHit ? " · dùng lại kết quả trước (không tốn phí)" : ""}
            {usage.fallbackUsed ? " · đã dùng model dự phòng" : ""}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Tra cứu ISBN{result.isbnLookup.isbn ? ` ${result.isbnLookup.isbn}` : ""}: {LOOKUP_STATUS_TEXT[result.isbnLookup.status]}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge label={needsDecision ? `${needsDecision} trường cần quyết định` : "Không có xung đột"} variant={needsDecision ? "warning" : "success"} />
          <button type="button" onClick={onDismiss} aria-label="Đóng kết quả OCR" className="rounded-[8px] p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {stale ? (
        <div role="status" className="flex items-start gap-2 rounded-[10px] border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Ảnh đã thay đổi sau lần quét này — kết quả bên dưới thuộc bộ ảnh trước và không thể áp dụng. Bấm “Quét và trích xuất bằng AI” để đọc bộ ảnh mới.</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {stale ? null : OCR_SLOTS.filter(({ kind }) => slots[kind] && result.images.some((image) => image.kind === kind)).map(({ kind, label }) => (
          <button key={kind} type="button" onClick={() => setViewing(kind)} className="group flex items-center gap-2 rounded-[10px] border border-border p-1.5 pr-3 text-[12px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30">
            <img src={slots[kind]!.url} alt="" className="h-12 w-9 rounded-[6px] object-cover" />
            <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" /> Xem lại {label.toLowerCase()}</span>
          </button>
        ))}
      </div>

      <div className="flex items-start gap-2 rounded-[10px] bg-muted/45 px-3 py-2 text-[12px] text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          “Đọc từ ảnh” nghĩa là AI chép được giá trị kèm đoạn chữ làm bằng chứng — đó là bản chép của AI, vẫn có thể sai dấu hoặc sai số.
          “Đã đối chiếu” nghĩa là hai nguồn độc lập (hai ảnh, ảnh + mã vạch, hoặc tra cứu ISBN) khớp nhau, kể cả dấu tiếng Việt.
          Trường bạn đã tự sửa không bao giờ bị ghi đè tự động.
        </span>
      </div>

      {result.warnings.length ? (
        <details className="text-[12px]">
          <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-400">{result.warnings.length} cảnh báo khi đọc ảnh</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {result.warnings.map((warning) => <li key={warning}>• {describeOcrCode(warning)}</li>)}
          </ul>
        </details>
      ) : null}

      <ul className="space-y-2">
        {shown.map((proposal) => (
          <ProposalRow key={proposal.formField} proposal={proposal} result={result} form={form}
            edited={fieldsForApply(proposal.formField).some((field) => userEdited.has(field))} disabled={stale} onApply={onApply} />
        ))}
      </ul>

      {missing.length ? <p className="text-[12px] text-muted-foreground">Không thấy trong ảnh: {missing.join(", ")}. Hãy nhập tay nếu cần.</p> : null}

      {extras.length || result.otherCodes.length ? (
        <div className="rounded-[10px] border border-dashed border-border p-3 text-[12px]">
          <p className="font-medium text-foreground">Thông tin khác đọc được (không tự điền vào biểu mẫu)</p>
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {extras.map(([field, value]) => <li key={field}>{OCR_READING_LABELS[field]}: {String(value)}</li>)}
            {result.otherCodes.map((code) => (
              <li key={`${code.source}-${code.value}`}>Mã khác ISBN ({ocrSourceLabel(code.source)}{code.label ? `, ${code.label}` : ""}): {code.value}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] text-muted-foreground">
          Trường an toàn = đã đối chiếu hai nguồn, hoặc trường ít rủi ro đọc từ một ảnh. Tên sách, tựa phụ, tác giả, NXB, năm, ISBN và mô tả
          chỉ đọc từ một ảnh cần bạn xác nhận. Trường bạn đã sửa được giữ nguyên.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
        {singleSource.length ? (
          <button
            type="button"
            onClick={onApplySingleSource}
            disabled={stale}
            className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-cyan-300 px-4 text-[13px] font-semibold text-cyan-700 hover:bg-cyan-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-cyan-500/30 dark:text-cyan-300 dark:hover:bg-cyan-500/10"
          >
            Đã so với sách — áp dụng {singleSource.length} giá trị đọc từ một ảnh
          </button>
        ) : null}
        <button
          type="button"
          onClick={onApplySafe}
          disabled={!safeCount || stale}
          className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-cyan-600 px-4 text-[13px] font-semibold text-white hover:bg-cyan-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-cyan-500 dark:hover:bg-cyan-600"
        >
          <CheckCheck className="h-4 w-4" /> Áp dụng các trường an toàn ({safeCount})
        </button>
        </div>
      </div>

      <Dialog open={viewing !== null} onOpenChange={(open) => { if (!open) setViewing(null); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle>{OCR_SLOTS.find((slot) => slot.kind === viewing)?.label}</DialogTitle>
          <DialogDescription>Ảnh đã gửi cho AI — so sánh với các giá trị đề xuất.</DialogDescription>
          {viewingSlot ? <img src={viewingSlot.url} alt={`Ảnh ${OCR_SLOTS.find((slot) => slot.kind === viewing)?.label.toLowerCase()}`} className="max-h-[70vh] w-full rounded-[8px] object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
