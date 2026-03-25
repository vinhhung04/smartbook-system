import { useEffect, useState, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen, Users, HandCoins, AlertTriangle, FileSpreadsheet,
  FileText, Calendar, TrendingUp, RefreshCw,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from 'recharts';
import { StatCard } from '@/components/ui/stat-card';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { borrowService, type Loan, type Fine } from '@/services/borrow';
import { bookService } from '@/services/book';
import { stockMovementService } from '@/services/stock-movement';
import { getApiErrorMessage } from '@/services/api';
import { exportToExcel, exportToPdf, exportSummaryReport, type ExportColumn } from '@/lib/export-utils';
import { toast } from 'sonner';

type DateRange = '7d' | '30d' | '90d' | 'all';

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
  { value: '90d', label: '90 ngày' },
  { value: 'all', label: 'Tất cả' },
];

const PIE_COLORS = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

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

export function ReportsPage() {
  const [range, setRange] = useState<DateRange>('30d');
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [fines, setFines] = useState<Fine[]>([]);
  const [books, setBooks] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [loanResp, fineResp, bookResp, movResp] = await Promise.allSettled([
        borrowService.getLoans({ pageSize: 500 }),
        borrowService.getFines({ pageSize: 500 }),
        bookService.getAll(),
        stockMovementService.getAll({ pageSize: 200 }),
      ]);

      if (loanResp.status === 'fulfilled') {
        setLoans(Array.isArray(loanResp.value?.data) ? loanResp.value.data : []);
      }
      if (fineResp.status === 'fulfilled') {
        setFines(Array.isArray(fineResp.value?.data) ? fineResp.value.data : []);
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

  const threshold = useMemo(() => getDateThreshold(range), [range]);

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
    return Array.from(statusMap.entries()).map(([name, value]) => ({ name, value }));
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

  const handleExportLoansExcel = () => {
    exportToExcel(prepareLoanExportData(), loanColumns, `bao-cao-muon-tra-${range}`);
    toast.success('Đã xuất file Excel báo cáo mượn/trả');
  };

  const handleExportLoansPdf = () => {
    exportToPdf(prepareLoanExportData(), loanColumns, 'Báo cáo Mượn/Trả Sách', `bao-cao-muon-tra-${range}`);
    toast.success('Đã xuất file PDF báo cáo mượn/trả');
  };

  const handleExportFinesExcel = () => {
    exportToExcel(prepareFineExportData(), fineColumns, `bao-cao-phat-${range}`);
    toast.success('Đã xuất file Excel báo cáo phạt');
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

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
      >
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            Báo cáo & Thống kê
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            Tổng hợp dữ liệu hoạt động thư viện
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Date range selector */}
          <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5 border border-border">
            {DATE_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRange(opt.value)}
                className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                  range === opt.value
                    ? 'bg-white text-indigo-700 shadow-sm border border-indigo-100'
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
      </motion.div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.3 }}>
          <StatCard label="Đầu sách" value={kpi.totalBooks} icon={BookOpen} variant="default" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.3 }}>
          <StatCard label="Lượt mượn" value={kpi.totalLoans} icon={HandCoins} variant="primary" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.3 }}>
          <StatCard label="Đã trả" value={kpi.returnedLoans} icon={TrendingUp} variant="success" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.3 }}>
          <StatCard label="Quá hạn" value={kpi.overdueLoans} icon={AlertTriangle} variant="danger" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.3 }}>
          <StatCard
            label="Tổng phạt"
            value={kpi.totalFineAmount.toLocaleString('vi-VN') + 'đ'}
            icon={Users}
            variant="warning"
          />
        </motion.div>
      </div>

      {/* Charts Row 1: Borrow Trend + Stock Movement */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.3 }}>
          <SectionCard title="Xu hướng mượn sách" subtitle={`Theo ngày (${DATE_RANGE_OPTIONS.find((o) => o.value === range)?.label})`} icon={Calendar}>
            {borrowTrendData.length === 0 ? (
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
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #e2e4ed', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }} />
                  <Area type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={2} fill="url(#borrowGrad)" name="Lượt mượn" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.3 }}>
          <SectionCard
            title="Luồng kho"
            subtitle="Nhập / Xuất theo ngày"
            actions={
              <span className="flex items-center gap-4 text-[11px]">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-r from-indigo-500 to-blue-500" /> Nhập</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-r from-cyan-500 to-teal-500" /> Xuất</span>
              </span>
            }
          >
            {movementTrendData.length === 0 ? (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Không có biến động kho trong khoảng thời gian này." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={movementTrendData} barGap={4} barSize={16}>
                  <defs>
                    <linearGradient id="rptInGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f46e5" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                    <linearGradient id="rptOutGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#06b6d4" />
                      <stop offset="100%" stopColor="#14b8a6" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f5" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #e2e4ed' }} />
                  <Bar dataKey="inbound" fill="url(#rptInGrad)" radius={[4, 4, 0, 0]} name="Nhập" />
                  <Bar dataKey="outbound" fill="url(#rptOutGrad)" radius={[4, 4, 0, 0]} name="Xuất" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </motion.div>
      </div>

      {/* Charts Row 2: Top Books + Fine Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.3 }} className="lg:col-span-2">
          <SectionCard title="Top sách được mượn nhiều" subtitle="Xếp hạng theo lượt mượn">
            {topBooksData.length === 0 ? (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Chưa có lượt mượn để thống kê." />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={topBooksData} layout="vertical" barSize={18}>
                  <defs>
                    <linearGradient id="topBookGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#4f46e5" />
                      <stop offset="100%" stopColor="#7c3aed" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f5" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="title" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={120} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #e2e4ed' }} />
                  <Bar dataKey="count" fill="url(#topBookGrad)" radius={[0, 6, 6, 0]} name="Lượt mượn" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.3 }}>
          <SectionCard title="Phân bố phạt" subtitle="Theo trạng thái">
            {fineStatusData.length === 0 ? (
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
                    {fineStatusData.map((_entry, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #e2e4ed' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </motion.div>
      </div>

      {/* Loans Table + Export */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.3 }}>
        <SectionCard
          title="Danh sách Mượn/Trả"
          subtitle={`${filteredLoans.length} phiếu mượn`}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={handleExportLoansExcel} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-[12px] text-emerald-700 hover:bg-emerald-50 transition-colors font-medium">
                <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
              </button>
              <button onClick={handleExportLoansPdf} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-[12px] text-rose-700 hover:bg-rose-50 transition-colors font-medium">
                <FileText className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          }
        >
          {filteredLoans.length === 0 ? (
            <EmptyState variant="no-data" title="Không có phiếu mượn" description="Chưa có dữ liệu mượn/trả trong khoảng thời gian này." />
          ) : (
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border bg-muted/30">
                    {['Mã phiếu', 'Khách hàng', 'Ngày mượn', 'Hạn trả', 'Trạng thái', 'SL'].map((h) => (
                      <th key={h} className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLoans.slice(0, 50).map((loan) => (
                    <tr key={loan.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 text-[13px] font-mono font-medium">{loan.loan_number}</td>
                      <td className="px-4 py-3 text-[13px]">{loan.customers?.full_name || loan.customer_id?.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{loan.borrow_date?.slice(0, 10)}</td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{loan.due_date?.slice(0, 10)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={loan.status}
                          variant={
                            loan.status === 'RETURNED' ? 'success' :
                            loan.status === 'OVERDUE' ? 'danger' :
                            loan.status === 'BORROWED' ? 'info' : 'warning'
                          }
                          dot
                        />
                      </td>
                      <td className="px-4 py-3 text-[13px] font-mono font-medium">{loan.total_items}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredLoans.length > 50 && (
                <p className="text-center text-[12px] text-muted-foreground py-3">
                  Hiển thị 50/{filteredLoans.length} phiếu. Xuất file để xem đầy đủ.
                </p>
              )}
            </div>
          )}
        </SectionCard>
      </motion.div>

      {/* Fines Table + Export */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.3 }}>
        <SectionCard
          title="Danh sách Phạt"
          subtitle={`${filteredFines.length} khoản phạt`}
          actions={
            <div className="flex items-center gap-2">
              <button onClick={handleExportFinesExcel} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-[12px] text-emerald-700 hover:bg-emerald-50 transition-colors font-medium">
                <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
              </button>
              <button onClick={handleExportFinesPdf} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-[12px] text-rose-700 hover:bg-rose-50 transition-colors font-medium">
                <FileText className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          }
        >
          {filteredFines.length === 0 ? (
            <EmptyState variant="no-data" title="Không có khoản phạt" description="Chưa có dữ liệu phạt trong khoảng thời gian này." />
          ) : (
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border bg-muted/30">
                    {['Khách hàng', 'Loại phạt', 'Số tiền', 'Trạng thái', 'Ngày phạt'].map((h) => (
                      <th key={h} className="text-left text-[11px] text-muted-foreground uppercase tracking-wider px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredFines.slice(0, 50).map((fine) => (
                    <tr key={fine.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-4 py-3 text-[13px]">{fine.customers?.full_name || fine.customer_id?.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-[13px]">{fine.fine_type}</td>
                      <td className="px-4 py-3 text-[13px] font-mono font-medium">{Number(fine.amount).toLocaleString('vi-VN')}đ</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={fine.status}
                          variant={
                            fine.status === 'PAID' ? 'success' :
                            fine.status === 'WAIVED' ? 'info' :
                            fine.status === 'PENDING' ? 'warning' : 'danger'
                          }
                          dot
                        />
                      </td>
                      <td className="px-4 py-3 text-[12px] text-muted-foreground">{fine.issued_at?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredFines.length > 50 && (
                <p className="text-center text-[12px] text-muted-foreground py-3">
                  Hiển thị 50/{filteredFines.length} khoản phạt. Xuất file để xem đầy đủ.
                </p>
              )}
            </div>
          )}
        </SectionCard>
      </motion.div>
    </div>
  );
}
