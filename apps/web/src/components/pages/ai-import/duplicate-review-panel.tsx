import { AlertTriangle, BookCopy, BookPlus, Copy, Layers } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { DuplicateReview } from "@/services/metadata-intelligence";
import type { DuplicateMatch } from "./types";
import { formatDuplicateClassification } from "./utils";
import { ConfidenceMeter } from "./confidence-meter";

// How close the incoming book is to what the catalog already has, most to least.
// POSSIBLE_DUPLICATE is not a step on this scale; it is shown with its own label.
const SCALE: Array<{ key: DuplicateReview["classification"]; icon: typeof Copy; meaning: string }> = [
  { key: "EXACT_DUPLICATE", icon: Copy, meaning: "Sách đã tồn tại: cùng đầu sách, cùng ấn bản và đã có bản sách tương ứng." },
  { key: "SAME_EDITION", icon: Layers, meaning: "Cùng một ấn bản đã có trong catalog — thêm một variant mới cho ấn bản đó." },
  { key: "SAME_WORK_DIFFERENT_EDITION", icon: BookCopy, meaning: "Cùng tác phẩm nhưng ấn bản khác (lần in, NXB, ISBN khác) — tạo edition mới thuộc đầu sách đó." },
  { key: "NEW_TITLE", icon: BookPlus, meaning: "Không thấy đầu sách tương tự — đây là tác phẩm mới." },
];

export function DuplicateReviewPanel({ review, onAction }: { review: DuplicateReview; onAction: (action: string, candidate?: DuplicateReview["candidates"][number]) => void }) {
  const { t } = useI18n();
  const isNew = review.classification === "NEW_TITLE";
  const target = review.candidates[0];
  const current = SCALE.find((step) => step.key === review.classification);
  const primaryAction = review.classification === "EXACT_DUPLICATE" && target ? { action: "LINK_EXISTING_VARIANT", label: t("duplicate_intelligence.link_variant") }
    : review.classification === "SAME_EDITION" && target ? { action: "CREATE_VARIANT_FOR_EDITION", label: t("duplicate_intelligence.create_variant") }
    : review.classification === "SAME_WORK_DIFFERENT_EDITION" && target ? { action: "CREATE_NEW_EDITION", label: t("duplicate_intelligence.create_edition") }
    : null;

  return (
    <section className="space-y-4" aria-label={t("duplicate_intelligence.title")}>
      <ol className="grid grid-cols-2 gap-1.5" aria-label="Mức độ trùng với catalog">
        {SCALE.map(({ key, icon: Icon }) => {
          const active = key === review.classification;
          return (
            <li
              key={key}
              aria-current={active ? "true" : undefined}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11.5px] leading-tight ${
                active ? "border-primary/50 bg-primary/10 font-semibold text-foreground" : "border-border text-muted-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {formatDuplicateClassification(key)}
            </li>
          );
        })}
      </ol>

      <div className="rounded-xl bg-muted/40 px-3.5 py-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-foreground">
          {formatDuplicateClassification(review.classification)}
          <span className="inline-flex items-center gap-1.5 text-[12px] font-normal text-muted-foreground">
            điểm tương đồng <ConfidenceMeter value={review.similarityScore} tone="indigo" /> {Math.round(review.similarityScore * 100)}%
          </span>
        </p>
        {current ? <p className="mt-1 text-[12.5px] text-foreground/85">{current.meaning}</p> : null}
        {review.explanation.length ? <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{review.explanation.join(" ")}</p> : null}
      </div>

      {review.candidates.length ? (
        <div>
          <p className="mb-1.5 text-[12px] font-semibold text-foreground">Sách tương tự trong catalog</p>
          <ul className="space-y-1.5" role="list">
            {review.candidates.slice(0, 3).map((candidate, index) => (
              <li key={candidate.bookId} className={`rounded-lg border px-3 py-2.5 text-[13px] ${index === 0 && primaryAction ? "border-primary/40 bg-primary/[0.04]" : "border-border"}`}>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-semibold text-foreground">{candidate.title}</span>
                  <span className="text-[12px] text-muted-foreground">{formatDuplicateClassification(candidate.classification)}</span>
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <ConfidenceMeter value={candidate.score} tone="indigo" /> {Math.round(candidate.score * 100)}%
                  </span>
                  {index === 0 && primaryAction ? <span className="ml-auto text-[11.5px] font-medium text-primary">Hành động bên dưới áp dụng cho sách này</span> : null}
                </p>
                {candidate.explanation?.length ? <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{candidate.explanation.join(" ")}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {primaryAction && target ? (
          <button type="button" onClick={() => onAction(primaryAction.action, target)} className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {primaryAction.label}
          </button>
        ) : null}
        {isNew ? (
          <button type="button" onClick={() => onAction("CREATE_NEW_TITLE")} className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-primary px-3.5 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t("duplicate_intelligence.create_title")}
          </button>
        ) : (
          <button type="button" onClick={() => onAction("DISMISS_WARNING")} className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-border bg-card px-3.5 text-[12.5px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t("duplicate_intelligence.dismiss")}
          </button>
        )}
      </div>
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
    <section className="rounded-xl border border-amber-300/70 bg-amber-50/60 px-4 py-3.5 dark:border-amber-500/30 dark:bg-amber-500/[0.07]" aria-labelledby="catalog-duplicate-title">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 id="catalog-duplicate-title" className="text-[13.5px] font-semibold text-foreground">Xác nhận trùng catalog</h3>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">Danh mục hiện có những sách sau trùng ISBN hoặc trùng tên. Việc lưu bị chặn cho tới khi bạn xác nhận.</p>
          <ul className="mt-2.5 divide-y divide-border border-y border-border text-[13px]" role="list">
            {matches.slice(0, 5).map((match) => (
              <li key={match.book.id} className="flex flex-wrap items-baseline gap-x-2 py-2">
                <span className="font-medium text-foreground">{match.book.title}</span>
                {match.book.author ? <span className="text-muted-foreground">— {match.book.author}</span> : null}
                {match.book.isbn ? <span className="font-mono text-[12px] text-muted-foreground">ISBN {match.book.isbn}</span> : null}
                <span className="ml-auto rounded bg-card px-1.5 text-[11.5px] font-medium text-amber-800 dark:text-amber-300">{match.reason === "isbn" ? "trùng ISBN" : "trùng tên sách"}</span>
              </li>
            ))}
          </ul>
          <label className="mt-3 flex min-h-10 cursor-pointer items-start gap-2.5 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => onConfirm(event.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-amber-600"
            />
            <span>Tôi xác nhận đây vẫn là bản sách cần lưu, ví dụ một ấn bản hoặc đợt nhập khác.</span>
          </label>
        </div>
      </div>
    </section>
  );
}
