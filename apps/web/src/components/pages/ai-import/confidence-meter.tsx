const TONE_FILL: Record<"indigo" | "violet" | "amber" | "neutral", string> = {
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  neutral: "bg-muted-foreground/50",
};

/** A short colored bar alongside the existing "NN%" text — ties every confidence/
 *  similarity/quality score in the review tab to one shared visual language instead
 *  of each being a bare, differently-worded number. Additive: pair with the existing
 *  percentage text, don't replace it. */
export function ConfidenceMeter({
  value,
  tone = "neutral",
  className = "",
}: {
  /** Raw 0..1 confidence/similarity score — same shape already used at every call site. */
  value: number;
  tone?: "indigo" | "violet" | "amber" | "neutral";
  className?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className={`inline-flex h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted align-middle ${className}`} aria-hidden="true">
      <span className={`h-full rounded-full ${TONE_FILL[tone]}`} style={{ width: `${pct}%` }} />
    </span>
  );
}
