import { useEffect, useState, useMemo, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, FileSpreadsheet, FileText, Minus, RefreshCw,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { PageWrapper, FadeItem } from '../motion-utils';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar } from '@/components/ui/filter-bar';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/loading-state';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { getPaginationRange } from '@/lib/pagination';
import { cn } from '@/components/ui/utils';
import { getStatusVariant } from '@/lib/status-registry';
import { borrowService, type Loan, type Fine } from '@/services/borrow';
import { bookService } from '@/services/book';
import { stockMovementService } from '@/services/stock-movement';
import { getApiErrorMessage } from '@/services/api';
import { exportToCsv, exportToPdf, exportSummaryReport, type ExportColumn } from '@/lib/export-utils';
import { toast } from 'sonner';

type DateRange = '7d' | '30d' | '90d' | 'all';

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
  { value: '90d', label: '90 ngày' },
  { value: 'all', label: 'Tất cả' },
];

const RANGE_DAYS: Record<Exclude<DateRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

const LOAN_STATUS_LABELS: Record<string, string> = {
  RESERVED: 'Đã đặt trước',
  BORROWED: 'Đang mượn',
  RETURNED: 'Đã trả',
  OVERDUE: 'Quá hạn',
  LOST: 'Mất sách',
  DAMAGED: 'Hư hỏng',
  CANCELLED: 'Đã hủy',
};

const FINE_STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Chưa trả',
  PARTIALLY_PAID: 'Trả một phần',
  PAID: 'Đã trả',
  WAIVED: 'Đã miễn',
};

// Same emerald/amber/rose/slate vocabulary StatusBadge uses for fine statuses (status-registry 'fine').
const FINE_STATUS_COLORS: Record<string, string> = {
  UNPAID: '#f43f5e',
  PARTIALLY_PAID: '#f59e0b',
  PAID: '#10b981',
  WAIVED: '#94a3b8',
};
const FINE_STATUS_ORDER = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED'];

const LOAN_COLOR = '#6366f1';
const INBOUND_COLOR = '#10b981';
const OUTBOUND_COLOR = '#f43f5e';
const GRID_STROKE = 'rgba(148, 163, 184, 0.22)';

const TABLE_PAGE_SIZE = 10;
const FETCH_PAGE_SIZE = 100;
const FETCH_MAX_PAGES = 20;
const DAY_MS = 86_400_000;

function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function formatCurrency(value: number): string {
  return `${Math.round(value).toLocaleString('vi-VN')} ₫`;
}

function formatShare(part: number, total: number): string {
  if (!total || part <= 0) return '0%';
  const pct = (part / total) * 100;
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`;
}

function formatAxisDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
}

function formatCellDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('vi-VN');
}

function isoDay(value: string | Date): string {
  return (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
}

/**
 * Continuous day (or week, for long spans) buckets from `start` to today, so days
 * with no activity plot as zero instead of vanishing and bridging their neighbours.
 */
function buildBuckets(start: Date): { keys: string[]; bucketOf: (day: string) => string; unit: 'day' | 'week' } {
  const end = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const first = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const spanDays = Math.max(1, Math.round((end - first) / DAY_MS) + 1);
  const unit = spanDays > 92 ? 'week' : 'day';
  const step = unit === 'week' ? 7 : 1;
  const keys: string[] = [];
  for (let t = first; t <= end; t += step * DAY_MS) keys.push(isoDay(new Date(t)));
  const bucketOf = (day: string) => {
    if (unit === 'day') return day;
    const offset = Math.floor((Date.parse(`${day}T00:00:00Z`) - first) / (7 * DAY_MS));
    return keys[Math.min(keys.length - 1, Math.max(0, offset))];
  };
  return { keys, bucketOf, unit };
}

/**
 * The loan/fine list endpoints cap pageSize at 100 server-side, so page through them.
 * The page cap keeps the report responsive; `truncated` lets the UI say so instead of
 * silently reporting a clipped total.
 */
async function fetchAllPages<T>(
  fetcher: (params: { page: number; pageSize: number }) => Promise<{ data: T[]; meta?: { totalPages?: number } }>,
): Promise<{ rows: T[]; truncated: boolean }> {
  let rows: T[] = [];
  for (let page = 1; page <= FETCH_MAX_PAGES; page++) {
    const res = await fetcher({ page, pageSize: FETCH_PAGE_SIZE });
    const batch = res.data ?? [];
    rows = rows.concat(batch);
    const totalPages = res.meta?.totalPages ?? 1;
    if (page >= totalPages || batch.length < FETCH_PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

type Period = { days: number; start: Date; prevStart: Date } | null;

function inPeriod(period: Period, value: string): boolean {
  return !period || new Date(value) >= period.start;
}

function inPrevPeriod(period: Period, value: string): boolean {
  if (!period) return false;
  const d = new Date(value);
  return d >= period.prevStart && d < period.start;
}

type Delta = { text: string; direction: 'up' | 'down' | 'flat'; good: boolean | null };

function percentDelta(current: number, previous: number, higherIsGood: boolean): Delta | null {
  if (previous === 0) return current === 0 ? { text: 'Không đổi', direction: 'flat', good: null } : null;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { text: 'Không đổi', direction: 'flat', good: null };
  const up = change > 0;
  return { text: `${up ? '+' : '−'}${Math.abs(change).toFixed(Math.abs(change) < 10 ? 1 : 0)}%`, direction: up ? 'up' : 'down', good: up === higherIsGood };
}

function pointDelta(current: number, previous: number, higherIsGood: boolean): Delta {
  const change = current - previous;
  if (Math.abs(change) < 0.5) return { text: 'Không đổi', direction: 'flat', good: null };
  const up = change > 0;
  return { text: `${up ? '+' : '−'}${Math.abs(change).toFixed(0)} điểm`, direction: up ? 'up' : 'down', good: up === higherIsGood };
}

function Metric({ label, value, detail, delta, compareLabel }: {
  label: string;
  value: string;
  detail?: ReactNode;
  delta?: Delta | null;
  compareLabel?: string;
}) {
  const Icon = delta?.direction === 'up' ? ArrowUpRight : delta?.direction === 'down' ? ArrowDownRight : Minus;
  return (
    <div className="min-w-0 px-5 py-4">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 text-[28px] font-semibold leading-none tracking-tight text-foreground">{value}</dd>
      {delta ? (
        <p className="mt-2 flex items-center gap-1 text-[12px]">
          <span className={cn(
            'inline-flex items-center gap-0.5 font-semibold',
            delta.good === null ? 'text-muted-foreground' : delta.good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
          )}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {delta.text}
          </span>
          <span className="text-muted-foreground">{compareLabel}</span>
        </p>
      ) : null}
      {detail ? <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function Panel({ title, summary, legend, className, children }: {
  title: string;
  summary?: ReactNode;
  legend?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-card p-5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
          {summary ? <p className="mt-1 text-[13px] text-muted-foreground">{summary}</p> : null}
        </div>
        {legend}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} aria-hidden="true" />
      {label}
    </span>
  );
}

function ChartTooltip({ active, payload, label, unit }: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string;
  unit: 'day' | 'week';
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12px] shadow-[0_6px_16px_-6px_rgba(15,23,42,0.25)]">
      <p className="mb-1 font-medium text-foreground">{unit === 'week' ? `Tuần từ ${formatAxisDate(label || '')}` : formatAxisDate(label || '')}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center justify-between gap-4 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} aria-hidden="true" />
            {entry.name}
          </span>
          <span className="font-semibold tabular-nums text-foreground">{Math.abs(Number(entry.value || 0)).toLocaleString('vi-VN')}</span>
        </p>
      ))}
    </div>
  );
}

const axisTick = { fontSize: 11, fill: '#94a3b8' };

export function ReportsPage() {
  const [range, setRange] = useState<DateRange>('30d');
  const [loading, setLoading] = useState(true);
  const [borrowDenied, setBorrowDenied] = useState(false);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [truncated, setTruncated] = useState<{ loans: boolean; fines: boolean }>({ loans: false, fines: false });
  const [books, setBooks] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [detailTab, setDetailTab] = useState<'loans' | 'fines'>('loans');
  const [loansPage, setLoansPage] = useState(1);
  const [finesPage, setFinesPage] = useState(1);
  const [loanQuery, setLoanQuery] = useState('');
  const [fineQuery, setFineQuery] = useState('');
  const [variantTitles, setVariantTitles] = useState<Record<string, string>>({});

  const loadData = async () => {
    try {
      setLoading(true);
      const [loanResp, fineResp, bookResp, movResp] = await Promise.allSettled([
        fetchAllPages<Loan>((p) => borrowService.getLoans(p)),
        fetchAllPages<Fine>((p) => borrowService.getFines(p)),
        bookService.getAll(),
        stockMovementService.getAll({ pageSize: 500 }),
      ]);

      if (loanResp.status === 'fulfilled') {
        setLoans(loanResp.value.rows);
      } else if (loanResp.reason?.response?.status === 403) {
        // Role has no borrow-domain access (e.g. warehouse manager): hide borrow widgets instead of showing zeros.
        setBorrowDenied(true);
      } else {
        console.error('[Reports] Loans failed:', loanResp.reason);
        toast.error('Không tải được dữ liệu mượn/trả: ' + (loanResp.reason?.response?.data?.message || loanResp.reason?.message || 'Lỗi không xác định'));
      }
      if (fineResp.status === 'fulfilled') {
        setFines(fineResp.value.rows);
      } else {
        console.error('[Reports] Fines failed:', fineResp.reason);
      }
      setTruncated({
        loans: loanResp.status === 'fulfilled' && loanResp.value.truncated,
        fines: fineResp.status === 'fulfilled' && fineResp.value.truncated,
      });
      if (bookResp.status === 'fulfilled') {
        setBooks(Array.isArray(bookResp.value) ? bookResp.value : []);
      }
      if (movResp.status === 'fulfilled') {
        setMovements(Array.isArray(movResp.value) ? movResp.value : []);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Không thể tải dữ liệu báo cáo'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadData(); }, []);
  useEffect(() => { setLoansPage(1); setFinesPage(1); }, [range]);
  useEffect(() => { setLoansPage(1); }, [loanQuery]);
  useEffect(() => { setFinesPage(1); }, [fineQuery]);

  const period = useMemo<Period>(() => {
    if (range === 'all') return null;
    const days = RANGE_DAYS[range];
    const end = Date.now();
    return { days, start: new Date(end - days * DAY_MS), prevStart: new Date(end - 2 * days * DAY_MS) };
  }, [range]);

  const periodLabel = useMemo(() => {
    if (!period) return 'Toàn bộ dữ liệu';
    return `${period.start.toLocaleDateString('vi-VN')} – ${new Date().toLocaleDateString('vi-VN')}`;
  }, [period]);

  const filteredLoans = useMemo(() => loans.filter((l) => inPeriod(period, l.created_at)), [loans, period]);
  const filteredFines = useMemo(() => fines.filter((f) => inPeriod(period, f.issued_at)), [fines, period]);
  const filteredMovements = useMemo(() => movements.filter((m: any) => inPeriod(period, m.created_at)), [movements, period]);

  // A truncated fetch keeps only the newest records, which undercounts the previous period — so no comparison then.
  const canCompare = Boolean(period) && !truncated.loans && !truncated.fines;
  const compareLabel = period ? `so với ${period.days} ngày trước` : undefined;

  const kpi = useMemo(() => {
    const summarize = (loanRows: Loan[], fineRows: Fine[]) => {
      const total = loanRows.length;
      const returned = loanRows.filter((l) => l.status === 'RETURNED').length;
      const overdue = loanRows.filter((l) => l.status === 'OVERDUE').length;
      const fineAmount = fineRows.reduce((s, f) => s + Number(f.amount || 0), 0);
      const settledAmount = fineRows.filter((f) => f.status === 'PAID' || f.status === 'WAIVED').reduce((s, f) => s + Number(f.amount || 0), 0);
      return { total, returned, overdue, returnRate: total ? (returned / total) * 100 : 0, fineAmount, settledAmount };
    };
    const current = summarize(filteredLoans, filteredFines);
    const previous = summarize(
      loans.filter((l) => inPrevPeriod(period, l.created_at)),
      fines.filter((f) => inPrevPeriod(period, f.issued_at)),
    );
    return { current, previous };
  }, [filteredLoans, filteredFines, loans, fines, period]);

  const buckets = useMemo(() => {
    if (period) return buildBuckets(period.start);
    const dates = [...filteredLoans.map((l) => l.created_at), ...filteredMovements.map((m: any) => m.created_at)].filter(Boolean).sort();
    return buildBuckets(dates.length ? new Date(dates[0]) : new Date());
  }, [period, filteredLoans, filteredMovements]);

  const borrowTrend = useMemo(() => {
    const counts = new Map(buckets.keys.map((k) => [k, 0]));
    for (const loan of filteredLoans) {
      const key = buckets.bucketOf(isoDay(loan.created_at));
      if (counts.has(key)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    const data = buckets.keys.map((date) => ({ date, count: counts.get(date) || 0 }));
    const peak = data.reduce((best, row) => (row.count > best.count ? row : best), { date: '', count: 0 });
    const average = data.length ? filteredLoans.length / data.length : 0;
    return { data, peak, average };
  }, [buckets, filteredLoans]);

  const movementTrend = useMemo(() => {
    const inMap = new Map(buckets.keys.map((k) => [k, 0]));
    const outMap = new Map(buckets.keys.map((k) => [k, 0]));
    let totalIn = 0;
    let totalOut = 0;
    for (const m of filteredMovements) {
      if (!m.created_at) continue;
      const key = buckets.bucketOf(isoDay(m.created_at));
      const qty = Number(m.quantity || 0);
      if (m.movement_type === 'INBOUND' && inMap.has(key)) { inMap.set(key, (inMap.get(key) || 0) + qty); totalIn += qty; }
      if (m.movement_type === 'OUTBOUND' && outMap.has(key)) { outMap.set(key, (outMap.get(key) || 0) + qty); totalOut += qty; }
    }
    const data = buckets.keys.map((date) => ({ date, inbound: inMap.get(date) || 0, outbound: -(outMap.get(date) || 0) }));
    return { data, totalIn, totalOut, hasAny: totalIn + totalOut > 0 };
  }, [buckets, filteredMovements]);

  // Counts by variant_id when loan_items are present; falls back to counting by loan
  // (labeled with the loan number) only for loans that carry no line-item detail.
  const topBooksCounts = useMemo(() => {
    const countMap = new Map<string, { key: string; label: string; count: number; isVariant: boolean }>();
    for (const loan of filteredLoans) {
      if (loan.loan_items && loan.loan_items.length > 0) {
        for (const item of loan.loan_items) {
          const existing = countMap.get(item.variant_id);
          if (existing) existing.count++;
          else countMap.set(item.variant_id, { key: item.variant_id, label: item.variant_id, count: 1, isVariant: true });
        }
      } else {
        const existing = countMap.get(loan.id);
        if (existing) existing.count++;
        else countMap.set(loan.id, { key: loan.id, label: loan.loan_number || loan.id.slice(0, 8), count: 1, isVariant: false });
      }
    }
    return Array.from(countMap.values()).sort((a, b) => b.count - a.count).slice(0, 8);
  }, [filteredLoans]);

  // Resolves the top variant_ids to real book titles — nothing else in the loan payload carries a title.
  useEffect(() => {
    const ids = topBooksCounts.filter((b) => b.isVariant && !variantTitles[b.key]).map((b) => b.key);
    if (ids.length === 0) return;
    borrowService.getVariantDetails({ ids: ids.join(',') })
      .then((res) => {
        const map: Record<string, string> = {};
        for (const v of res.data || []) map[v.id] = v.title;
        setVariantTitles((prev) => ({ ...prev, ...map }));
      })
      .catch(() => {});
  }, [topBooksCounts, variantTitles]);

  const topBooks = useMemo(
    () => topBooksCounts.map((b) => ({ key: b.key, title: b.isVariant ? variantTitles[b.key] : b.label, count: b.count })),
    [topBooksCounts, variantTitles],
  );

  const fineBreakdown = useMemo(() => {
    const rows = FINE_STATUS_ORDER.map((status) => {
      const items = filteredFines.filter((f) => f.status === status);
      return { status, count: items.length, amount: items.reduce((s, f) => s + Number(f.amount || 0), 0) };
    }).filter((row) => row.count > 0);
    const total = rows.reduce((s, row) => s + row.amount, 0);
    return { rows, total };
  }, [filteredFines]);

  const searchedLoans = useMemo(() => {
    const q = loanQuery.trim().toLowerCase();
    if (!q) return filteredLoans;
    return filteredLoans.filter((l) =>
      l.loan_number?.toLowerCase().includes(q) || (l.customers?.full_name || l.customer_id || '').toLowerCase().includes(q));
  }, [filteredLoans, loanQuery]);

  const searchedFines = useMemo(() => {
    const q = fineQuery.trim().toLowerCase();
    if (!q) return filteredFines;
    return filteredFines.filter((f) => (f.customers?.full_name || f.customer_id || '').toLowerCase().includes(q));
  }, [filteredFines, fineQuery]);

  const loansTotalPages = Math.max(1, Math.ceil(searchedLoans.length / TABLE_PAGE_SIZE));
  const loansCurrentPage = Math.min(loansPage, loansTotalPages);
  const pagedLoans = searchedLoans.slice((loansCurrentPage - 1) * TABLE_PAGE_SIZE, loansCurrentPage * TABLE_PAGE_SIZE);

  const finesTotalPages = Math.max(1, Math.ceil(searchedFines.length / TABLE_PAGE_SIZE));
  const finesCurrentPage = Math.min(finesPage, finesTotalPages);
  const pagedFines = searchedFines.slice((finesCurrentPage - 1) * TABLE_PAGE_SIZE, finesCurrentPage * TABLE_PAGE_SIZE);

  const loanColumns: ExportColumn[] = [
    { header: 'Mã phiếu', key: 'loan_number', width: 18 },
    { header: 'Khách hàng', key: 'customer_name', width: 22 },
    { header: 'Ngày mượn', key: 'borrow_date', width: 14 },
    { header: 'Hạn trả', key: 'due_date', width: 14 },
    { header: 'Trạng thái', key: 'status', width: 12 },
    { header: 'Số lượng', key: 'total_items', width: 10 },
  ];

  const fineColumns: ExportColumn[] = [
    { header: 'Khách hàng', key: 'customer_name', width: 22 },
    { header: 'Loại phạt', key: 'fine_type', width: 16 },
    { header: 'Số tiền', key: 'amount', width: 14 },
    { header: 'Trạng thái', key: 'status', width: 12 },
    { header: 'Ngày phạt', key: 'issued_at', width: 14 },
  ];

  const prepareLoanExportData = (data: Loan[] = filteredLoans) =>
    data.map((l) => ({
      loan_number: l.loan_number,
      customer_name: l.customers?.full_name || l.customer_id,
      borrow_date: l.borrow_date?.slice(0, 10) || '',
      due_date: l.due_date?.slice(0, 10) || '',
      status: LOAN_STATUS_LABELS[l.status] || l.status,
      total_items: l.total_items,
    }));

  const prepareFineExportData = (data: Fine[] = filteredFines) =>
    data.map((f) => ({
      customer_name: f.customers?.full_name || f.customer_id,
      fine_type: f.fine_type,
      amount: f.amount,
      status: FINE_STATUS_LABELS[f.status] || f.status,
      issued_at: f.issued_at?.slice(0, 10) || '',
    }));

  const handleExportCsv = () => {
    if (detailTab === 'loans') {
      exportToCsv(prepareLoanExportData(searchedLoans), loanColumns, `bao-cao-muon-tra-${range}`);
      toast.success('Đã xuất file CSV báo cáo mượn/trả');
    } else {
      exportToCsv(prepareFineExportData(searchedFines), fineColumns, `bao-cao-phat-${range}`);
      toast.success('Đã xuất file CSV báo cáo phạt');
    }
  };

  const handleExportPdf = () => {
    if (detailTab === 'loans') {
      exportToPdf(prepareLoanExportData(searchedLoans), loanColumns, 'Báo cáo Mượn/Trả Sách', `bao-cao-muon-tra-${range}`);
      toast.success('Đã xuất file PDF báo cáo mượn/trả');
    } else {
      exportToPdf(prepareFineExportData(searchedFines), fineColumns, 'Báo cáo Phạt', `bao-cao-phat-${range}`);
      toast.success('Đã xuất file PDF báo cáo phạt');
    }
  };

  const handleExportSummaryReport = () => {
    const paidFines = filteredFines.filter((f) => f.status === 'PAID').length;
    exportSummaryReport({
      title: 'Báo cáo Tổng hợp Thư viện SmartBook',
      dateRange: `Khoảng thời gian: ${periodLabel}`,
      kpis: [
        { label: 'Tổng đầu sách', value: books.length },
        { label: 'Phiếu mượn', value: kpi.current.total },
        { label: 'Quá hạn', value: kpi.current.overdue },
        { label: 'Đã trả', value: kpi.current.returned },
        { label: 'Tổng phạt', value: `${kpi.current.fineAmount.toLocaleString('vi-VN')}đ` },
        { label: 'Đã thu phạt', value: `${paidFines}/${filteredFines.length}` },
        { label: 'Biến động kho', value: filteredMovements.length },
      ],
      sections: [
        { title: 'Mượn/Trả gần đây', columns: loanColumns, data: prepareLoanExportData() },
        { title: 'Phạt gần đây', columns: fineColumns, data: prepareFineExportData() },
      ],
    });
    toast.success('Đã xuất báo cáo tổng hợp PDF');
  };

  const renderTablePagination = (currentPage: number, totalPages: number, onChange: (page: number) => void) => {
    if (totalPages <= 1) return null;
    return (
      <div className="flex justify-end border-t border-border px-5 py-3">
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={(event) => { event.preventDefault(); onChange(Math.max(1, currentPage - 1)); }}
                className={cn('cursor-pointer', currentPage === 1 && 'pointer-events-none opacity-50')}
              />
            </PaginationItem>
            {getPaginationRange(currentPage, totalPages).map((item, i) => (
              <PaginationItem key={typeof item === 'number' ? item : `${item}-${i}`}>
                {typeof item === 'number' ? (
                  <PaginationLink
                    isActive={item === currentPage}
                    onClick={(event) => { event.preventDefault(); onChange(item); }}
                    className="cursor-pointer"
                  >
                    {item}
                  </PaginationLink>
                ) : (
                  <PaginationEllipsis />
                )}
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                onClick={(event) => { event.preventDefault(); onChange(Math.min(totalPages, currentPage + 1)); }}
                className={cn('cursor-pointer', currentPage === totalPages && 'pointer-events-none opacity-50')}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    );
  };

  const { current, previous } = kpi;
  const unitLabel = buckets.unit === 'week' ? 'tuần' : 'ngày';
  const topMax = topBooks[0]?.count || 1;
  const outstanding = fineBreakdown.rows.filter((r) => r.status === 'UNPAID' || r.status === 'PARTIALLY_PAID').reduce((s, r) => s + r.amount, 0);
  const truncatedNote = truncated.loans || truncated.fines
    ? `Chỉ tải được ${(FETCH_PAGE_SIZE * FETCH_MAX_PAGES).toLocaleString('vi-VN')} ${truncated.loans ? 'phiếu mượn' : 'khoản phạt'} mới nhất — số liệu có thể thấp hơn thực tế và không so sánh được với kỳ trước.`
    : null;

  return (
    <PageWrapper className="space-y-8">
      <FadeItem>
        <PageHeader
          icon={BarChart3}
          title="Báo cáo & thống kê"
          description={period ? `${periodLabel} · ${compareLabel}` : periodLabel}
          iconBg="bg-indigo-100 dark:bg-indigo-500/15"
          iconColor="text-indigo-600 dark:text-indigo-400"
          className="sm:flex-col lg:flex-row"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <div className="max-w-full overflow-x-auto">
                <SegmentedControl options={DATE_RANGE_OPTIONS} value={range} onChange={setRange} layoutId="reports-range" className="w-max" />
              </div>
              <Button size="sm" onClick={handleExportSummaryReport} disabled={loading}>
                <FileText className="h-3.5 w-3.5" />
                Báo cáo tổng hợp
              </Button>
              <Button size="sm" variant="outline" onClick={() => void loadData()} disabled={loading} aria-label="Tải lại dữ liệu">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
          }
        />
      </FadeItem>

      <FadeItem>
        <section aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="sr-only">Tóm tắt kỳ báo cáo</h2>
          {truncatedNote ? (
            <p className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[13px] text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              {truncatedNote}
            </p>
          ) : null}
          <div className="rounded-xl border border-border bg-card">
            {loading ? (
              <div className="p-5"><Skeleton className="h-[76px] w-full" /></div>
            ) : borrowDenied ? (
              <dl className="grid grid-cols-1">
                <Metric label="Đầu sách trong catalog" value={books.length.toLocaleString('vi-VN')} detail="Số liệu mượn/trả và phạt không khả dụng với vai trò của bạn." />
              </dl>
            ) : (
              <dl className="grid grid-cols-2 lg:grid-cols-4 [&>*]:border-border [&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t lg:[&>*:nth-child(3)]:border-l lg:[&>*:nth-child(n+3)]:border-t-0">
                <Metric
                  label="Lượt mượn"
                  value={current.total.toLocaleString('vi-VN')}
                  delta={canCompare ? percentDelta(current.total, previous.total, true) : null}
                  compareLabel={compareLabel}
                  detail={`Trung bình ${borrowTrend.average.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} lượt/${unitLabel}`}
                />
                <Metric
                  label="Tỷ lệ đã trả"
                  value={`${Math.round(current.returnRate)}%`}
                  delta={canCompare && previous.total > 0 ? pointDelta(current.returnRate, previous.returnRate, true) : null}
                  compareLabel={compareLabel}
                  detail={`${current.returned.toLocaleString('vi-VN')} / ${current.total.toLocaleString('vi-VN')} phiếu mượn trong kỳ`}
                />
                <Metric
                  label="Phiếu quá hạn"
                  value={current.overdue.toLocaleString('vi-VN')}
                  delta={canCompare ? percentDelta(current.overdue, previous.overdue, false) : null}
                  compareLabel={compareLabel}
                  detail={current.total ? `${((current.overdue / current.total) * 100).toFixed(1)}% số phiếu mượn trong kỳ` : undefined}
                />
                <Metric
                  label="Tiền phạt phát sinh"
                  value={formatCompactCurrency(current.fineAmount)}
                  delta={canCompare ? percentDelta(current.fineAmount, previous.fineAmount, false) : null}
                  compareLabel={compareLabel}
                  detail={current.fineAmount ? `Đã tất toán ${formatShare(current.settledAmount, current.fineAmount)} · ${formatCurrency(current.fineAmount)}` : undefined}
                />
              </dl>
            )}
          </div>
        </section>
      </FadeItem>

      <FadeItem>
        <section aria-labelledby="activity-heading" className="space-y-3">
          <h2 id="activity-heading" className="text-[16px] font-semibold text-foreground">Hoạt động theo {unitLabel}</h2>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {!borrowDenied && (
              <Panel
                title="Lượt mượn"
                summary={loading ? undefined : borrowTrend.peak.count > 0
                  ? <>Cao nhất <span className="font-semibold text-foreground">{borrowTrend.peak.count.toLocaleString('vi-VN')}</span> lượt {buckets.unit === 'week' ? 'tuần từ' : 'ngày'} {formatAxisDate(borrowTrend.peak.date)} · trung bình {borrowTrend.average.toLocaleString('vi-VN', { maximumFractionDigits: 1 })}/{unitLabel}</>
                  : 'Chưa có lượt mượn trong kỳ'}
              >
                {loading ? (
                  <Skeleton className="h-[240px] w-full" />
                ) : filteredLoans.length === 0 ? (
                  <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Không có lượt mượn trong khoảng thời gian này." />
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={borrowTrend.data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
                      <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                      <XAxis dataKey="date" tickFormatter={formatAxisDate} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                      <YAxis tick={axisTick} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
                      <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} content={<ChartTooltip unit={buckets.unit} />} />
                      <Bar dataKey="count" name="Lượt mượn" fill={LOAN_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Panel>
            )}

            <Panel
              title="Luồng kho"
              summary={loading ? undefined : movementTrend.hasAny
                ? <>Nhập <span className="font-semibold text-foreground">{movementTrend.totalIn.toLocaleString('vi-VN')}</span> · Xuất <span className="font-semibold text-foreground">{movementTrend.totalOut.toLocaleString('vi-VN')}</span> · Chênh lệch <span className="font-semibold text-foreground">{(movementTrend.totalIn - movementTrend.totalOut).toLocaleString('vi-VN', { signDisplay: 'exceptZero' })}</span> cuốn</>
                : `${books.length.toLocaleString('vi-VN')} đầu sách trong catalog`}
              legend={<div className="flex items-center gap-4"><LegendItem color={INBOUND_COLOR} label="Nhập" /><LegendItem color={OUTBOUND_COLOR} label="Xuất" /></div>}
            >
              {loading ? (
                <Skeleton className="h-[240px] w-full" />
              ) : !movementTrend.hasAny ? (
                <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Không có biến động kho trong khoảng thời gian này." />
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={movementTrend.data} stackOffset="sign" margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={2}>
                    <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={formatAxisDate} tick={axisTick} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tick={axisTick} axisLine={false} tickLine={false} width={36} allowDecimals={false} tickFormatter={(v: number) => Math.abs(v).toLocaleString('vi-VN')} />
                    <Tooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} content={<ChartTooltip unit={buckets.unit} />} />
                    <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1} />
                    <Bar dataKey="inbound" name="Nhập" stackId="flow" fill={INBOUND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="outbound" name="Xuất" stackId="flow" fill={OUTBOUND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>
        </section>
      </FadeItem>

      {!borrowDenied && (
        <FadeItem>
          <section aria-labelledby="books-fines-heading" className="space-y-3">
            <h2 id="books-fines-heading" className="text-[16px] font-semibold text-foreground">Sách & tiền phạt</h2>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
              <Panel title="Sách được mượn nhiều nhất" summary="Xếp hạng theo lượt mượn trong kỳ" className="xl:col-span-3">
                {loading ? (
                  <Skeleton className="h-[260px] w-full" />
                ) : topBooks.length === 0 ? (
                  <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Chưa có lượt mượn để thống kê." />
                ) : (
                  <ol className="space-y-3">
                    {topBooks.map((book, index) => (
                      <li key={book.key} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
                        <span className="text-[12px] font-semibold tabular-nums text-muted-foreground">{index + 1}</span>
                        <span className="truncate text-[13px] font-medium text-foreground" title={book.title}>
                          {book.title ?? <span className="text-muted-foreground">Đang tải tên sách…</span>}
                        </span>
                        <span className="text-[13px] font-semibold tabular-nums text-foreground">{book.count.toLocaleString('vi-VN')}</span>
                        <span className="col-start-2 col-end-4 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                          <span className="block h-full rounded-full" style={{ width: `${(book.count / topMax) * 100}%`, background: LOAN_COLOR }} />
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>

              <Panel
                title="Tiền phạt theo trạng thái"
                summary={loading || fineBreakdown.total === 0 ? undefined : <>Còn phải thu <span className="font-semibold text-foreground">{formatCurrency(outstanding)}</span></>}
                className="xl:col-span-2"
              >
                {loading ? (
                  <Skeleton className="h-[260px] w-full" />
                ) : fineBreakdown.rows.length === 0 ? (
                  <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Không có khoản phạt trong khoảng thời gian này." />
                ) : (
                  <>
                    <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label="Tỷ trọng tiền phạt theo trạng thái">
                      {fineBreakdown.rows.map((row) => (
                        <span
                          key={row.status}
                          className="h-full first:rounded-l-full last:rounded-r-full"
                          style={{ width: `${(row.amount / fineBreakdown.total) * 100}%`, minWidth: row.amount > 0 ? 4 : 0, background: FINE_STATUS_COLORS[row.status] }}
                          title={`${FINE_STATUS_LABELS[row.status]}: ${formatCurrency(row.amount)}`}
                        />
                      ))}
                    </div>
                    <table className="mt-5 w-full text-[13px]">
                      <thead className="sr-only">
                        <tr><th>Trạng thái</th><th>Số khoản</th><th>Số tiền</th><th>Tỷ trọng</th></tr>
                      </thead>
                      <tbody>
                        {fineBreakdown.rows.map((row) => (
                          <tr key={row.status} className="border-b border-border last:border-0">
                            <td className="py-2.5">
                              <span className="inline-flex items-center gap-2 text-foreground">
                                <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: FINE_STATUS_COLORS[row.status] }} aria-hidden="true" />
                                {FINE_STATUS_LABELS[row.status] || row.status}
                              </span>
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-muted-foreground">{row.count.toLocaleString('vi-VN')} khoản</td>
                            <td className="py-2.5 pl-4 text-right font-semibold tabular-nums text-foreground">{formatCompactCurrency(row.amount)}</td>
                            <td className="w-12 py-2.5 text-right tabular-nums text-muted-foreground">{formatShare(row.amount, fineBreakdown.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </Panel>
            </div>
          </section>
        </FadeItem>
      )}

      {!borrowDenied && (
        <FadeItem>
          <section aria-labelledby="detail-heading" className="space-y-3">
            <h2 id="detail-heading" className="text-[16px] font-semibold text-foreground">Chi tiết</h2>
            <Tabs value={detailTab} onValueChange={(value) => setDetailTab(value as 'loans' | 'fines')} className="gap-0 overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
                <TabsList className="h-9">
                  <TabsTrigger value="loans" className="px-3 text-[13px]">
                    Phiếu mượn <span className="ml-1 tabular-nums text-muted-foreground">{searchedLoans.length.toLocaleString('vi-VN')}</span>
                  </TabsTrigger>
                  <TabsTrigger value="fines" className="px-3 text-[13px]">
                    Khoản phạt <span className="ml-1 tabular-nums text-muted-foreground">{searchedFines.length.toLocaleString('vi-VN')}</span>
                  </TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={loading}>
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Xuất CSV
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleExportPdf} disabled={loading}>
                    <FileText className="h-3.5 w-3.5" /> Xuất PDF
                  </Button>
                </div>
              </div>

              <TabsContent value="loans" className="mt-0">
                {loading ? (
                  <div className="p-5"><Skeleton className="h-[200px] w-full" /></div>
                ) : filteredLoans.length === 0 ? (
                  <div className="p-5"><EmptyState variant="no-data" title="Không có phiếu mượn" description="Chưa có dữ liệu mượn/trả trong khoảng thời gian này." /></div>
                ) : (
                  <>
                    <div className="border-b border-border px-5 py-3">
                      <FilterBar searchValue={loanQuery} onSearchChange={setLoanQuery} searchPlaceholder="Tìm theo mã phiếu hoặc tên khách hàng..." />
                    </div>
                    {searchedLoans.length === 0 ? (
                      <EmptyState variant="no-results" title="Không tìm thấy phiếu mượn" description="Thử một mã phiếu hoặc tên khách hàng khác." />
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-border bg-muted/30">
                                {[
                                  { label: 'Phiếu mượn', className: '' },
                                  { label: 'Ngày mượn', className: 'hidden md:table-cell' },
                                  { label: 'Hạn trả', className: 'hidden sm:table-cell' },
                                  { label: 'Trạng thái', className: '' },
                                  { label: 'Số cuốn', className: 'hidden sm:table-cell text-right' },
                                ].map((h) => (
                                  <th key={h.label} className={cn('px-5 py-2.5 text-left text-[12px] font-medium text-muted-foreground', h.className)}>{h.label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {pagedLoans.map((loan) => (
                                <tr key={loan.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/40">
                                  <td className="px-5 py-3">
                                    <p className="font-mono text-[13px] font-medium">{loan.loan_number}</p>
                                    <p className="max-w-[240px] truncate text-[12px] text-muted-foreground">{loan.customers?.full_name || loan.customer_id?.slice(0, 8)}</p>
                                  </td>
                                  <td className="hidden px-5 py-3 text-[13px] tabular-nums text-muted-foreground md:table-cell">{formatCellDate(loan.borrow_date)}</td>
                                  <td className={cn('hidden px-5 py-3 text-[13px] tabular-nums sm:table-cell', loan.status === 'OVERDUE' ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-muted-foreground')}>{formatCellDate(loan.due_date)}</td>
                                  <td className="px-5 py-3">
                                    <StatusBadge label={LOAN_STATUS_LABELS[loan.status] || loan.status} variant={getStatusVariant('loan', loan.status)} dot />
                                  </td>
                                  <td className="hidden px-5 py-3 text-right text-[13px] font-medium tabular-nums sm:table-cell">{loan.total_items}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {renderTablePagination(loansCurrentPage, loansTotalPages, setLoansPage)}
                      </>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="fines" className="mt-0">
                {loading ? (
                  <div className="p-5"><Skeleton className="h-[200px] w-full" /></div>
                ) : filteredFines.length === 0 ? (
                  <div className="p-5"><EmptyState variant="no-data" title="Không có khoản phạt" description="Chưa có dữ liệu phạt trong khoảng thời gian này." /></div>
                ) : (
                  <>
                    <div className="border-b border-border px-5 py-3">
                      <FilterBar searchValue={fineQuery} onSearchChange={setFineQuery} searchPlaceholder="Tìm theo tên khách hàng..." />
                    </div>
                    {searchedFines.length === 0 ? (
                      <EmptyState variant="no-results" title="Không tìm thấy khoản phạt" description="Thử một tên khách hàng khác." />
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-border bg-muted/30">
                                {[
                                  { label: 'Khách hàng', className: '' },
                                  { label: 'Số tiền', className: 'text-right' },
                                  { label: 'Trạng thái', className: '' },
                                  { label: 'Ngày phạt', className: 'hidden sm:table-cell' },
                                ].map((h) => (
                                  <th key={h.label} className={cn('px-5 py-2.5 text-left text-[12px] font-medium text-muted-foreground', h.className)}>{h.label}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {pagedFines.map((fine) => (
                                <tr key={fine.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/40">
                                  <td className="px-5 py-3">
                                    <p className="max-w-[260px] truncate text-[13px]">{fine.customers?.full_name || fine.customer_id?.slice(0, 8)}</p>
                                    <p className="text-[12px] text-muted-foreground">{fine.fine_type}</p>
                                  </td>
                                  <td className="px-5 py-3 text-right text-[13px] font-medium tabular-nums">{formatCurrency(Number(fine.amount))}</td>
                                  <td className="px-5 py-3">
                                    <StatusBadge label={FINE_STATUS_LABELS[fine.status] || fine.status} variant={getStatusVariant('fine', fine.status)} dot />
                                  </td>
                                  <td className="hidden px-5 py-3 text-[13px] tabular-nums text-muted-foreground sm:table-cell">{formatCellDate(fine.issued_at)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {renderTablePagination(finesCurrentPage, finesTotalPages, setFinesPage)}
                      </>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </section>
        </FadeItem>
      )}
    </PageWrapper>
  );
}
