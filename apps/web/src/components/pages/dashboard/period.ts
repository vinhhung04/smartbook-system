/** Analysis window for the borrow trend and the top-books ranking. Pure, so it is unit tested (tests/dashboard-period.test.mjs). */
export type Period = '30d' | '90d' | '12m';

export const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '30d', label: '30 ngày' },
  { value: '90d', label: '90 ngày' },
  { value: '12m', label: '12 tháng' },
];

/** Default view: the 12-month trend is the fullest picture of the library (the daily views are sparse in quiet weeks). */
export const DEFAULT_PERIOD: Period = '12m';

/** Query for /analytics/borrow-trends and /analytics/top-books. The 12-month view is bucketed by month. */
export function periodParams(period: Period, now: Date = new Date()) {
  if (period === '12m') {
    // Local midnight on the 1st, 11 months back: exactly 12 whole-month buckets including this one.
    const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return { from: from.toISOString(), granularity: 'month' as const };
  }
  const days = period === '90d' ? 90 : 30;
  return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), granularity: 'day' as const };
}

/** Short axis label: "23/10" for a day, "10/2026" for a month ("2026-10"). */
export function bucketLabel(date: string) {
  const [year, month, day] = date.split('-');
  if (day) return `${day.slice(0, 2)}/${month}`;
  return month ? `${month}/${year}` : date;
}

/** "Thứ Năm, 23/10/2026" for a day; "Tháng 10/2026" for a month. */
export function longBucketLabel(date: string) {
  if (/^\d{4}-\d{2}$/.test(date)) return `Tháng ${bucketLabel(date)}`;
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}
