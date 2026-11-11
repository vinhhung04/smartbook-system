import { CheckCircle2, CircleDashed, CirclePlus, Info, Link2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { NormalizationSuggestion, ReconciliationDraft } from "@/services/metadata-intelligence";
import { formatQualityWarning } from "./utils";
import { ConfidenceMeter } from "./confidence-meter";

const FIELD_LABELS: Record<string, string> = {
  title: "Tên sách",
  subtitle: "Phụ đề",
  authors: "Tác giả",
  translator: "Dịch giả",
  publisher: "Nhà xuất bản",
  categories: "Thể loại",
  language: "Ngôn ngữ",
  publishedDate: "Ngày xuất bản",
  pageCount: "Số trang",
  coverFormat: "Loại bìa",
  description: "Mô tả",
  isbn: "ISBN",
};

// What "Tạo mới" adds to, per authority field.
const CATALOG_NOUN: Record<string, { list: string; create: string }> = {
  authors: { list: "danh mục tác giả", create: "Thêm tác giả mới vào danh mục" },
  publisher: { list: "danh mục nhà xuất bản", create: "Thêm NXB mới vào danh mục" },
  categories: { list: "danh mục thể loại", create: "Thêm thể loại mới vào danh mục" },
};

function formatDecisionValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(trống)";
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function DecisionChip({ status }: { status: "PENDING" | "ACCEPTED" | "REJECTED" }) {
  const meta = {
    PENDING: { label: "Chờ duyệt", cls: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" },
    ACCEPTED: { label: "Đã chấp nhận", cls: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300" },
    REJECTED: { label: "Đã từ chối", cls: "border-border bg-muted/60 text-muted-foreground" },
  }[status];
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium ${meta.cls}`}>{meta.label}</span>;
}

/**
 * How one value relates to the catalog. The backend's normalizedValue is a
 * lower-case, accent-free matching key for people and publishers (not a new
 * spelling), so it is never shown as a "suggestion"; for categories it is the
 * internal taxonomy name and is shown when it differs.
 */
function MatchLine({ item, field }: { item: NormalizationSuggestion; field: string }) {
  const noun = CATALOG_NOUN[field]?.list ?? "danh mục";
  const taxonomyName = field === "categories" && item.normalizedValue && item.normalizedValue !== item.rawValue ? item.normalizedValue : null;
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="break-words text-[13.5px] font-semibold text-foreground">{item.rawValue || "(trống)"}</p>
      {item.status === "AUTO_MATCH" ? (
        <p className="mt-1 flex items-start gap-1.5 text-[12px] text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Đã có trong {noun}{item.matchedEntity && item.matchedEntity.name !== item.rawValue ? `: “${item.matchedEntity.name}”` : ""}.</span>
        </p>
      ) : item.status === "REVIEW_REQUIRED" ? (
        <p className="mt-1 flex items-start gap-1.5 text-[12px] text-amber-800 dark:text-amber-300">
          <Link2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Gần giống “{item.matchedEntity?.name ?? taxonomyName}” trong {noun}
            <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-muted-foreground">
              <ConfidenceMeter value={item.confidence} tone="amber" />{Math.round(item.confidence * 100)}% từ trùng
            </span>
            . Chấp nhận sẽ liên kết sách với mục này.
          </span>
        </p>
      ) : (
        <p className="mt-1 flex items-start gap-1.5 text-[12px] text-muted-foreground">
          <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Chưa có trong {noun}.</span>
        </p>
      )}
      {taxonomyName && item.status === "AUTO_MATCH" ? <p className="mt-1 text-[12px] text-muted-foreground">Thể loại nội bộ: {taxonomyName}</p> : null}
    </li>
  );
}

export function AuthorityReviewPanel({
  draft,
  onDecision,
  onCreateEntity,
}: {
  draft: ReconciliationDraft;
  onDecision: (field: string, status: "ACCEPTED" | "REJECTED") => void;
  onCreateEntity: (field: string) => void;
}) {
  const { t } = useI18n();
  const rows = [
    { field: "authors", label: t("metadata_reconciliation.authors"), items: draft.normalizationSuggestions.authorNormalization },
    { field: "publisher", label: t("metadata_reconciliation.publisher"), items: [draft.normalizationSuggestions.publisherNormalization] },
    { field: "categories", label: t("metadata_reconciliation.categories"), items: draft.normalizationSuggestions.categoryNormalization },
  ].map((row) => ({ ...row, items: row.items.filter((item) => item && item.rawValue) }))
    .filter((row) => row.items.length > 0);
  // Fields the backend left PENDING because the lookup sources disagree or the
  // evidence is weak (not authority matches): staff must confirm or reject the
  // value shown in the form before the draft can be applied.
  const shownFields = new Set(rows.map((row) => row.field));
  const otherPending = draft.decisions.filter((item) => item.status === "PENDING" && !shownFields.has(item.field));
  if (!rows.length && !otherPending.length) return null;

  const button = "inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

  return (
    <section aria-label={t("metadata_reconciliation.title")} className="space-y-3">
      <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          Tác giả, nhà xuất bản và thể loại luôn chờ bạn xác nhận cách liên kết với danh mục của thư viện — kể cả khi tên đã đúng.
          Giá trị được lưu là giá trị trong biểu mẫu.
        </span>
      </p>

      {rows.map((row) => {
        const decision = draft.decisions.find((item) => item.field === row.field)?.status || "PENDING";
        const hasNew = row.items.some((item) => item.status === "NEW_ENTITY");
        const noun = CATALOG_NOUN[row.field];
        return (
          <div key={row.field} className="space-y-2.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[13.5px] font-semibold text-foreground">{row.label}</h4>
              <DecisionChip status={decision} />
            </div>
            <ul className="space-y-1.5">
              {row.items.map((item, index) => <MatchLine key={`${item.rawValue}-${index}`} item={item} field={row.field} />)}
            </ul>
            {decision === "PENDING" ? (
              <>
                {hasNew && noun ? (
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    <strong className="font-medium text-foreground">Chấp nhận</strong> giữ tên nhưng không liên kết tên chưa có trong {noun.list}.{" "}
                    <strong className="font-medium text-foreground">Thêm mới</strong> tạo mục đó khi bạn lưu sách.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => onDecision(row.field, "ACCEPTED")} className={`${button} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300`}>
                    {t("metadata_reconciliation.accept")}
                  </button>
                  {hasNew && noun ? (
                    <button type="button" onClick={() => onCreateEntity(row.field)} className={`${button} border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300`}>
                      <CirclePlus className="h-3.5 w-3.5" aria-hidden="true" />
                      {noun.create}
                    </button>
                  ) : null}
                  <button type="button" onClick={() => onDecision(row.field, "REJECTED")} className={`${button} border-border bg-card text-muted-foreground hover:bg-muted`}>
                    {t("metadata_reconciliation.reject")}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        );
      })}

      {otherPending.length ? (
        <div className="space-y-3 border-t border-border pt-3">
          {otherPending.map((item) => (
            <div key={item.field} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[13.5px] font-semibold text-foreground">{FIELD_LABELS[item.field] || item.field}</h4>
                <DecisionChip status="PENDING" />
              </div>
              <p className="text-[12px] text-muted-foreground">Các nguồn tra cứu không thống nhất hoặc bằng chứng yếu — kiểm tra giá trị trong biểu mẫu trước khi chấp nhận.</p>
              <p className="break-words rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground">{formatDecisionValue(item.value)}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => onDecision(item.field, "ACCEPTED")} className={`${button} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300`}>{t("metadata_reconciliation.accept")}</button>
                <button type="button" onClick={() => onDecision(item.field, "REJECTED")} className={`${button} border-border bg-card text-muted-foreground hover:bg-muted`}>{t("metadata_reconciliation.reject")}</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {draft.qualityWarnings.length ? (
        <ul className="flex flex-wrap gap-2 border-t border-border pt-3" aria-label="Cảnh báo chất lượng">
          {draft.qualityWarnings.map((warning) => (
            <li key={warning} className="rounded-full bg-amber-50 px-2.5 py-1 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              {formatQualityWarning(warning)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
