import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { DuplicateReview } from "@/services/metadata-intelligence";
import type { DuplicateMatch } from "./types";

export function DuplicateReviewPanel({ review, onAction }: { review: DuplicateReview; onAction: (action: string, candidate?: DuplicateReview["candidates"][number]) => void }) {
  const { t } = useI18n();
  const isNew = review.classification === "NEW_TITLE";
  return (
    <section className="space-y-3" aria-label={t("duplicate_intelligence.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] text-muted-foreground">{review.classification} · {Math.round(review.similarityScore * 100)}%</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {review.classification === "EXACT_DUPLICATE" && review.candidates[0] ? <button type="button" onClick={() => onAction("LINK_EXISTING_VARIANT", review.candidates[0])} className="min-h-9 rounded-md border border-cyan-200 bg-cyan-50 px-3 text-[12px] font-semibold text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("duplicate_intelligence.link_variant")}</button> : null}
          {review.classification === "SAME_EDITION" && review.candidates[0] ? <button type="button" onClick={() => onAction("CREATE_VARIANT_FOR_EDITION", review.candidates[0])} className="min-h-9 rounded-md border border-cyan-200 bg-cyan-50 px-3 text-[12px] font-semibold text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("duplicate_intelligence.create_variant")}</button> : null}
          {review.classification === "SAME_WORK_DIFFERENT_EDITION" && review.candidates[0] ? <button type="button" onClick={() => onAction("CREATE_NEW_EDITION", review.candidates[0])} className="min-h-9 rounded-md border border-cyan-200 bg-cyan-50 px-3 text-[12px] font-semibold text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("duplicate_intelligence.create_edition")}</button> : null}
          {isNew ? <button type="button" onClick={() => onAction("CREATE_NEW_TITLE")} className="min-h-9 rounded-md border border-success/30 bg-success/10 px-3 text-[12px] font-semibold text-success hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/30">{t("duplicate_intelligence.create_title")}</button> : <button type="button" onClick={() => onAction("DISMISS_WARNING")} className="min-h-9 rounded-md border border-border bg-card px-3 text-[12px] font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/30">{t("duplicate_intelligence.dismiss")}</button>}
        </div>
      </div>
      <p className="text-[13px] leading-5 text-muted-foreground">{review.explanation.join(" ")}</p>
      {review.candidates.length ? <ul className="space-y-1.5" role="list">{review.candidates.slice(0, 3).map((candidate) => <li key={candidate.bookId} className="rounded-md border border-border bg-muted/[0.1] px-3 py-2.5 text-[13px]"><span className="font-semibold text-foreground">{candidate.title}</span> · {candidate.classification} · {Math.round(candidate.score * 100)}%</li>)}</ul> : null}
    </section>
  );
}

export function CatalogDuplicateWarning({
  matches,
  confirmed,
  onConfirm,
}: {
  matches: DuplicateMatch[];
  confirmed: boolean;
  onConfirm: (confirmed: boolean) => void;
}) {
  if (!matches.length) return null;
  return (
    <section className="rounded-xl border border-warning/25 bg-warning/5 px-4 py-4" aria-labelledby="catalog-duplicate-title">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id="catalog-duplicate-title" className="text-[14px] font-semibold text-foreground">Xác nhận trùng catalog</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">Các bản ghi sau có thể là cùng sách hoặc cùng ISBN.</p>
          <ul className="mt-3 divide-y divide-border border-y border-border text-[13px]" role="list">
            {matches.slice(0, 5).map((match) => (
              <li key={match.book.id} className="py-2.5">
                <span className="font-medium text-foreground">{match.book.title}</span>
                {match.book.author ? ` — ${match.book.author}` : ""}
                {match.book.isbn ? ` · ISBN ${match.book.isbn}` : ""}
                <span className="ml-1 text-muted-foreground">· {match.reason === "isbn" ? "trùng ISBN" : "trùng tên sách"}</span>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => onConfirm(event.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-warning"
            />
            <span>Tôi xác nhận đây vẫn là bản sách cần lưu, ví dụ một ấn bản hoặc đợt nhập khác.</span>
          </label>
        </div>
      </div>
    </section>
  );
}
