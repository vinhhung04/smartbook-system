// Reports page figures for an account that reads the library's analytics
// (analytics.borrow.read) but not the circulation desk lists (borrow.*), e.g. a
// manager: the borrow-domain numbers come from /analytics/* - already limited to
// the caller's warehouse/branch scope - instead of being counted from loan rows.
// No reader-level list ever reaches this mode.
import type { BorrowTrendItem, FineSummary, OverdueSummary, TopBookItem } from '@/services/analytics';

export type BorrowAnalytics = {
  trend: BorrowTrendItem[];
  /** Same-length period before `trend`, null for "all data". */
  previousTrend: BorrowTrendItem[] | null;
  top: TopBookItem[];
  /** Snapshots (today), not tied to the selected period. */
  overdue: OverdueSummary | null;
  fines: FineSummary | null;
};

export type FineStatusRow = { status: 'UNPAID' | 'PAID' | 'WAIVED'; count: number | null; amount: number };

export function trendTotals(rows: BorrowTrendItem[] | null | undefined): { loans: number; returns: number } {
  return (rows || []).reduce(
    (sum, row) => ({ loans: sum.loans + Number(row.loans || 0), returns: sum.returns + Number(row.returns || 0) }),
    { loans: 0, returns: 0 },
  );
}

/** Fine amounts by status from /analytics/fine-summary (it carries no waived count). */
export function fineRowsFromSummary(fines: FineSummary | null | undefined): { rows: FineStatusRow[]; total: number } {
  if (!fines) return { rows: [], total: 0 };
  const rows: FineStatusRow[] = [
    { status: 'UNPAID' as const, count: Number(fines.unpaid_count || 0), amount: Number(fines.total_unpaid || 0) },
    { status: 'PAID' as const, count: Number(fines.paid_count || 0), amount: Number(fines.total_paid || 0) },
    { status: 'WAIVED' as const, count: null, amount: Number(fines.total_waived || 0) },
  ].filter((row) => row.amount > 0);
  return { rows, total: rows.reduce((sum, row) => sum + row.amount, 0) };
}

/** YYYY-MM-DD range params for the analytics endpoints (local "today" as `to`). */
export function periodParams(start: Date | null, end: Date = new Date()): { from: string; to: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { from: start ? day(start) : '2000-01-01', to: day(end) };
}
