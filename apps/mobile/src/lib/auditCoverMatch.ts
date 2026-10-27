import type { CoverSearchCandidate } from '../api/coverSearch';
import type { StockAuditLine } from '../types/stockAudit';

/** Below this the photo match is a guess: the confirm sheet says so and asks for a manual check. */
export const LOW_CONFIDENCE_THRESHOLD = 0.75;

export type AuditCoverMatch = {
  line: StockAuditLine;
  confidence: number;
  candidateTitle: string;
  evidence: string[];
  lowConfidence: boolean;
};

function digits(value: string | null | undefined): string {
  return String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

/**
 * Turns cover-search candidates (the whole catalog) into options the counter can pick
 * from: only lines that are on THIS audit sheet, one option per line — the same title on
 * two shelf locations is two lines, and only the person holding the book knows which
 * shelf it came from. Identity is the exact edition (variant_id) when the visual match
 * names one, else the ISBN. Nothing here writes a count: confirming is the user's call.
 */
export function matchCoverCandidatesToAudit(candidates: CoverSearchCandidate[], lines: StockAuditLine[]): AuditCoverMatch[] {
  const bestByLine = new Map<string, AuditCoverMatch>();
  for (const candidate of candidates) {
    const isbn = digits(candidate.isbn);
    const matchingLines = lines.filter((line) => {
      if (candidate.variant_id && line.variant_id === candidate.variant_id) return true;
      if (!isbn) return false;
      return digits(line.isbn13) === isbn || digits(line.isbn10) === isbn;
    });
    for (const line of matchingLines) {
      const confidence = Number.isFinite(candidate.confidence) ? Math.max(0, Math.min(1, candidate.confidence)) : 0;
      const existing = bestByLine.get(line.id);
      if (existing && existing.confidence >= confidence) continue;
      bestByLine.set(line.id, {
        line,
        confidence,
        candidateTitle: candidate.title,
        evidence: (candidate.evidence ?? []).map((item) => item.label).filter(Boolean),
        lowConfidence: confidence < LOW_CONFIDENCE_THRESHOLD,
      });
    }
  }
  return [...bestByLine.values()].sort((a, b) => b.confidence - a.confidence);
}

/** Count after one more copy, from the freshest known value of the line. */
export function nextCount(line: Pick<StockAuditLine, 'counted_qty'>): number {
  return (line.counted_qty ?? 0) + 1;
}
