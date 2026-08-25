import { AlertTriangle, BookCheck, CheckCircle2, Loader2 } from "lucide-react";

export function StickyFooter({
  completeSignalCount,
  reviewIssueCount,
  catalogDuplicateNeedsReview,
  onGoToReview,
  onReset,
  onSave,
  saving,
  saveDisabled,
}: {
  completeSignalCount: number;
  reviewIssueCount: number;
  catalogDuplicateNeedsReview: boolean;
  onGoToReview: () => void;
  onReset: () => void;
  onSave: () => void;
  saving: boolean;
  saveDisabled: boolean;
}) {
  const allReady = completeSignalCount === 4 && reviewIssueCount === 0;

  return (
    <div className="sticky bottom-4 z-10 mt-6 flex flex-col gap-3 rounded-lg border border-border/80 bg-card/95 p-3 shadow-[0_8px_18px_rgba(15,23,42,0.1)] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:flex-row sm:items-center sm:justify-between dark:shadow-black/20">
      <div className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground" aria-live="polite">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${allReady ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
          {allReady ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
        </div>
        {reviewIssueCount > 0 ? (
          <button type="button" onClick={onGoToReview} className="cursor-pointer text-left font-medium text-warning underline decoration-warning/40 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/30">
            {catalogDuplicateNeedsReview ? "Cần xác nhận trùng catalog trước khi lưu" : `Còn ${reviewIssueCount} mục kiểm duyệt cần xử lý`}
          </button>
        ) : (
          <span>{completeSignalCount === 4 ? "Metadata đã sẵn sàng để lưu" : `Còn thiếu ${4 - completeSignalCount} trường cốt lõi trước khi lưu`}</span>
        )}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onReset}
          disabled={saving}
          className="cursor-pointer rounded-md border border-border bg-card px-4 py-2.5 text-[13px] font-semibold text-foreground transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
        >
          Đặt lại
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || saveDisabled}
          className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-success px-4 py-2.5 text-[13px] font-semibold text-success-foreground transition-[background-color,transform,box-shadow] duration-150 hover:opacity-90 hover:shadow-[0_5px_12px_rgba(5,150,105,0.2)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:shadow-none disabled:active:scale-100"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookCheck className="h-4 w-4" />}
          {saving ? "Đang lưu" : "Lưu sách"}
        </button>
      </div>
    </div>
  );
}
