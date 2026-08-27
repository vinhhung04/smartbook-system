import { useState } from "react";
import { BadgeCheck, BookCopy, GitCompareArrows, Wand2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { LookupBookByIsbnResponse } from "@/services/ai";
import type { DuplicateReview, ReconciliationDraft } from "@/services/metadata-intelligence";
import { AuthorityReviewPanel } from "./authority-review-panel";
import { CatalogDuplicateWarning, DuplicateReviewPanel } from "./duplicate-review-panel";
import { IsbnIntelligencePanel } from "./isbn-intelligence-panel";
import { VerificationCategoryCard } from "./verification-category-card";
import { hasIsbnEvidence } from "./utils";
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
  // The evidence card can stay expandable even when there's nothing to act on (just
  // informational sourcing) — that state isn't part of the single-open accordion the
  // other two cards share, so it gets its own small local toggle.
  const [evidenceClearOpen, setEvidenceClearOpen] = useState(false);
  const evidenceHasContent = hasIsbnEvidence(lookupData);
  // A catalog-level duplicate match (client-side title/ISBN scan) also has to block the
  // card from collapsing into "clear", even if the AI/backend duplicate check itself
  // came back NEW_TITLE — otherwise a real save-blocking warning could hide.
  const duplicatePending = duplicateNeedsReview || (duplicateMatches.length > 0 && !confirmDuplicateSave);

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
        <div className="space-y-3">
          <VerificationCategoryCard
            tone="indigo"
            icon={BookCopy}
            title="Trùng lặp & ấn bản"
            description="Chọn cách xử lý trước khi tiếp tục lưu sách."
            pending={duplicatePending}
            expandable={duplicatePending}
            open={activeReviewId === "duplicate"}
            onToggle={() => onToggleReview("duplicate")}
            badge={duplicatePending ? <StatusBadge label="Cần quyết định" variant="primary" /> : undefined}
          >
            {duplicatePending ? (
              <div className="space-y-3">
                {duplicateNeedsReview && duplicateReview ? <DuplicateReviewPanel review={duplicateReview} onAction={onDuplicateAction} /> : null}
                <CatalogDuplicateWarning matches={duplicateMatches} confirmed={confirmDuplicateSave} onConfirm={onConfirmDuplicateSave} />
              </div>
            ) : "Không phát hiện vấn đề"}
          </VerificationCategoryCard>

          <VerificationCategoryCard
            tone="violet"
            icon={Wand2}
            title="Chuẩn hóa dữ liệu"
            description="Duyệt tác giả, nhà xuất bản và thể loại theo catalog chuẩn."
            pending={authorityNeedsReview}
            expandable={authorityNeedsReview}
            open={activeReviewId === "authority"}
            onToggle={() => onToggleReview("authority")}
            badge={authorityNeedsReview ? <StatusBadge label="Cần duyệt" variant="violet" /> : undefined}
          >
            {authorityNeedsReview && reconciliationDraft ? (
              <AuthorityReviewPanel draft={reconciliationDraft} onDecision={onAuthorityDecision} onCreateEntity={onCreateAuthorityEntity} />
            ) : "Không phát hiện vấn đề"}
          </VerificationCategoryCard>

          <VerificationCategoryCard
            tone="amber"
            icon={GitCompareArrows}
            title="Đối chiếu nguồn dữ liệu"
            description="So sánh giá trị được chọn với các nguồn xác nhận trước khi lưu."
            pending={evidenceNeedsReview}
            expandable={evidenceHasContent}
            open={evidenceNeedsReview ? activeReviewId === "evidence" : evidenceClearOpen}
            onToggle={() => (evidenceNeedsReview ? onToggleReview("evidence") : setEvidenceClearOpen((value) => !value))}
            badge={
              evidenceNeedsReview
                ? <StatusBadge label={`${lookupData.conflicts?.length || 0} xung đột`} variant="warning" />
                : evidenceHasContent
                  ? <StatusBadge label={sourceCount ? `${sourceCount} nguồn` : "Thủ công"} variant="neutral" />
                  : undefined
            }
          >
            {evidenceHasContent ? <IsbnIntelligencePanel lookup={lookupData} /> : "Nhập thủ công — chưa có nguồn xác nhận"}
          </VerificationCategoryCard>
        </div>

        {reviewIssueCount === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-success/20 bg-success/[0.03] px-4 py-6 text-center sm:flex-row sm:text-left" role="status">
            <div className="flex h-20 w-28 shrink-0 -rotate-6 items-center justify-center rounded-[50%] border-[3px] border-success" aria-hidden="true">
              <div className="flex flex-col items-center gap-0.5 text-success">
                <BadgeCheck className="h-5 w-5" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Đã xác minh</span>
              </div>
            </div>
            <div>
              <p className="text-[14px] font-semibold text-success">Sẵn sàng lưu vào catalog</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Authority, trùng lặp và dữ liệu nguồn đã sẵn sàng.</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
