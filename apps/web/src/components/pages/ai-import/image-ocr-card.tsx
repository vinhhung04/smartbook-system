import { useRef, useState, type DragEvent } from "react";
import {
  AlertTriangle, Ban, CheckCircle2, CircleDashed, History, ImagePlus, Loader2, Maximize2, RefreshCw, ScanText, Smartphone, Trash2, X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { OCR_ACCEPTED_TYPES, OCR_SLOTS, type OcrAvailability } from "@/lib/book-ocr";
import type { OcrImageKind } from "@/services/book-ocr";
import { StateLabel } from "./studio-ui";
import type { OcrSlots } from "./use-book-ocr";

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** What to photograph for each slot - the reason the AI needs that page. */
const SLOT_GUIDE: Record<OcrImageKind, string> = {
  front_cover: "Chụp thẳng cả bìa, đủ tên sách và tác giả.",
  back_cover: "Chụp rõ mã vạch — ISBN được đọc cả từ mã vạch.",
  copyright_page: "Trang có NXB, năm, lần in, số trang (thường ở cuối hoặc đầu sách).",
};

function OcrSlotTile({
  index, kind, label, hint, slot, preparing, disabled, onSelect, onRemove, onZoom,
}: {
  index: number;
  kind: OcrImageKind;
  label: string;
  hint: string;
  slot: OcrSlots[OcrImageKind];
  preparing: boolean;
  disabled: boolean;
  onSelect: (kind: OcrImageKind, file: File) => void;
  onRemove: (kind: OcrImageKind) => void;
  onZoom: (kind: OcrImageKind) => void;
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
      className={`flex min-w-0 flex-col rounded-xl border bg-card transition-[border-color,background-color,box-shadow] duration-150 focus-within:ring-2 focus-within:ring-ring/30 ${
        dragging ? "border-primary bg-primary/5" : slot ? "border-border" : "border-dashed border-border"
      }`}
    >
      <div className="flex items-start gap-2.5 px-3.5 pt-3">
        <span className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${slot ? "bg-emerald-500 text-white" : "border border-border text-muted-foreground"}`} aria-hidden="true">
          {slot ? <CheckCircle2 className="h-3 w-3" /> : index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-foreground">{label}</p>
          <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p>
        </div>
        {slot ? <span className="shrink-0 text-[11.5px] font-medium text-emerald-700 dark:text-emerald-400">Đã chọn</span> : null}
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
        <div className="flex flex-1 flex-col gap-2 p-3.5 pt-3">
          <button
            type="button"
            onClick={() => onZoom(kind)}
            className="group relative cursor-zoom-in overflow-hidden rounded-lg border border-border/60 bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={`Phóng to ảnh ${label.toLowerCase()}`}
          >
            <img data-ocr-preview src={slot.url} alt={`Xem trước ${label.toLowerCase()}`} className="mx-auto aspect-[3/4] max-h-60 w-full object-contain" />
            <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-card/90 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true">
              <Maximize2 className="h-3.5 w-3.5" />
            </span>
          </button>
          <p className="truncate text-[11.5px] text-muted-foreground">{formatBytes(slot.file.size)} · đã thu nhỏ trên máy trước khi gửi</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => inputRef.current?.click()}
              className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-[12.5px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
              aria-label={`Thay ảnh ${label.toLowerCase()}`}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Thay ảnh
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRemove(kind)}
              className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border px-2 text-[12.5px] font-medium text-red-700 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-500/10"
              aria-label={`Xóa ảnh ${label.toLowerCase()}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Xóa
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={`m-3.5 mt-3 flex min-h-40 flex-1 flex-col items-center justify-center gap-2 rounded-lg bg-muted/40 px-3 py-5 text-center transition-colors ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-primary/5"}`}
        >
          {preparing ? <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" /> : <ImagePlus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />}
          <span className="text-[12.5px] font-semibold text-foreground">{preparing ? "Đang chuẩn bị ảnh…" : "Kéo thả hoặc bấm để chọn ảnh"}</span>
          <span className="max-w-[26ch] text-[11.5px] leading-snug text-muted-foreground">{SLOT_GUIDE[kind]}</span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Smartphone className="h-3 w-3" aria-hidden="true" /> Điện thoại có thể chụp trực tiếp</span>
        </label>
      )}
    </div>
  );
}

const OCR_TITLE = "Nhập sách bằng hình ảnh (AI OCR)";

/** OCR is not offered (yet): checking, turned off, or the AI service did not answer.
 *  Shown instead of the upload tiles so the rest of AI Import stays usable. */
export function OcrAvailabilityNotice({ availability, onRetry }: { availability: Exclude<OcrAvailability, "AVAILABLE">; onRetry: () => void }) {
  const text = {
    LOADING: "Đang kiểm tra dịch vụ AI OCR…",
    DISABLED: "Tính năng nhập sách bằng ảnh đang tắt trong cấu hình hệ thống. Bạn vẫn có thể tra cứu ISBN hoặc nhập tay.",
    UNAVAILABLE: "Dịch vụ AI OCR hiện không phản hồi. Bạn vẫn có thể tra cứu ISBN hoặc nhập tay, hoặc thử lại sau.",
  }[availability];
  return (
    <div className="space-y-2.5">
      <h3 className="text-[14px] font-semibold text-foreground">{OCR_TITLE}</h3>
      <div role="status" aria-live="polite" className="flex flex-col gap-3 rounded-xl border border-dashed border-border px-4 py-4 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-start gap-2.5">
          {availability === "LOADING" ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
            : availability === "DISABLED" ? <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />}
          {text}
        </span>
        {availability === "UNAVAILABLE" ? (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Thử lại
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ImageOcrCard({
  slots, preparing, scanning, error, maxImages, maxFileBytes, onSelect, onRemove, onScan, onCancel, hasResult, stale, cancelled,
}: {
  slots: OcrSlots;
  preparing: OcrImageKind | null;
  scanning: boolean;
  error: string | null;
  maxImages: number;
  maxFileBytes?: number;
  onSelect: (kind: OcrImageKind, file: File) => void;
  onRemove: (kind: OcrImageKind) => void;
  onScan: () => void;
  onCancel: () => void;
  hasResult: boolean;
  /** The current result belongs to an earlier photo set. */
  stale: boolean;
  /** The last scan was cancelled by the user. */
  cancelled: boolean;
}) {
  const [zoom, setZoom] = useState<OcrImageKind | null>(null);
  const count = Object.keys(slots).length;
  const zoomSlot = zoom ? slots[zoom] : undefined;
  const zoomLabel = OCR_SLOTS.find((slot) => slot.kind === zoom)?.label ?? "";

  const status = scanning
    ? <StateLabel icon={Loader2} tone="busy" spin>AI đang đọc {count} ảnh và đối chiếu ISBN — thường 5–30 giây; bạn vẫn có thể thao tác trên trang.</StateLabel>
    : preparing ? <StateLabel icon={Loader2} tone="busy" spin>Đang chuẩn bị ảnh (thu nhỏ, kiểm tra kích thước)…</StateLabel>
    : error ? null
    : hasResult && stale ? <StateLabel icon={History} tone="warn">Ảnh đã đổi sau lần quét trước — quét lại để có kết quả mới.</StateLabel>
    : hasResult ? <StateLabel icon={CheckCircle2} tone="ok">Đã có kết quả cho bộ ảnh này — xem ở phần Kiểm duyệt.</StateLabel>
    : cancelled ? <StateLabel icon={X} tone="neutral">Đã hủy lần quét trước. Ảnh vẫn được giữ.</StateLabel>
    : count ? <StateLabel icon={ScanText} tone="neutral">Sẵn sàng quét {count} ảnh.</StateLabel>
    : <StateLabel icon={CircleDashed} tone="neutral">Chưa chọn ảnh. Một ảnh là đủ để bắt đầu; nhiều ảnh giúp đối chiếu chéo.</StateLabel>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-foreground">{OCR_TITLE}</h3>
        <span className="text-[12px] text-muted-foreground">
          1–{maxImages} ảnh · JPG, PNG, WebP{maxFileBytes ? ` · tối đa ${formatBytes(maxFileBytes)}/ảnh sau khi thu nhỏ` : ""}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {OCR_SLOTS.map(({ kind, label, hint }, index) => (
          <OcrSlotTile
            key={kind}
            index={index + 1}
            kind={kind}
            label={label}
            hint={hint}
            slot={slots[kind]}
            preparing={preparing === kind}
            disabled={scanning || preparing !== null}
            onSelect={onSelect}
            onRemove={onRemove}
            onZoom={setZoom}
          />
        ))}
      </div>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-[12px]" aria-live="polite">{status}</p>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:shrink-0">
          {scanning ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-[13px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" /> Hủy quét
            </button>
          ) : null}
          <button
            type="button"
            onClick={onScan}
            disabled={scanning || preparing !== null || count === 0}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[13.5px] font-semibold text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-55"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ScanText className="h-4 w-4" aria-hidden="true" />}
            <span>{scanning ? "Đang quét…" : "Quét và trích xuất bằng AI"}</span>
          </button>
        </div>
      </div>

      <Dialog open={zoom !== null} onOpenChange={(open) => { if (!open) setZoom(null); }}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-3xl">
          <DialogTitle>{zoomLabel}</DialogTitle>
          <DialogDescription>Ảnh đã chọn, sau khi thu nhỏ trên máy — đây là ảnh sẽ gửi cho AI.</DialogDescription>
          {zoomSlot ? <img src={zoomSlot.url} alt={`Ảnh ${zoomLabel.toLowerCase()} phóng to`} className="max-h-[70vh] w-full rounded-lg object-contain" /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
