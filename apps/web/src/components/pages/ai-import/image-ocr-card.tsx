import { useRef, useState, type DragEvent } from "react";
import { AlertTriangle, Camera, ImagePlus, Loader2, RefreshCw, ScanText, Trash2, X } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { StatusBadge } from "@/components/status-badge";
import { OCR_ACCEPTED_TYPES, OCR_SLOTS, type OcrAvailability } from "@/lib/book-ocr";
import type { OcrImageKind } from "@/services/book-ocr";
import type { OcrSlots } from "./use-book-ocr";

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function OcrSlotTile({
  kind, label, hint, slot, preparing, disabled, onSelect, onRemove,
}: {
  kind: OcrImageKind;
  label: string;
  hint: string;
  slot: OcrSlots[OcrImageKind];
  preparing: boolean;
  disabled: boolean;
  onSelect: (kind: OcrImageKind, file: File) => void;
  onRemove: (kind: OcrImageKind) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = `ocr-${kind}`;

  function pick(files: FileList | null) {
    const file = files?.[0];
    if (file) onSelect(kind, file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) pick(event.dataTransfer.files);
  }

  return (
    <div
      onDragOver={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      data-testid={`ocr-slot-${kind}`}
      className={`flex min-w-0 flex-col rounded-[12px] border bg-card transition-colors ${dragging ? "border-cyan-500 bg-cyan-50/60 dark:bg-cyan-500/10" : slot ? "border-border" : "border-dashed border-cyan-300/80 dark:border-cyan-500/30"}`}
    >
      <div className="flex items-start justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground">{label}</p>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
        {slot ? <StatusBadge label="Đã chọn" variant="success" /> : null}
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={OCR_ACCEPTED_TYPES.join(",")}
        className="sr-only"
        aria-label={`Chọn ảnh ${label.toLowerCase()}`}
        disabled={disabled}
        onChange={(event) => {
          pick(event.target.files);
          event.target.value = "";
        }}
      />

      {slot ? (
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="relative overflow-hidden rounded-[10px] bg-muted/50">
            <img src={slot.url} alt={`Xem trước ${label.toLowerCase()}`} className="mx-auto aspect-[3/4] max-h-56 w-full object-contain" />
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{formatBytes(slot.file.size)} · đã tối ưu để tải lên</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-border px-2 text-[12px] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={`Thay ảnh ${label.toLowerCase()}`}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Thay ảnh
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(kind)}
              className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-destructive/25 px-2 text-[12px] font-semibold text-destructive hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={`Xóa ảnh ${label.toLowerCase()}`}
            >
              <Trash2 className="h-3.5 w-3.5" /> Xóa
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={`m-3 flex min-h-36 flex-1 flex-col items-center justify-center gap-2 rounded-[10px] bg-muted/35 px-3 py-4 text-center ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-cyan-50/70 dark:hover:bg-cyan-500/10"}`}
        >
          {preparing ? <Loader2 className="h-6 w-6 animate-spin text-cyan-600" /> : <ImagePlus className="h-6 w-6 text-cyan-600 dark:text-cyan-400" />}
          <span className="text-[12px] font-semibold text-foreground">{preparing ? "Đang tối ưu ảnh…" : "Kéo thả hoặc chọn ảnh"}</span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Camera className="h-3 w-3" /> Trên điện thoại có thể chụp trực tiếp</span>
        </label>
      )}
    </div>
  );
}

/** OCR is not offered (yet): checking, turned off, or the AI service did not answer.
 *  Shown instead of the upload card so the rest of AI Import stays usable. */
export function OcrAvailabilityNotice({ availability, onRetry }: { availability: Exclude<OcrAvailability, "AVAILABLE">; onRetry: () => void }) {
  const text = {
    LOADING: "Đang kiểm tra dịch vụ AI OCR…",
    DISABLED: "Tính năng nhập sách bằng ảnh đang tắt trong cấu hình hệ thống. Bạn vẫn có thể tra cứu ISBN hoặc nhập tay.",
    UNAVAILABLE: "Dịch vụ AI OCR hiện không phản hồi. Bạn vẫn có thể tra cứu ISBN hoặc nhập tay, hoặc thử lại sau.",
  }[availability];
  return (
    <SectionCard
      icon={ScanText}
      title="Nhập sách bằng hình ảnh (AI OCR)"
      className="border-cyan-200/70 dark:border-cyan-500/20"
      headerClassName="border-b border-cyan-100/80 dark:border-cyan-500/15"
      actions={<StatusBadge label={availability === "LOADING" ? "Đang kiểm tra" : availability === "DISABLED" ? "Đang tắt" : "Không khả dụng"}
        variant={availability === "UNAVAILABLE" ? "warning" : "neutral"} dot />}
    >
      <div role="status" aria-live="polite" className="flex flex-col gap-3 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-start gap-2">
          {availability === "LOADING" ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-cyan-600" aria-hidden="true" />
            : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />}
          {text}
        </span>
        {availability === "UNAVAILABLE" ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30"
          >
            <RefreshCw className="h-4 w-4" /> Thử lại
          </button>
        ) : null}
      </div>
    </SectionCard>
  );
}

export function ImageOcrCard({
  slots, preparing, scanning, error, maxImages, onSelect, onRemove, onScan, onCancel, hasResult,
}: {
  slots: OcrSlots;
  preparing: OcrImageKind | null;
  scanning: boolean;
  error: string | null;
  maxImages: number;
  onSelect: (kind: OcrImageKind, file: File) => void;
  onRemove: (kind: OcrImageKind) => void;
  onScan: () => void;
  onCancel: () => void;
  hasResult: boolean;
}) {
  const count = Object.keys(slots).length;
  const statusLabel = scanning ? "Đang quét" : hasResult ? "Đã có kết quả" : count ? `${count} ảnh` : "Chưa có ảnh";
  const statusVariant = scanning ? "info" : hasResult ? "success" : "neutral";

  return (
    <SectionCard
      icon={ScanText}
      title="Nhập sách bằng hình ảnh (AI OCR)"
      subtitle={`Tải 1–${maxImages} ảnh của cùng một cuốn sách. AI chỉ đề xuất; bạn duyệt từng trường trước khi lưu.`}
      className="border-cyan-200/70 shadow-[0_4px_20px_rgba(8,145,178,0.06)] dark:border-cyan-500/20"
      headerClassName="border-b border-cyan-100/80 dark:border-cyan-500/15"
      actions={<StatusBadge label={statusLabel} variant={statusVariant} dot />}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {OCR_SLOTS.map(({ kind, label, hint }) => (
          <OcrSlotTile
            key={kind}
            kind={kind}
            label={label}
            hint={hint}
            slot={slots[kind]}
            preparing={preparing === kind}
            disabled={scanning || preparing !== null}
            onSelect={onSelect}
            onRemove={onRemove}
          />
        ))}
      </div>

      {error ? (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-[10px] border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-[13px] text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12px] text-muted-foreground" aria-live="polite">
          {scanning
            ? "AI đang đọc ảnh và đối chiếu ISBN… thường mất 5–30 giây. Bạn vẫn có thể thao tác trên trang."
            : "Ảnh rõ, đủ sáng, chụp thẳng giúp đọc đúng dấu tiếng Việt và ISBN."}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:flex">
          {scanning ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-border px-4 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30"
            >
              <X className="h-4 w-4" /> Hủy quét
            </button>
          ) : null}
          <button
            type="button"
            onClick={onScan}
            disabled={scanning || preparing !== null || count === 0}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-[10px] bg-cyan-600 px-4 text-[13px] font-semibold text-white transition-[background-color,transform,box-shadow] duration-150 hover:bg-cyan-700 hover:shadow-[0_4px_12px_rgba(8,145,178,0.25)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none disabled:active:scale-100 dark:bg-cyan-500 dark:hover:bg-cyan-600"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
            <span>{scanning ? "Đang quét…" : "Quét và trích xuất bằng AI"}</span>
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
