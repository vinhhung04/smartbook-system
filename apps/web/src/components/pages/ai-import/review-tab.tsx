import { CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { LookupBookByIsbnResponse } from "@/services/ai";
import type { DuplicateReview, ReconciliationDraft } from "@/services/metadata-intelligence";
import { AuthorityReviewPanel } from "./authority-review-panel";
import { CatalogDuplicateWarning, DuplicateReviewPanel } from "./duplicate-review-panel";
import { IsbnIntelligencePanel } from "./isbn-intelligence-panel";
import { ReviewDisclosure, ReviewQueueItem } from "./review-queue-item";
import type { DuplicateMatch } from "./types";

export function ReviewTab({
  lookupData,
  reconciliationDraft,
  duplicateReview,
  duplicateMatches,
  confirmDuplicateSave,
  onConfirmDuplicateSave,
  activeReviewId,
  onToggleReview,
  duplicateNeedsReview,
  authorityNeedsReview,
  evidenceNeedsReview,
  reviewIssueCount,
  sourceCount,
  onAuthorityDecision,
  onCreateAuthorityEntity,
  onDuplicateAction,
}: {
  lookupData: LookupBookByIsbnResponse;
  reconciliationDraft: ReconciliationDraft | null;
  duplicateReview: DuplicateReview | null;
  duplicateMatches: DuplicateMatch[];
  confirmDuplicateSave: boolean;
  onConfirmDuplicateSave: (confirmed: boolean) => void;
  activeReviewId: "duplicate" | "authority" | "evidence" | null;
  onToggleReview: (id: "duplicate" | "authority" | "evidence") => void;
  duplicateNeedsReview: boolean;
  authorityNeedsReview: boolean;
  evidenceNeedsReview: boolean;
  reviewIssueCount: number;
  sourceCount: number;
  onAuthorityDecision: (field: string, status: "ACCEPTED" | "REJECTED") => void;
  onCreateAuthorityEntity: (field: string) => void;
  onDuplicateAction: (action: string, candidate?: DuplicateReview["candidates"][number]) => void;
}) {
  return (
    <div>
      <div className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-700 dark:text-cyan-300">Kiểm duyệt catalog</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight text-foreground">{reviewIssueCount ? "Việc cần xử lý" : "Đã hoàn tất kiểm duyệt"}</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">Duyệt chuẩn hóa, trùng lặp và nguồn dữ liệu trước khi lưu.</p>
          </div>
          <StatusBadge label={reviewIssueCount ? `${reviewIssueCount} mục` : "An toàn"} variant={reviewIssueCount ? "warning" : "success"} />
        </div>
      </div>

      <div className="space-y-5">
        {(duplicateNeedsReview || authorityNeedsReview || evidenceNeedsReview) ? (
          <section className="divide-y divide-border rounded-xl border border-border/80 bg-card px-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] dark:shadow-none sm:px-5" aria-label="Hàng đợi kiểm duyệt">
            {duplicateNeedsReview && duplicateReview ? (
              <ReviewQueueItem
                id="duplicate-review"
                title="Kiểm tra trùng lặp và ấn bản"
                description="Chọn cách xử lý trước khi tiếp tục lưu sách."
                status={<StatusBadge label="Cần quyết định" variant="warning" />}
                open={activeReviewId === "duplicate"}
                onToggle={() => onToggleReview("duplicate")}
              >
                <DuplicateReviewPanel review={duplicateReview} onAction={onDuplicateAction} />
              </ReviewQueueItem>
            ) : null}
            {authorityNeedsReview && reconciliationDraft ? (
              <ReviewQueueItem
                id="authority-review"
                title="Chuẩn hóa authority"
                description="Duyệt tác giả, nhà xuất bản và thể loại theo catalog chuẩn."
                status={<StatusBadge label="Cần duyệt" variant="warning" />}
                open={activeReviewId === "authority"}
                onToggle={() => onToggleReview("authority")}
              >
                <AuthorityReviewPanel draft={reconciliationDraft} onDecision={onAuthorityDecision} onCreateEntity={onCreateAuthorityEntity} />
              </ReviewQueueItem>
            ) : null}
            {evidenceNeedsReview ? (
              <ReviewQueueItem
                id="evidence-review"
                title="Xung đột nguồn ISBN"
                description="So sánh giá trị được chọn với các nguồn xác nhận trước khi lưu."
                status={<StatusBadge label={`${lookupData.conflicts?.length || 0} xung đột`} variant="warning" />}
                open={activeReviewId === "evidence"}
                onToggle={() => onToggleReview("evidence")}
              >
                <IsbnIntelligencePanel lookup={lookupData} />
              </ReviewQueueItem>
            ) : null}
          </section>
        ) : null}

        {reviewIssueCount === 0 ? (
          <div className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/5 px-4 py-4 text-success" role="status">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-[14px] font-semibold">Không còn mục cần duyệt</p>
              <p className="mt-1 text-[13px] opacity-80">Authority, trùng lặp và dữ liệu nguồn đã sẵn sàng.</p>
            </div>
          </div>
        ) : null}

        {!evidenceNeedsReview ? (
          <ReviewDisclosure id="isbn-evidence" title="Nguồn và đối chiếu ISBN" description="Xem nguồn xác nhận và độ tin cậy từng trường khi cần." badge={<StatusBadge label={sourceCount ? `${sourceCount} nguồn` : "Thủ công"} variant="neutral" />}>
            <IsbnIntelligencePanel lookup={lookupData} />
          </ReviewDisclosure>
        ) : null}

        <CatalogDuplicateWarning matches={duplicateMatches} confirmed={confirmDuplicateSave} onConfirm={onConfirmDuplicateSave} />
      </div>
    </div>
  );
}
