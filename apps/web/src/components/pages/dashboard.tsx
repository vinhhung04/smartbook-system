import { useEffect, useState, useCallback } from 'react';
import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import {
  BookOpen, Package, AlertTriangle, PackageX, FileText,
  ScanBarcode, Plus, Sparkles, ArrowRight, Clock, TrendingUp,
  RefreshCw, BookMarked, Receipt, Crown,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import { StatCard } from '@/components/ui/stat-card';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { stockMovementService } from '@/services/stock-movement';
import { bookService } from '@/services/book';
import { goodsReceiptService } from '@/services/goods-receipt';
import { borrowService } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/http-clients';
import { toast } from 'sonner';

const PIE_COLORS = ['#6366f1', '#a78bfa', '#c084fc', '#e879f9', '#f472b6', '#38bdf8', '#34d399', '#fbbf24'];

export function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState({
    totalTitles: 0, totalUnits: 0, lowStock: 0, outOfStock: 0,
    draftReceipts: 0, postedToday: 0, overdueBorrows: 0,
    activeLoans: 0, totalCustomers: 0, totalReservations: 0, totalFines: 0,
  });
  const [recentMovements, setRecentMovements] = useState<any[]>([]);
  const [topBooks, setTopBooks] = useState<{ name: string; loans: number }[]>([]);
  const [loanTrend, setLoanTrend] = useState<{ date: string; count: number }[]>([]);
  const [categoryDist, setCategoryDist] = useState<{ name: string; value: number }[]>([]);

  const loadDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const [bookResp, receiptResp, borrowResp, movementResp, reservationResp, finesResp] = await Promise.allSettled([
        bookService.getAll(),
        goodsReceiptService.getAll({ pageSize: 50 }),
        borrowService.getLoans({ pageSize: 200 }),
        stockMovementService.getAll({ pageSize: 5 }),
        borrowService.getReservations({ pageSize: 50 }),
        borrowService.getFines({ pageSize: 100 }),
      ]);

      let totalUnits = 0, totalTitles = 0, lowStock = 0, outOfStock = 0;
      const books: any[] = [];
      if (bookResp.status === 'fulfilled') {
        const bks = Array.isArray(bookResp.value) ? bookResp.value : [];
        books.push(...bks);
        totalTitles = bks.length;
        totalUnits = bks.reduce((sum: number, b: any) => sum + Number(b.quantity || 0), 0);
        lowStock = bks.filter((b: any) => Number(b.quantity || 0) > 0 && Number(b.quantity || 0) <= 10).length;
        outOfStock = bks.filter((b: any) => Number(b.quantity || 0) === 0).length;

        const catMap: Record<string, number> = {};
        bks.forEach((b: any) => { const c = b.category || 'Other'; catMap[c] = (catMap[c] || 0) + 1; });
        setCategoryDist(Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name, value })));
      }

      let draftReceipts = 0, postedToday = 0;
      const today = new Date().toDateString();
      if (receiptResp.status === 'fulfilled') {
        const rawReceipts = receiptResp.value;
        const receipts = Array.isArray(rawReceipts) ? rawReceipts : Array.isArray(rawReceipts?.data) ? rawReceipts.data : [];
        draftReceipts = receipts.filter((r: any) => r.status === 'DRAFT').length;
        postedToday = receipts.filter((r: any) => new Date(r.updated_at || r.created_at).toDateString() === today && r.status === 'POSTED').length;
      }

      let overdueBorrows = 0, activeLoans = 0;
      const allLoans: any[] = [];
      if (borrowResp.status === 'fulfilled') {
        const loans = Array.isArray(borrowResp.value?.data) ? borrowResp.value.data : [];
        allLoans.push(...loans);
        overdueBorrows = loans.filter((l: any) => l.status === 'OVERDUE').length;
        activeLoans = loans.filter((l: any) => ['BORROWED', 'OVERDUE'].includes(l.status)).length;

        const bookLoanCount: Record<string, number> = {};
        loans.forEach((l: any) => {
          (l.loan_items || []).forEach((item: any) => {
            const book = books.find((b: any) => b.variants?.some((v: any) => v.id === item.variant_id) || b.id === item.variant_id);
            const title = book?.title || item.variant_id?.slice(0, 8) || 'Unknown';
            bookLoanCount[title] = (bookLoanCount[title] || 0) + 1;
          });
        });
        setTopBooks(Object.entries(bookLoanCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, loans]) => ({
          name: name.length > 18 ? name.slice(0, 18) + '…' : name, loans,
        })));

        const trendMap: Record<string, number> = {};
        const now = new Date();
        for (let i = 29; i >= 0; i--) {
          const d = new Date(now); d.setDate(d.getDate() - i);
          trendMap[d.toISOString().slice(0, 10)] = 0;
        }
        loans.forEach((l: any) => {
          const d = (l.borrow_date || l.created_at || '').slice(0, 10);
          if (d in trendMap) trendMap[d]++;
        });
        setLoanTrend(Object.entries(trendMap).map(([date, count]) => ({ date: date.slice(5), count })));

      }

      let totalReservations = 0;
      if (reservationResp.status === 'fulfilled') {
        totalReservations = reservationResp.value?.meta?.total || (Array.isArray(reservationResp.value?.data) ? reservationResp.value.data.length : 0);
      }

      let totalFines = 0;
      if (finesResp.status === 'fulfilled') {
        const fines = Array.isArray(finesResp.value?.data) ? finesResp.value.data : [];
        totalFines = fines.filter((f: any) => f.status === 'UNPAID' || f.status === 'PARTIALLY_PAID').reduce((s: number, f: any) => s + Number(f.amount || 0) - Number(f.waived_amount || 0), 0);
      }

      setKpi({ totalTitles, totalUnits, lowStock, outOfStock, draftReceipts, postedToday, overdueBorrows, activeLoans, totalCustomers: 0, totalReservations, totalFines });

      if (movementResp.status === 'fulfilled') {
        setRecentMovements(Array.isArray(movementResp.value) ? movementResp.value.slice(0, 5) : []);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load dashboard'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Hero Header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 p-6 shadow-xl shadow-indigo-500/20">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.12)_0%,transparent_50%)]" />
        <div className="absolute top-0 right-0 w-60 h-60 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="text-white">
            <h1 className="tracking-[-0.03em] text-white" style={{ fontWeight: 700, fontSize: 22 }}>SmartBook Dashboard</h1>
            <p className="text-white/65 text-[13px] mt-1">
              {new Date().toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — Tổng quan hệ thống
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2.5">
            <NavLink to="/orders/new" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-indigo-700 text-[13px] shadow-md hover:shadow-lg hover:bg-indigo-50 active:scale-[0.98] transition-all" style={{ fontWeight: 600 }}>
              <ScanBarcode className="w-4 h-4" /> Nhập kho
            </NavLink>
          </div>
        </div>
      </motion.div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: 'Đầu sách', value: kpi.totalTitles, icon: BookOpen, variant: 'default' as const },
          { label: 'Tổng bản', value: kpi.totalUnits, icon: Package, variant: 'success' as const },
          { label: 'Tồn thấp', value: kpi.lowStock, icon: AlertTriangle, variant: 'warning' as const },
          { label: 'Hết hàng', value: kpi.outOfStock, icon: PackageX, variant: 'danger' as const },
          { label: 'Đang mượn', value: kpi.activeLoans, icon: BookMarked, variant: 'info' as const },
          { label: 'Quá hạn', value: kpi.overdueBorrows, icon: Clock, variant: 'danger' as const },
          { label: 'Đặt trước', value: kpi.totalReservations, icon: FileText, variant: 'primary' as const },
          { label: 'Phạt chờ thu', value: `${Math.round(kpi.totalFines / 1000)}K`, icon: Receipt, variant: 'warning' as const },
        ].map((item, i) => (
          <motion.div key={item.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <StatCard label={item.label} value={item.value} icon={item.icon} variant={item.variant} />
          </motion.div>
        ))}
      </div>

      {/* Quick Actions */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Nhập kho", icon: ScanBarcode, to: "/orders/new", style: "bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 text-white shadow-lg shadow-indigo-500/15" },
            { label: "Thêm sách", icon: Plus, to: "/catalog", style: "bg-white text-blue-700 border border-blue-100 shadow-sm" },
            { label: "AI Import", icon: Sparkles, to: "/ai-import", style: "bg-white text-cyan-700 border border-cyan-100 shadow-sm" },
            { label: "Báo cáo", icon: TrendingUp, to: "/reports", style: "bg-white text-emerald-700 border border-emerald-100 shadow-sm" },
          ].map((a) => (
            <NavLink key={a.label} to={a.to} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-[13px] transition-all hover:shadow-md ${a.style}`} style={{ fontWeight: 550 }}>
              <a.icon className="w-4.5 h-4.5" /> {a.label}
            </NavLink>
          ))}
        </div>
      </motion.div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lg:col-span-2">
          <SectionCard title="Xu hướng mượn sách" subtitle="30 ngày gần đây">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={loanTrend} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <defs>
                  <linearGradient id="loanGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f5" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={28} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: '1px solid #e2e4ed' }} />
                <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} fill="url(#loanGrad)" name="Lượt mượn" />
              </AreaChart>
            </ResponsiveContainer>
          </SectionCard>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <SectionCard title="Phân bố thể loại" subtitle="Tỷ lệ sách theo thể loại">
            {categoryDist.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={categoryDist} cx="50%" cy="50%" outerRadius={85} innerRadius={45} dataKey="value"
                    label={({ name, percent }) => `${name.length > 10 ? name.slice(0, 10) + '…' : name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                    {categoryDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #e2e8f0' }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Thêm sách để xem phân bố." />
            )}
          </SectionCard>
        </motion.div>
      </div>

      {/* Top Books + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <SectionCard title="Top sách mượn nhiều nhất" subtitle="Xếp hạng theo lượt mượn" icon={Crown}>
            {topBooks.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topBooks} layout="vertical" margin={{ top: 5, right: 20, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f5" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #e2e8f0' }} />
                  <Bar dataKey="loans" radius={[0, 8, 8, 0]} name="Lượt mượn">
                    {topBooks.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState variant="no-data" title="Chưa có dữ liệu" description="Dữ liệu mượn sách sẽ hiển thị ở đây." />
            )}
          </SectionCard>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          <div className="space-y-4">
            <SectionCard title="Cảnh báo" subtitle="Cần chú ý">
              <div className="space-y-2">
                {[
                  { message: `${kpi.lowStock} sách tồn kho thấp (≤10)`, type: 'warning' as const, icon: AlertTriangle, bg: 'bg-amber-50/80 border-amber-100/60', color: 'text-amber-500' },
                  { message: `${kpi.overdueBorrows} phiếu mượn quá hạn`, type: 'danger' as const, icon: Clock, bg: 'bg-rose-50/80 border-rose-100/60', color: 'text-rose-500' },
                  { message: `${kpi.draftReceipts} phiếu nhập chờ duyệt`, type: 'info' as const, icon: FileText, bg: 'bg-sky-50/80 border-sky-100/60', color: 'text-sky-500' },
                  { message: `${kpi.outOfStock} sách hết hàng`, type: 'danger' as const, icon: PackageX, bg: 'bg-rose-50/80 border-rose-100/60', color: 'text-rose-500' },
                ].map((a, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.05 }}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border ${a.bg}`}>
                    <a.icon className={`w-4 h-4 mt-0.5 shrink-0 ${a.color}`} />
                    <span className="text-[12px]" style={{ lineHeight: 1.5 }}>{a.message}</span>
                  </motion.div>
                ))}
              </div>
            </SectionCard>

            <div className="relative overflow-hidden rounded-xl border border-cyan-100/60 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-50/90 via-blue-50/50 to-violet-50/40" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-cyan-500/20 to-violet-500/15 flex items-center justify-center border border-cyan-200/40">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-600" />
                  </div>
                  <span className="text-[12px] text-cyan-700" style={{ fontWeight: 650 }}>AI Insights</span>
                </div>
                <p className="text-[12px] text-slate-600" style={{ lineHeight: 1.6 }}>
                  {kpi.lowStock > 0 ? `⚠️ ${kpi.lowStock} sách cần nhập thêm. ` : ''}
                  {kpi.overdueBorrows > 0 ? `📋 ${kpi.overdueBorrows} phiếu mượn quá hạn cần xử lý. ` : ''}
                  {kpi.totalFines > 0 ? `💰 ${Math.round(kpi.totalFines).toLocaleString()}đ phạt chưa thu. ` : ''}
                  Xem AI gợi ý để tối ưu hóa thư viện.
                </p>
                <NavLink to="/recommendations" className="inline-flex items-center gap-1 text-[11px] text-indigo-600 mt-3 hover:underline" style={{ fontWeight: 550 }}>
                  Xem gợi ý AI <ArrowRight className="w-3 h-3" />
                </NavLink>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Recent Stock Movements */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <SectionCard title="Biến động kho gần đây" subtitle="Cập nhật mới nhất"
          actions={
            <div className="flex items-center gap-2">
              <button onClick={() => void loadDashboard()} className="inline-flex items-center gap-1.5 h-8 rounded-lg border border-input bg-background px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" style={{ fontWeight: 500 }}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Làm mới
              </button>
              <NavLink to="/movements" className="text-[12px] text-primary font-medium hover:underline">Xem tất cả</NavLink>
            </div>
          }>
          {recentMovements.length === 0 ? (
            <EmptyState variant="no-data" title="Chưa có biến động" description="Dữ liệu kho sẽ hiển thị ở đây." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {['ID', 'Sách', 'Loại', 'SL', 'Kho', 'Thời gian'].map((h, i) => (
                      <th key={h} className={`${i === 5 ? 'text-right' : 'text-left'} text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3`} style={{ fontWeight: 550 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentMovements.map((m, i) => (
                    <motion.tr key={m.id || i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
                      className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-5 py-3.5 text-[13px] font-mono" style={{ fontWeight: 550 }}>{m.id ? String(m.id).slice(0, 8) : `SM-${String(i + 1).padStart(3, '0')}`}</td>
                      <td className="px-5 py-3.5 text-[13px]">{m.book_title || m.reference_type || '-'}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge label={m.movement_type || m.type || 'Transfer'} variant={['INBOUND', 'inbound'].includes(m.movement_type || m.type) ? 'success' : ['OUTBOUND', 'outbound'].includes(m.movement_type || m.type) ? 'danger' : 'info'} dot />
                      </td>
                      <td className="px-5 py-3.5 text-[13px] font-mono" style={{ fontWeight: 550 }}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</td>
                      <td className="px-5 py-3.5 text-[13px] text-muted-foreground">{m.warehouse_name || '-'}</td>
                      <td className="px-5 py-3.5 text-[12px] text-muted-foreground text-right">{m.created_at ? new Date(m.created_at).toLocaleString('vi-VN') : '-'}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </motion.div>
    </div>
  );
}
