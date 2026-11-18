import type { ComponentType } from "react";
import { AlertCircle, AlertOctagon, AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { OCR_READING_LABELS } from "@/lib/book-ocr";
import type { Anomaly, AnomalySeverity } from "@/services/book-ocr";

const SEVERITY_META: Record<AnomalySeverity, { label: string; icon: ComponentType<{ className?: string }>; tone: string }> = {
  CRITICAL: { label: "Nghiêm trọng", icon: ShieldAlert, tone: "danger" },
  HIGH: { label: "Cao", icon: AlertOctagon, tone: "danger" },
  MEDIUM: { label: "Trung bình", icon: AlertTriangle, tone: "warning" },
  LOW: { label: "Thấp", icon: AlertCircle, tone: "info" },
  INFO: { label: "Thông tin", icon: Info, tone: "neutral" },
};

const TONE_CARD: Record<string, string> = {
  danger: "border-red-200 bg-red-50/40 dark:border-red-500/25 dark:bg-red-500/[0.04]",
  warning: "border-amber-200 bg-amber-50/40 dark:border-amber-500/25 dark:bg-amber-500/[0.04]",
  info: "border-sky-200 bg-sky-50/40 dark:border-sky-500/25 dark:bg-sky-500/[0.04]",
  neutral: "border-border bg-card",
};

const TONE_BADGE: Record<string, string> = {
  danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
  neutral: "border-border bg-muted/60 text-muted-foreground",
};

const ANOMALY_TYPE_LABELS: Record<Anomaly["anomalyType"], string> = {
  ISBN_ANOMALY: "Bất thường ISBN",
  AUTHOR_TRANSLATOR_ANOMALY: "Bất thường tác giả / dịch giả",
  PUBLICATION_ANOMALY: "Bất thường thông tin xuất bản",
  PHYSICAL_METADATA_ANOMALY: "Bất thường thông tin vật lý",
  CROSS_SOURCE_ANOMALY: "Mâu thuẫn giữa các nguồn",
};

function fieldLabel(field: string): string {
  return OCR_READING_LABELS[field] || field;
}

function AnomalyCard({ anomaly }: { anomaly: Anomaly }) {
  const meta = SEVERITY_META[anomaly.severity];
  const Icon = meta.icon;
  return (
    <li className={`rounded-xl border p-3.5 ${TONE_CARD[meta.tone]}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium ${TONE_BADGE[meta.tone]}`}>
          <Icon className="h-3 w-3" aria-hidden="true" /> {meta.label}
        </span>
        <span className="text-[12px] font-medium text-foreground">{ANOMALY_TYPE_LABELS[anomaly.anomalyType]}</span>
        <span className="text-[11.5px] text-muted-foreground">· {anomaly.affectedFields.map(fieldLabel).join(", ")}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/90">{anomaly.explanation}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">Gợi ý xử lý: {anomaly.recommendedAction}</p>
    </li>
  );
}

/**
 * Feature B - rule-based anomaly summary for the AI Import review flow.
 * Every anomaly is explanatory only (never auto-applies/rejects a value):
 * the actual block-on-save decision already lives in unresolvedOcrFields
 * (apps/web/.../lib/book-ocr.ts), which this dashboard never duplicates -
 * it only makes the same underlying signals readable for a person.
 */
export function AnomalyDashboard({ anomalies }: { anomalies: Anomaly[] }) {
  if (!anomalies.length) return null;
  const counts = anomalies.reduce<Record<AnomalySeverity, number>>((acc, a) => {
    acc[a.severity] = (acc[a.severity] || 0) + 1;
    return acc;
  }, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 });
  const needsReview = anomalies.filter((a) => a.requiresHumanReview);
  const informational = anomalies.filter((a) => !a.requiresHumanReview);

  return (
    <section aria-label="Bất thường metadata phát hiện được" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[13px] font-semibold text-foreground">Bất thường phát hiện được ({anomalies.length})</h4>
        {(Object.entries(counts) as Array<[AnomalySeverity, number]>).filter(([, n]) => n > 0).map(([severity, n]) => {
          const meta = SEVERITY_META[severity];
          return (
            <span key={severity} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TONE_BADGE[meta.tone]}`}>
              {meta.label}: {n}
            </span>
          );
        })}
      </div>
      {needsReview.length ? (
        <ul className="space-y-2">{needsReview.map((anomaly, index) => <AnomalyCard key={index} anomaly={anomaly} />)}</ul>
      ) : null}
      {informational.length ? (
        <details className="text-[12px]">
          <summary className="inline-flex min-h-8 cursor-pointer items-center font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
            {informational.length} thông tin thêm (không cần xử lý)
          </summary>
          <ul className="mt-2 space-y-2">{informational.map((anomaly, index) => <AnomalyCard key={index} anomaly={anomaly} />)}</ul>
        </details>
      ) : null}
    </section>
  );
}
