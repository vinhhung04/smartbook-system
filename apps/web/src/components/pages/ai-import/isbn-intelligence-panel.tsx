import { AlertTriangle, Check, ExternalLink } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { StatusBadge } from "@/components/status-badge";
import type { IsbnSourceName, LookupBookByIsbnResponse } from "@/services/ai";
import {
  SOURCE_LABELS, displayEvidenceValue, extractionMethodI18nKey, fieldLabel, hasIsbnEvidence,
  isFieldConflicted, reasonCodeI18nKey, reasonCodeTone,
} from "./utils";
import { ReviewDisclosure } from "./review-queue-item";
import { ConfidenceMeter } from "./confidence-meter";

interface EvidenceSourceRow {
  source: IsbnSourceName;
  value: unknown;
  method?: string;
  reliability?: number;
  sourceUrl?: string;
}

export function IsbnIntelligencePanel({ lookup }: { lookup: LookupBookByIsbnResponse }) {
  const { t } = useI18n();
  const evidence = Object.entries(lookup.fieldEvidence || {}).filter(([, item]) => item.selectedSource);
  const conflicts = lookup.conflicts || [];
  const sources = lookup.sources || [];
  const coverage = lookup.metadataCoverage;
  const fieldStatus = Object.entries(lookup.fieldStatus || {});
  if (!hasIsbnEvidence(lookup)) return null;

  return (
    <section className="space-y-3" aria-label={t("isbn_intelligence.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">{t("isbn_intelligence.title")}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {t("isbn_intelligence.quality")} {Math.round((lookup.metadataQualityScore || 0) * 100)}%
            {coverage ? ` · ${coverage.foundFields}/${coverage.totalFields} trường` : ""} · {t("isbn_intelligence.processing")} {lookup.processingTimeMs ?? 0} ms
          </p>
        </div>
        {conflicts.length > 0 ? <StatusBadge label={`${conflicts.length} ${t("isbn_intelligence.conflicts")}`} variant="warning" /> : null}
      </div>

      {conflicts.length > 0 ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-[13px] text-warning">
          <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />{t("isbn_intelligence.conflict_warning")}</div>
          {conflicts.map((conflict) => {
            // Evidence Fusion's candidates[] carries a support score per competing value -
            // rank them instead of the flat "field: value · source: value" text when it's
            // available; fall back to the old text for an older/cached response.
            const candidates = lookup.fieldEvidence?.[conflict.field]?.candidates;
            if (!candidates || candidates.length < 2) {
              return (
                <p key={conflict.field} className="mt-1.5">
                  <span className="font-medium">{fieldLabel(conflict.field)}</span>: {displayEvidenceValue(conflict.selectedValue)} ·{" "}
                  {conflict.alternatives.map((item) => `${SOURCE_LABELS[item.source] || item.source}: ${displayEvidenceValue(item.value)}`).join(" | ")}
                </p>
              );
            }
            const ranked = [...candidates].sort((a, b) => b.support - a.support);
            return (
              <div key={conflict.field} className="mt-2">
                <p className="font-medium">{fieldLabel(conflict.field)}</p>
                <ul className="mt-1 space-y-1">
                  {ranked.map((candidate, index) => {
                    const isSelected = displayEvidenceValue(candidate.value) === displayEvidenceValue(conflict.selectedValue);
                    return (
                      <li key={index} className="flex flex-wrap items-center gap-1.5">
                        {isSelected ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : <span className="inline-block w-3 shrink-0" />}
                        <span className={isSelected ? "font-medium" : "text-warning/80"}>{displayEvidenceValue(candidate.value)}</span>
                        <ConfidenceMeter value={candidate.support} tone="amber" />
                        <span className="text-[11px]">{Math.round(candidate.support * 100)}%</span>
                        <span className="text-[11px] text-warning/70">· {candidate.sources.map((source) => SOURCE_LABELS[source] || source).join(", ")}</span>
                        {isSelected ? <StatusBadge label={t("isbn_intelligence.selected")} variant="neutral" /> : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {coverage && fieldStatus.length > 0 ? (
        <ReviewDisclosure
          id="isbn-intel-coverage"
          title={t("isbn_intelligence.coverage")}
          description={`${coverage.foundFields}/${coverage.totalFields}`}
        >
          <ul className="grid grid-cols-1 gap-1.5 text-[13px] lg:grid-cols-2">
            {fieldStatus.map(([field, status]) => {
              const item = lookup.fieldEvidence?.[field];
              const enrichedFrom = item?.selectedPhase === "TARGETED" && item.selectedSource ? SOURCE_LABELS[item.selectedSource] : null;
              const ok = status === "SUFFICIENT";
              return (
                <li key={field} className="flex items-start gap-1.5">
                  {ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />}
                  <span>
                    <span className="font-medium text-foreground">{fieldLabel(field)}</span>
                    {enrichedFrom ? <span className="block text-muted-foreground">{t("isbn_intelligence.enriched_from")} {enrichedFrom}</span> : null}
                    {status === "MISSING" ? <span className="block text-muted-foreground">{t("isbn_intelligence.not_found_reliable")}</span> : null}
                    {status === "LOW_CONFIDENCE" ? <span className="block text-muted-foreground">{t("isbn_intelligence.low_confidence")}</span> : null}
                    {status === "CONFLICTED" ? <span className="block text-muted-foreground">{t("isbn_intelligence.conflict_warning")}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </ReviewDisclosure>
      ) : null}

      {evidence.length > 0 ? (
        <ReviewDisclosure
          id="isbn-intel-evidence"
          title={t("isbn_intelligence.evidence")}
          description={`${evidence.length} trường có nguồn xác nhận`}
        >
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {evidence.map(([field, item]) => {
              const conflicted = isFieldConflicted(field, lookup);
              const reasonKey = reasonCodeI18nKey(item.reasonCodes);
              // Richer per-source detail (method, its own reliability, a link) when Evidence
              // Fusion provided it; falls back to the plain source list for an older/cached
              // response that predates `evidence[]`.
              const sourceRows: EvidenceSourceRow[] = item.evidence?.length
                ? item.evidence
                : item.confirmations.map((confirmation) => ({ source: confirmation.source, value: confirmation.value, sourceUrl: confirmation.sourceUrl }));
              return (
                <div
                  key={field}
                  className={`rounded-md border px-3 py-2.5 text-[13px] ${conflicted ? "border-warning/40 border-l-2 bg-warning/5" : "border-border bg-card"}`}
                >
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold text-foreground">
                    {fieldLabel(field)}
                    <ConfidenceMeter value={lookup.fieldConfidence?.[field] || 0} tone="amber" />
                    <span className="font-normal text-muted-foreground">{Math.round((lookup.fieldConfidence?.[field] || 0) * 100)}%</span>
                    {reasonKey ? <StatusBadge label={t(reasonKey)} variant={reasonCodeTone(item.reasonCodes)} /> : null}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">{displayEvidenceValue(item.selectedValue)}</p>
                  <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("isbn_intelligence.confirmed_by")}</p>
                  <ul className="mt-1 space-y-1">
                    {sourceRows.map((row, index) => (
                      <li key={index} className="flex flex-wrap items-center gap-1.5 text-cyan-700 dark:text-cyan-300">
                        <span>{SOURCE_LABELS[row.source] || row.source}</span>
                        {row.method ? <StatusBadge label={t(extractionMethodI18nKey(row.method))} variant="neutral" /> : null}
                        {row.reliability != null ? <span className="text-[11px] text-muted-foreground">{Math.round(row.reliability * 100)}%</span> : null}
                        {row.sourceUrl ? (
                          <a
                            href={row.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={t("isbn_intelligence.view_source")}
                            className="inline-flex items-center text-muted-foreground hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
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
            {sources.map((source) => <StatusBadge key={source.name} label={`${source.name}: ${source.status}`} variant={source.status === "SUCCESS" ? "success" : source.status === "DISABLED" || source.status === "SKIPPED" ? "neutral" : "warning"} />)}
          </div>
        </ReviewDisclosure>
      ) : null}
    </section>
  );
}
