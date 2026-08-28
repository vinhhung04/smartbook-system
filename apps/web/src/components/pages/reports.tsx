import { useEffect, useState, useMemo } from 'react';
import {
  BookOpen, Wallet, HandCoins, AlertTriangle, FileSpreadsheet,
  FileText, Calendar, TrendingUp, RefreshCw, BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { PageWrapper, FadeItem } from '../motion-utils';
import { StatCard } from '@/components/ui/stat-card';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton, SkeletonStatCards } from '@/components/ui/loading-state';
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

const FINE_STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Chưa trả',
  PARTIALLY_PAID: 'Trả một phần',
  PAID: 'Đã trả',
  WAIVED: 'Đã miễn',
};

// Matches the emerald/amber/red/slate already used by StatusBadge for these statuses
// (see status-registry.ts 'fine' domain) — the pie should read as the same vocabulary
// as every other fine status badge in the app, not an arbitrary qualitative palette.
const FINE_STATUS_COLORS: Record<string, string> = {
  PAID: '#10b981',
  PARTIALLY_PAID: '#f59e0b',
  UNPAID: '#ef4444',
  WAIVED: '#94a3b8',
};

const TABLE_PAGE_SIZE = 10;

function getDateThreshold(range: DateRange): Date | null {
  if (range === 'all') return null;
  const now = new Date();
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return new Date(now.getTime() - days * 86_400_000);
}

function groupByDate(items: { date: string }[]): { date: string; count: number }[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const d = item.date.slice(0, 10);
    map.set(d, (map.get(d) || 0) + 1);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

/**
 * The loan/fine list endpoints cap pageSize at 100 server-side — a single request silently
 * truncates a report's totals once a library has more than 100 loans or fines. Page through
 * everything instead so KPIs/charts reflect the real numbers, not just the first page.
 */
async function fetchAllPages<T>(
  fetcher: (params: { page: number; pageSize: number }) => Promise<{ data: T[]; meta?: { totalPages?: number } }>,
): Promise<T[]> {
  const pageSize = 100;
  let all: T[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetcher({ page, pageSize });
    const rows = res.data ?? [];
    all = all.concat(rows);
    const totalPages = res.meta?.totalPages ?? 1;
    if (page >= totalPages || rows.length < pageSize) break;
  }
  return all;
}

function SectionEyebrow({ index, label }: { index: string; label: string }) {
  return (
    <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
      {index} — {label}
    </p>
  );
}

const chartTooltipStyle = { fontSize: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--card)' };
const chartAxisTick = { fontSize: 10, fill: '#94a3b8' };

export function ReportsPage() {
  const [range, setRange] = useState<DateRange>('30d');
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [books, setBooks] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [loansPage, setLoansPage] = useState(1);
  const [finesPage, setFinesPage] = useState(1);

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
        setLoans(loanResp.value);
      } else {
        console.error('[Reports] Loans failed:', loanResp.reason);
        toast.error('Không tải được dữ liệu mượn/trả: ' + (loanResp.reason?.response?.data?.message || loanResp.reason?.message || 'Lỗi không xác định'));
      }
      if (fineResp.status === 'fulfilled') {
        setFines(fineResp.value);
      } else {
        console.error('[Reports] Fines failed:', fineResp.reason);
      }
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

  const threshold = useMemo(() => getDateThreshold(range), [range]);

  const periodLabel = useMemo(() => {
    if (range === 'all') return 'Toàn bộ dữ liệu';
    const from = threshold ? threshold.toLocaleDateString('vi-VN') : '';
    const to = new Date().toLocaleDateString('vi-VN');
    return `${from} – ${to}`;
  }, [range, threshold]);

  const filteredLoans = useMemo(() => {
    if (!threshold) return loans;
    return loans.filter((l) => new Date(l.created_at) >= threshold);
  }, [loans, threshold]);

  const filteredFines = useMemo(() => {
    if (!threshold) return fines;
    return fines.filter((f) => new Date(f.issued_at) >= threshold);
  }, [fines, threshold]);

  const filteredMovements = useMemo(() => {
    if (!threshold) return movements;
    return movements.filter((m: any) => new Date(m.created_at) >= threshold);
  }, [movements, threshold]);

  // --- KPI ---
  const kpi = useMemo(() => {
    const totalBooks = books.length;
    const totalLoans = filteredLoans.length;
    const returnedLoans = filteredLoans.filter((l) => l.status === 'RETURNED').length;
    const overdueLoans = filteredLoans.filter((l) => l.status === 'OVERDUE').length;
    const totalFineAmount = filteredFines.reduce((s, f) => s + Number(f.amount || 0), 0);
    return { totalBooks, totalLoans, returnedLoans, overdueLoans, totalFineAmount };
  }, [books, filteredLoans, filteredFines]);

  // --- Borrow trend chart ---
  const borrowTrendData = useMemo(() => {
    const items = filteredLoans.map((l) => ({ date: l.created_at }));
    return groupByDate(items);
  }, [filteredLoans]);

  // --- Top borrowed books ---
  const topBooksData = useMemo(() => {
    const countMap = new Map<string, { title: string; count: number }>();
    for (const loan of filteredLoans) {
      if (loan.loan_items) {
        for (const item of loan.loan_items) {
          const key = item.variant_id;
          const existing = countMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            countMap.set(key, { title: key, count: 1 });
          }
        }
      } else {
        const key = loan.id;
        const existing = countMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          countMap.set(key, {
            title: loan.loan_number || loan.id.slice(0, 8),
            count: 1,
          });
        }
      }
    }
    return Array.from(countMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filteredLoans]);

  // --- Fine status distribution ---
  const fineStatusData = useMemo(() => {
    const statusMap = new Map<string, number>();
    for (const f of filteredFines) {
      const s = f.status || 'UNKNOWN';
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    }
    return Array.from(statusMap.entries()).map(([status, value]) => ({
      status,
      name: FINE_STATUS_LABELS[status] || status,
      value,
    }));
  }, [filteredFines]);

  // --- Stock movement trend ---
  const movementTrendData = useMemo(() => {
    const inMap = new Map<string, number>();
    const outMap = new Map<string, number>();
    for (const m of filteredMovements) {
      const d = (m.created_at || '').slice(0, 10);
      if (!d) continue;
      if (m.movement_type === 'INBOUND') {
        inMap.set(d, (inMap.get(d) || 0) + Number(m.quantity || 0));
      } else if (m.movement_type === 'OUTBOUND') {
        outMap.set(d, (outMap.get(d) || 0) + Number(m.quantity || 0));
      }
    }
    const allDates = new Set([...inMap.keys(), ...outMap.keys()]);
    return Array.from(allDates)
      .sort()
      .map((date) => ({
        date,
        inbound: inMap.get(date) || 0,
        outbound: outMap.get(date) || 0,
      }));
  }, [filteredMovements]);

  const loansTotalPages = Math.max(1, Math.ceil(filteredLoans.length / TABLE_PAGE_SIZE));
  const loansCurrentPage = Math.min(loansPage, loansTotalPages);
  const pagedLoans = filteredLoans.slice((loansCurrentPage - 1) * TABLE_PAGE_SIZE, loansCurrentPage * TABLE_PAGE_SIZE);

  const finesTotalPages = Math.max(1, Math.ceil(filteredFines.length / TABLE_PAGE_SIZE));
  const finesCurrentPage = Math.min(finesPage, finesTotalPages);
  const pagedFines = filteredFines.slice((finesCurrentPage - 1) * TABLE_PAGE_SIZE, finesCurrentPage * TABLE_PAGE_SIZE);

  // --- Export handlers ---
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

  const prepareLoanExportData = () =>
    filteredLoans.map((l) => ({
      loan_number: l.loan_number,
      customer_name: l.customers?.full_name || l.customer_id,
      borrow_date: l.borrow_date?.slice(0, 10) || '',
      due_date: l.due_date?.slice(0, 10) || '',
      status: l.status,
      total_items: l.total_items,
    }));

  const prepareFineExportData = () =>
    filteredFines.map((f) => ({
      customer_name: f.customers?.full_name || f.customer_id,
      fine_type: f.fine_type,
      amount: f.amount,
      status: f.status,
      issued_at: f.issued_at?.slice(0, 10) || '',
    }));

  const handleExportLoansCsv = () => {
    exportToCsv(prepareLoanExportData(), loanColumns, `bao-cao-muon-tra-${range}`);
    toast.success('Đã xuất file CSV báo cáo mượn/trả');
  };

  const handleExportLoansPdf = () => {
    exportToPdf(prepareLoanExportData(), loanColumns, 'Báo cáo Mượn/Trả Sách', `bao-cao-muon-tra-${range}`);
    toast.success('Đã xuất file PDF báo cáo mượn/trả');
  };

  const handleExportFinesCsv = () => {
    exportToCsv(prepareFineExportData(), fineColumns, `bao-cao-phat-${range}`);
    toast.success('Đã xuất file CSV báo cáo phạt');
  };

  const handleExportFinesPdf = () => {
    exportToPdf(prepareFineExportData(), fineColumns, 'Báo cáo Phạt', `bao-cao-phat-${range}`);
    toast.success('Đã xuất file PDF báo cáo phạt');
  };

  const handleExportSummaryReport = () => {
    const totalFineAmount = filteredFines.reduce((s, f: any) => s + Number(f.amount || 0), 0);
    const paidFines = filteredFines.filter((f: any) => f.status === 'PAID').length;

    exportSummaryReport({
      title: 'Báo cáo Tổng hợp Thư viện SmartBook',
      dateRange: `Khoảng thời gian: ${DATE_RANGE_OPTIONS.find(o => o.value === range)?.label || range}`,
      kpis: [
        { label: 'Tổng đầu sách', value: books.length },
        { label: 'Phiếu mượn', value: filteredLoans.length },
        { label: 'Quá hạn', value: filteredLoans.filter((l: any) => l.status === 'OVERDUE').length },
        { label: 'Đã trả', value: filteredLoans.filter((l: any) => l.status === 'RETURNED').length },
        { label: 'Tổng phạt', value: `${totalFineAmount.toLocaleString()}đ` },
        { label: 'Đã thu phạt', value: `${paidFines}/${filteredFines.length}` },
        { label: 'Biến động kho', value: movements.length },
      ],
      sections: [
        {
          title: 'Mượn/Trả gần đây',
          columns: loanColumns,
          data: prepareLoanExportData(),
        },
        {
          title: 'Phạt gần đây',
          columns: fineColumns,
          data: prepareFineExportData(),
        },
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

  return (
    <PageWrapper className="space-y-6">
      {/* Masthead */}
      <FadeItem>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-indigo-100 dark:bg-indigo-500/15">
              <BarChart3 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Báo cáo thư viện
              </p>
              <h1 className="font-serif text-[26px] font-semibold leading-tight text-foreground">Báo cáo &amp; Thống kê</h1>
              <p className="mt-1 font-mono text-[12px] text-muted-foreground">Kỳ báo cáo: {periodLabel}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5 border border-border">
              {DATE_RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setRange(opt.value)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                    range === opt.value
                      ? 'bg-card text-indigo-700 dark:text-indigo-400 shadow-sm border border-indigo-100 dark:border-indigo-500/20'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleExportSummaryReport}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-[12px] hover:shadow-md transition-all font-medium"
            >
              <FileText className="w-3.5 h-3.5" />
              Báo cáo tổng hợp
            </button>
            <button
              onClick={() => void loadData()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Tải lại
            </button>
          </div>
        </div>
      </FadeItem>

      {/* 01 — Tổng quan */}
      <FadeItem>
        <SectionEyebrow index="01" label="Tổng quan" />
        {loading ? (
          <SkeletonStatCards count={5} />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard label="Đầu sách" value={kpi.totalBooks} icon={BookOpen} variant="default" />
            <StatCard label="Lượt mượn" value={kpi.totalLoans} icon={HandCoins} variant="primary" />
            <StatCard label="Đã trả" value={kpi.returnedLoans} icon={TrendingUp} variant="success" />
            <StatCard label="Quá hạn" value={kpi.overdueLoans} icon={AlertTriangle} variant="danger" />
            <StatCard
              label="Tổng phạt"
              value={kpi.totalFineAmount.toLocaleString('vi-VN') + 'đ'}
              icon={Wallet}
              variant="warning"
            />
          </div>
        )}
      </FadeItem>

      {/* 02 — Xu hướng */}
      <FadeItem>
        <SectionEyebrow index="02" label="Xu hướng" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SectionCard title="Xu hướng mượn sách" subtitle={`Theo ngày (${DATE_RANGE_OPTIONS.find((o) => o.value === range)?.label})`} icon={Calendar}>
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : borrowTrendData.length === 0 ? (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Không có lượt mượn trong khoảng thời gian này." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={borrowTrendData}>
                  <defs>
                    <linearGradient id="borrowGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f5" vertical={false} />
                  <XAxis dataKey="date" tick={chartAxisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={chartAxisTick} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Area type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={2} fill="url(#borrowGrad)" name="Lượt mượn" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </SectionCard>

          <SectionCard
            title="Luồng kho"
            subtitle="Nhập / Xuất theo ngày"
            actions={
              <span className="flex items-center gap-4 text-[11px]">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-r from-emerald-500 to-teal-500" /> Nhập</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-r from-rose-500 to-red-500" /> Xuất</span>
              </span>
            }
          >
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : movementTrendData.length === 0 ? (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Không có biến động kho trong khoảng thời gian này." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={movementTrendData} barGap={4} barSize={16}>
                  <defs>
                    <linearGradient id="rptInGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#14b8a6" />
                    </linearGradient>
                    <linearGradient id="rptOutGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" />
                      <stop offset="100%" stopColor="#ef4444" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f5" vertical={false} />
                  <XAxis dataKey="date" tick={chartAxisTick} axisLine={false} tickLine={false} />
                  <YAxis tick={chartAxisTick} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="inbound" fill="url(#rptInGrad)" radius={[4, 4, 0, 0]} name="Nhập" />
                  <Bar dataKey="outbound" fill="url(#rptOutGrad)" radius={[4, 4, 0, 0]} name="Xuất" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </div>
      </FadeItem>

      {/* 03 — Phân bổ */}
      <FadeItem>
        <SectionEyebrow index="03" label="Phân bổ" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <SectionCard title="Top sách được mượn nhiều" subtitle="Xếp hạng theo lượt mượn" className="lg:col-span-2">
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : topBooksData.length === 0 ? (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Chưa có lượt mượn để thống kê." />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topBooksData} layout="vertical" barSize={18}>
                  <defs>
                    <linearGradient id="topBookGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#d97706" />
                      <stop offset="100%" stopColor="#f59e0b" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f5" horizontal={false} />
                  <XAxis type="number" tick={chartAxisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="title" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={120} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="count" fill="url(#topBookGrad)" radius={[0, 6, 6, 0]} name="Lượt mượn" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>

          <SectionCard title="Phân bố phạt" subtitle="Theo trạng thái">
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : fineStatusData.length === 0 ? (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Không có phạt trong khoảng thời gian này." />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={fineStatusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {fineStatusData.map((entry) => (
                      <Cell key={entry.status} fill={FINE_STATUS_COLORS[entry.status] || '#cbd5e1'} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </div>
      </FadeItem>

      {/* 04 — Chi tiết */}
      <FadeItem>
        <SectionEyebrow index="04" label="Chi tiết" />
        <div className="space-y-5">
          <SectionCard
            title="Danh sách Mượn/Trả"
            subtitle={`${filteredLoans.length} phiếu mượn`}
            noPadding
            actions={
              <div className="flex items-center gap-2">
                <button onClick={handleExportLoansCsv} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-[12px] text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10 transition-colors font-medium">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
                </button>
                <button onClick={handleExportLoansPdf} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-[12px] text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10 transition-colors font-medium">
                  <FileText className="w-3.5 h-3.5" /> PDF
                </button>
              </div>
            }
          >
            {loading ? (
              <div className="p-5"><Skeleton className="h-[200px] w-full" /></div>
            ) : filteredLoans.length === 0 ? (
              <div className="p-5">
                <EmptyState variant="no-data" title="Không có phiếu mượn" description="Chưa có dữ liệu mượn/trả trong khoảng thời gian này." />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {['Mã phiếu', 'Khách hàng', 'Ngày mượn', 'Hạn trả', 'Trạng thái', 'SL'].map((h) => (
                          <th key={h} className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-4 py-3 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedLoans.map((loan) => (
                        <tr key={loan.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-3 text-[13px] font-mono font-medium">{loan.loan_number}</td>
                          <td className="px-4 py-3 text-[13px]">{loan.customers?.full_name || loan.customer_id?.slice(0, 8)}</td>
                          <td className="px-4 py-3 text-[12px] text-muted-foreground">{loan.borrow_date?.slice(0, 10)}</td>
                          <td className="px-4 py-3 text-[12px] text-muted-foreground">{loan.due_date?.slice(0, 10)}</td>
                          <td className="px-4 py-3">
                            <StatusBadge label={loan.status} variant={getStatusVariant('loan', loan.status)} dot />
                          </td>
                          <td className="px-4 py-3 text-[13px] font-mono font-medium">{loan.total_items}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {renderTablePagination(loansCurrentPage, loansTotalPages, setLoansPage)}
              </>
            )}
          </SectionCard>

          <SectionCard
            title="Danh sách Phạt"
            subtitle={`${filteredFines.length} khoản phạt`}
            noPadding
            actions={
              <div className="flex items-center gap-2">
                <button onClick={handleExportFinesCsv} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-[12px] text-emerald-700 hover:bg-emerald-50 transition-colors font-medium">
                  <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
                </button>
                <button onClick={handleExportFinesPdf} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-[12px] text-rose-700 hover:bg-rose-50 transition-colors font-medium">
                  <FileText className="w-3.5 h-3.5" /> PDF
                </button>
              </div>
            }
          >
            {loading ? (
              <div className="p-5"><Skeleton className="h-[200px] w-full" /></div>
            ) : filteredFines.length === 0 ? (
              <div className="p-5">
                <EmptyState variant="no-data" title="Không có khoản phạt" description="Chưa có dữ liệu phạt trong khoảng thời gian này." />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {['Khách hàng', 'Loại phạt', 'Số tiền', 'Trạng thái', 'Ngày phạt'].map((h) => (
                          <th key={h} className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-4 py-3 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedFines.map((fine) => (
                        <tr key={fine.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                          <td className="px-4 py-3 text-[13px]">{fine.customers?.full_name || fine.customer_id?.slice(0, 8)}</td>
                          <td className="px-4 py-3 text-[13px]">{fine.fine_type}</td>
                          <td className="px-4 py-3 text-[13px] font-mono font-medium">{Number(fine.amount).toLocaleString('vi-VN')}đ</td>
                          <td className="px-4 py-3">
                            <StatusBadge label={FINE_STATUS_LABELS[fine.status] || fine.status} variant={getStatusVariant('fine', fine.status)} dot />
                          </td>
                          <td className="px-4 py-3 text-[12px] text-muted-foreground">{fine.issued_at?.slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {renderTablePagination(finesCurrentPage, finesTotalPages, setFinesPage)}
              </>
            )}
          </SectionCard>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
