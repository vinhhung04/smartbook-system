import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { StatusBadge } from "@/components/status-badge";
import type { LookupBookByIsbnResponse } from "@/services/ai";
import { displayEvidenceValue, hasIsbnEvidence } from "./utils";
import { ReviewDisclosure } from "./review-queue-item";
import { ConfidenceMeter } from "./confidence-meter";

export function IsbnIntelligencePanel({ lookup }: { lookup: LookupBookByIsbnResponse }) {
  const { t } = useI18n();
  const evidence = Object.entries(lookup.fieldEvidence || {}).filter(([, item]) => item.selectedSource);
  const conflicts = lookup.conflicts || [];
  const sources = lookup.sources || [];
  if (!hasIsbnEvidence(lookup)) return null;

  return (
    <section className="space-y-3" aria-label={t("isbn_intelligence.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">{t("isbn_intelligence.title")}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {t("isbn_intelligence.quality")} {Math.round((lookup.metadataQualityScore || 0) * 100)}% · {t("isbn_intelligence.processing")} {lookup.processingTimeMs ?? 0} ms
          </p>
        </div>
        {conflicts.length > 0 ? <StatusBadge label={`${conflicts.length} ${t("isbn_intelligence.conflicts")}`} variant="warning" /> : null}
      </div>

      {conflicts.length > 0 ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-[13px] text-warning">
          <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />{t("isbn_intelligence.conflict_warning")}</div>
          {conflicts.map((conflict) => <p key={conflict.field} className="mt-1">{conflict.field}: {displayEvidenceValue(conflict.selectedValue)} · {conflict.alternatives.map((item) => `${item.source}: ${displayEvidenceValue(item.value)}`).join(" | ")}</p>)}
        </div>
      ) : null}

      {evidence.length > 0 ? (
        <ReviewDisclosure
          id="isbn-intel-evidence"
          title={t("isbn_intelligence.evidence")}
          description={`${evidence.length} trường có nguồn xác nhận`}
        >
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {evidence.map(([field, item]) => (
              <div key={field} className="rounded-md border border-border bg-card px-3 py-2.5 text-[13px]">
                <p className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
                  {field}
                  <ConfidenceMeter value={lookup.fieldConfidence?.[field] || 0} tone="amber" />
                  <span className="font-normal text-muted-foreground">{Math.round((lookup.fieldConfidence?.[field] || 0) * 100)}%</span>
                </p>
                <p className="mt-0.5 text-muted-foreground">{displayEvidenceValue(item.selectedValue)}</p>
                <p className="mt-1 text-cyan-700 dark:text-cyan-300">{t("isbn_intelligence.confirmed_by")}: {item.confirmations.map((confirmation) => confirmation.source).join(", ")}</p>
              </div>
            ))}
          </div>
        </ReviewDisclosure>
      ) : null}

      {sources.length > 0 ? (
        <ReviewDisclosure
          id="isbn-intel-sources"
          title={t("isbn_intelligence.sources")}
          description={`${sources.length} nguồn đã được kiểm tra`}
        >
          <div className="flex flex-wrap gap-1.5">
            {sources.map((source) => <StatusBadge key={source.name} label={`${source.name}: ${source.status}`} variant={source.status === "SUCCESS" ? "success" : source.status === "DISABLED" ? "neutral" : "warning"} />)}
          </div>
        </ReviewDisclosure>
      ) : null}
    </section>
  );
}
