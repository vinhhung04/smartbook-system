import { useState, type ReactNode } from "react";
import { BadgeCheck, BookCopy, FileSearch, GitCompareArrows, Wand2 } from "lucide-react";
import type { LookupBookByIsbnResponse } from "@/services/ai";
import type { DuplicateReview, ReconciliationDraft } from "@/services/metadata-intelligence";
import { AuthorityReviewPanel } from "./authority-review-panel";
import { CatalogDuplicateWarning, DuplicateReviewPanel } from "./duplicate-review-panel";
import { IsbnIntelligencePanel } from "./isbn-intelligence-panel";
import { VerificationCategoryCard } from "./verification-category-card";
import { hasIsbnEvidence } from "./utils";
import type { DuplicateMatch } from "./types";
import { REVIEW_CARD_IDS } from "./review-ids";

/**
 * The review rail: every decision the import still needs, in one column next to
 * the form. Read-only facts (sources, coverage) stay folded; anything that blocks
 * saving or needs a choice opens by default.
 */
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
  ocrPanel,
  ocrDecisionCount,
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
  /** The OCR result panel, when this import came from photos. */
  ocrPanel?: ReactNode;
  /** OCR fields waiting on a choice (conflicts, review required). */
  ocrDecisionCount: number;
}) {
  // The evidence card can stay expandable even when there's nothing to act on (just
  // informational sourcing) — that state isn't part of the single-open accordion the
  // other two cards share, so it gets its own small local toggle.
  const [evidenceClearOpen, setEvidenceClearOpen] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(true);
  const evidenceHasContent = hasIsbnEvidence(lookupData);
  // A catalog-level duplicate match (client-side title/ISBN scan) also has to block the
  // card from collapsing into "clear", even if the AI/backend duplicate check itself
  // came back NEW_TITLE — otherwise a real save-blocking warning could hide.
  const duplicatePending = duplicateNeedsReview || (duplicateMatches.length > 0 && !confirmDuplicateSave);
  const total = reviewIssueCount + (ocrDecisionCount ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Kiểm duyệt</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {total ? `${total} nhóm cần bạn xem trước khi lưu` : "Không còn mục nào cần quyết định"}
          </p>
        </div>
      </div>

      {ocrPanel ? (
        <VerificationCategoryCard
          id={REVIEW_CARD_IDS.ocr}
          icon={FileSearch}
          title="Kết quả đọc ảnh"
          description={ocrDecisionCount ? `${ocrDecisionCount} trường xung đột hoặc cần kiểm tra — không có giá trị nào tự áp dụng.` : "Các giá trị AI đọc từ ảnh, so với biểu mẫu."}
          pending={ocrDecisionCount > 0}
          expandable
          open={ocrOpen}
          onToggle={() => setOcrOpen((value) => !value)}
        >
          {ocrPanel}
        </VerificationCategoryCard>
      ) : null}

      <VerificationCategoryCard
        id={REVIEW_CARD_IDS.duplicate}
        icon={BookCopy}
        title="Trùng lặp & ấn bản"
        description={duplicatePending ? "Chọn cách xử lý với sách tương tự trong catalog trước khi lưu." : "So với catalog hiện có."}
        pending={duplicatePending}
        expandable={duplicatePending}
        open={activeReviewId === "duplicate"}
        onToggle={() => onToggleReview("duplicate")}
      >
        {duplicatePending ? (
          <div className="space-y-3">
            {duplicateNeedsReview && duplicateReview ? <DuplicateReviewPanel review={duplicateReview} onAction={onDuplicateAction} /> : null}
            <CatalogDuplicateWarning matches={duplicateMatches} confirmed={confirmDuplicateSave} onConfirm={onConfirmDuplicateSave} />
          </div>
        ) : duplicateReview ? "Hệ thống xếp là đầu sách mới — không thấy sách trùng." : "Không phát hiện sách trùng trong catalog."}
      </VerificationCategoryCard>

      <VerificationCategoryCard
        id={REVIEW_CARD_IDS.authority}
        icon={Wand2}
        title="Chuẩn hóa dữ liệu"
        description={authorityNeedsReview ? "Duyệt tác giả, nhà xuất bản, thể loại theo danh mục chuẩn." : "Tác giả, NXB, thể loại theo danh mục chuẩn."}
        pending={authorityNeedsReview}
        expandable={authorityNeedsReview}
        open={activeReviewId === "authority"}
        onToggle={() => onToggleReview("authority")}
      >
        {authorityNeedsReview && reconciliationDraft ? (
          <AuthorityReviewPanel draft={reconciliationDraft} onDecision={onAuthorityDecision} onCreateEntity={onCreateAuthorityEntity} />
        ) : reconciliationDraft ? "Mọi quyết định chuẩn hóa đã xong." : "Không có bản nháp chuẩn hóa cho lần nhập này."}
      </VerificationCategoryCard>

      <VerificationCategoryCard
        id={REVIEW_CARD_IDS.evidence}
        icon={GitCompareArrows}
        title="Đối chiếu nguồn dữ liệu"
        description={evidenceNeedsReview
          ? `${lookupData.conflicts?.length || 0} trường có nguồn ghi khác nhau — kiểm tra giá trị đã chọn.`
          : evidenceHasContent ? `${sourceCount ? `${sourceCount} nguồn có dữ liệu` : "Nguồn đã kiểm tra"} · mở để xem nguồn của từng trường.` : "Chưa có nguồn xác nhận."}
        pending={evidenceNeedsReview}
        expandable={evidenceHasContent}
        open={evidenceNeedsReview ? activeReviewId === "evidence" : evidenceClearOpen}
        onToggle={() => (evidenceNeedsReview ? onToggleReview("evidence") : setEvidenceClearOpen((value) => !value))}
      >
        {evidenceHasContent ? <IsbnIntelligencePanel lookup={lookupData} /> : "Nhập thủ công — chưa có nguồn xác nhận."}
      </VerificationCategoryCard>

      {total === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3.5 py-3 dark:border-emerald-500/25 dark:bg-emerald-500/[0.06]" role="status">
          <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <div>
            <p className="text-[13px] font-semibold text-foreground">Không còn mục kiểm duyệt</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Vẫn nên so các trường quan trọng với sách thật trước khi bấm Lưu.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
