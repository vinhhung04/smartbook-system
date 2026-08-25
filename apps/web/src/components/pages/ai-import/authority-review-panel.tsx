import { useI18n } from "@/lib/i18n";
import { StatusBadge } from "@/components/status-badge";
import type { ReconciliationDraft } from "@/services/metadata-intelligence";
import { formatQualityWarning } from "./utils";

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
  ].filter((row) => row.items.length > 0);
  if (!rows.length) return null;
  return (
    <section aria-label={t("metadata_reconciliation.title")}>
      <p className="mb-2 text-[13px] leading-5 text-muted-foreground">{t("metadata_reconciliation.hint")}</p>
      <div className="divide-y divide-border border-y border-border">
        {rows.map((row) => {
          const decision = draft.decisions.find((item) => item.field === row.field)?.status || "PENDING";
          return (
            <div key={row.field} className="py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-[14px] font-semibold text-foreground">{row.label}</h4>
                    <StatusBadge label={decision === "PENDING" ? "Chờ duyệt" : decision === "ACCEPTED" ? "Đã chấp nhận" : "Đã từ chối"} variant={decision === "PENDING" ? "warning" : decision === "ACCEPTED" ? "success" : "neutral"} />
                  </div>
                  <div className="mt-3 space-y-3">
                    {row.items.map((item) => (
                      <div key={`${item.rawValue}-${item.normalizedValue}`} className="grid gap-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dữ liệu gốc</p>
                          <p className="mt-0.5 truncate font-medium text-foreground">{item.rawValue}</p>
                        </div>
                        <span className="hidden text-muted-foreground sm:block" aria-hidden="true">→</span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Đề xuất chuẩn hóa</p>
                          <p className="mt-0.5 truncate font-medium text-foreground">{item.normalizedValue}</p>
                        </div>
                        <p className="text-[12px] text-muted-foreground sm:col-span-3">
                          {item.matchedEntity?.name || t("metadata_reconciliation.new_entity")} · Tin cậy {Math.round(item.confidence * 100)}%
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
                {decision === "PENDING" ? <div className="flex shrink-0 flex-wrap gap-2">
                  <button type="button" onClick={() => onDecision(row.field, "ACCEPTED")} className="min-h-10 cursor-pointer rounded-md border border-success/30 bg-success/10 px-3 text-[12px] font-semibold text-success transition-colors hover:bg-success/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/30">{t("metadata_reconciliation.accept")}</button>
                  <button type="button" onClick={() => onDecision(row.field, "REJECTED")} className="min-h-10 cursor-pointer rounded-md border border-border bg-card px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/30">{t("metadata_reconciliation.reject")}</button>
                  {row.items.some((item) => item.status === "NEW_ENTITY") ? <button type="button" onClick={() => onCreateEntity(row.field)} className="min-h-10 cursor-pointer rounded-md border border-cyan-200 bg-cyan-50 px-3 text-[12px] font-semibold text-cyan-700 transition-colors hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/30 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300">{t("metadata_reconciliation.create_entity")}</button> : null}
                </div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {draft.qualityWarnings.length ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Cảnh báo chất lượng">
          {draft.qualityWarnings.map((warning) => (
            <li key={warning} className="rounded-full bg-warning/10 px-2.5 py-1 text-[12px] text-warning">
              {formatQualityWarning(warning)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
