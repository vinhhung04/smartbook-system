import { BookCopy, GitCompareArrows, Wand2 } from "lucide-react";
import type { LookupBookByIsbnResponse } from "@/services/ai";
import type { DuplicateReview, ReconciliationDraft } from "@/services/metadata-intelligence";
import { AuthorityReviewPanel } from "./authority-review-panel";
import { CatalogDuplicateWarning, DuplicateReviewPanel } from "./duplicate-review-panel";
import { VerificationCategoryCard } from "./verification-category-card";
import { SOURCE_LABELS, displayEvidenceValue, fieldLabel } from "./utils";
import type { DuplicateMatch } from "./types";
import { REVIEW_CARD_IDS } from "./review-ids";

/**
 * The decisions the import still needs: duplicates & editions, authority
 * normalization and source conflicts. Anything that blocks saving or needs a
 * choice opens by default; settled cards stay closed.
 */
export function ReviewTab({
  lookupData, reconciliationDraft, duplicateReview, duplicateMatches, confirmDuplicateSave, onConfirmDuplicateSave,
  activeReviewId, onToggleReview, duplicateNeedsReview, authorityNeedsReview, evidenceNeedsReview,
  onAuthorityDecision, onCreateAuthorityEntity, onDuplicateAction, onShowConflict,
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
  onAuthorityDecision: (field: string, status: "ACCEPTED" | "REJECTED") => void;
  onCreateAuthorityEntity: (field: string) => void;
  onDuplicateAction: (action: string, candidate?: DuplicateReview["candidates"][number]) => void;
  /** Opens the metadata review on that field's evidence. */
  onShowConflict: (evidenceField: string) => void;
}) {
  // A catalog-level duplicate match (client-side title/ISBN scan) also keeps the card
  // open, even if the backend duplicate check came back NEW_TITLE.
  const duplicatePending = duplicateNeedsReview || (duplicateMatches.length > 0 && !confirmDuplicateSave);
  const conflicts = lookupData.conflicts || [];

  return (
    <div className="space-y-3">
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
        title="Chuẩn hóa tác giả, NXB, thể loại"
        description={authorityNeedsReview ? "Duyệt theo danh mục chuẩn của catalog." : "Theo danh mục chuẩn của catalog."}
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
        title="Xung đột giữa các nguồn"
        description={evidenceNeedsReview
          ? `${conflicts.length} trường có nguồn ghi khác nhau — hệ thống đã chọn một giá trị, bạn nên kiểm tra.`
          : "Các nguồn không ghi khác nhau ở trường nào."}
        pending={evidenceNeedsReview}
        expandable={evidenceNeedsReview}
        open={activeReviewId === "evidence"}
        onToggle={() => onToggleReview("evidence")}
      >
        {evidenceNeedsReview ? <ul className="divide-y divide-border/70">
          {conflicts.map((conflict) => (
            <li key={conflict.field} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
              <div className="min-w-0 text-[13px]">
                <p className="font-semibold text-foreground">{fieldLabel(conflict.field)}</p>
                <p className="mt-0.5 break-words text-muted-foreground">
                  Đang dùng: <span className="text-foreground">{displayEvidenceValue(conflict.selectedValue)}</span>
                </p>
                <p className="mt-0.5 break-words text-muted-foreground">
                  Khác: {conflict.alternatives.map((item) => `${SOURCE_LABELS[item.source] || item.source} — ${displayEvidenceValue(item.value)}`).join(" · ")}
                </p>
              </div>
              <button type="button" onClick={() => onShowConflict(conflict.field)}
                className="inline-flex min-h-8 shrink-0 cursor-pointer items-center rounded-md border border-border px-2.5 text-[12.5px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                So sánh và chọn<span className="sr-only"> {fieldLabel(conflict.field)}</span>
              </button>
            </li>
          ))}
        </ul> : "Không có trường nào cần so sánh."}
      </VerificationCategoryCard>
    </div>
  );
}
