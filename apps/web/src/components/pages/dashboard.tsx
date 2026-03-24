import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router';
import { motion } from 'motion/react';
import {
  LayoutDashboard, BookOpen, Package, AlertTriangle, PackageX, FileText,
  CheckCircle, ScanBarcode, Plus, Sparkles, ArrowRight, Clock, TrendingUp,
  RefreshCw
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from 'recharts';
import { StatCard } from '@/components/ui/stat-card';
import { SectionCard } from '@/components/ui/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { stockMovementService } from '@/services/stock-movement';
import { bookService } from '@/services/book';
import { goodsReceiptService } from '@/services/goods-receipt';
import { borrowService } from '@/services/borrow';
import { getApiErrorMessage } from '@/services/api';
import { toast } from 'sonner';

const chartData = [
  { name: "Mon", inbound: 42, outbound: 18 },
  { name: "Tue", inbound: 35, outbound: 24 },
  { name: "Wed", inbound: 58, outbound: 30 },
  { name: "Thu", inbound: 44, outbound: 22 },
  { name: "Fri", inbound: 67, outbound: 35 },
  { name: "Sat", inbound: 28, outbound: 12 },
  { name: "Sun", inbound: 15, outbound: 8 },
];

const trendData = [
  { day: "1", v: 30 }, { day: "2", v: 35 }, { day: "3", v: 28 }, { day: "4", v: 42 },
  { day: "5", v: 38 }, { day: "6", v: 55 }, { day: "7", v: 48 }, { day: "8", v: 62 },
  { day: "9", v: 57 }, { day: "10", v: 70 }, { day: "11", v: 65 }, { day: "12", v: 72 },
];

export function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [kpi, setKpi] = useState({
    totalTitles: 0,
    totalUnits: 0,
    lowStock: 0,
    outOfStock: 0,
    draftReceipts: 0,
    postedToday: 0,
    overdueBorrows: 0,
  });
  const [recentMovements, setRecentMovements] = useState<any[]>([]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const [bookResp, receiptResp, borrowResp, movementResp] = await Promise.allSettled([
        bookService.getAll(),
        goodsReceiptService.getAll({ pageSize: 50 }),
        borrowService.getLoans({ pageSize: 50 }),
        stockMovementService.getAll({ pageSize: 5 }),
      ]);

      let totalUnits = 0;
      let totalTitles = 0;
      let lowStock = 0;
      let outOfStock = 0;

      if (bookResp.status === 'fulfilled') {
        const books = Array.isArray(bookResp.value) ? bookResp.value : [];
        totalTitles = books.length;
        totalUnits = books.reduce((sum: number, b: any) => sum + Number(b.quantity || 0), 0);
        lowStock = books.filter((b: any) => Number(b.quantity || 0) > 0 && Number(b.quantity || 0) <= 10).length;
        outOfStock = books.filter((b: any) => Number(b.quantity || 0) === 0).length;
      }

      let draftReceipts = 0;
      let postedToday = 0;
      const today = new Date().toDateString();
      if (receiptResp.status === 'fulfilled') {
        const receipts = Array.isArray(receiptResp.value) ? receiptResp.value : [];
        draftReceipts = receipts.filter((r: any) => r.status === 'DRAFT').length;
        postedToday = receipts.filter((r: any) => {
          const d = new Date(r.updated_at || r.created_at).toDateString();
          return d === today && r.status === 'POSTED';
        }).length;
      }

      let overdueBorrows = 0;
      if (borrowResp.status === 'fulfilled') {
        const loans = Array.isArray(borrowResp.value?.data) ? borrowResp.value.data : [];
        overdueBorrows = loans.filter((l: any) => l.status === 'OVERDUE').length;
      }

      setKpi({ totalTitles, totalUnits, lowStock, outOfStock, draftReceipts, postedToday, overdueBorrows });

      if (movementResp.status === 'fulfilled') {
        setRecentMovements(Array.isArray(movementResp.value) ? movementResp.value.slice(0, 5) : []);
      }
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load dashboard'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadDashboard(); }, []);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Hero Header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 p-6 shadow-xl shadow-indigo-500/20"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.12)_0%,transparent_50%)]" />
        <div className="absolute top-0 right-0 w-60 h-60 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="text-white">
            <h1 className="tracking-[-0.03em] text-white" style={{ fontWeight: 700, fontSize: 22 }}>
              Good afternoon, Admin
            </h1>
            <p className="text-white/65 text-[13px] mt-1">
              {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — Operational overview
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2.5">
            <NavLink to="/orders/new" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-indigo-700 text-[13px] shadow-md hover:shadow-lg hover:bg-indigo-50 active:scale-[0.98] transition-all" style={{ fontWeight: 600 }}>
              <ScanBarcode className="w-4 h-4" /> New Receipt
            </NavLink>
          </div>
        </div>
      </motion.div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, duration: 0.3 }}>
          <StatCard label="Total Titles" value={kpi.totalTitles} change={`+${Math.max(0, kpi.totalTitles - 2800)}`} trend="up" icon={BookOpen} variant="default" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.3 }}>
          <StatCard label="Total Units" value={kpi.totalUnits} change="+340" trend="up" icon={Package} variant="success" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.3 }}>
          <StatCard label="Low Stock" value={kpi.lowStock} change={`↑ ${kpi.lowStock}`} trend="down" icon={AlertTriangle} variant="warning" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.3 }}>
          <StatCard label="Out of Stock" value={kpi.outOfStock} icon={PackageX} variant="danger" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.3 }}>
          <StatCard label="Draft Receipts" value={kpi.draftReceipts} icon={FileText} variant="info" />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.3 }}>
          <StatCard label="Posted Today" value={kpi.postedToday} change={`+${kpi.postedToday}`} trend="up" icon={CheckCircle} variant="primary" />
        </motion.div>
      </div>

      {/* Quick Actions */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.3 }}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Scan & Receive", icon: ScanBarcode, to: "/orders/new", style: "bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 text-white shadow-lg shadow-indigo-500/15 hover:shadow-xl hover:shadow-indigo-500/25" },
            { label: "Add Book", icon: Plus, to: "/catalog", style: "bg-white text-blue-700 border border-blue-100 shadow-sm hover:border-blue-200 hover:shadow-md hover:shadow-blue-500/5" },
            { label: "View Inventory", icon: Package, to: "/inventory", style: "bg-white text-emerald-700 border border-emerald-100 shadow-sm hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-500/5" },
            { label: "AI Import", icon: Sparkles, to: "/ai-import", style: "bg-white text-cyan-700 border border-cyan-100 shadow-sm hover:border-cyan-200 hover:shadow-md hover:shadow-cyan-500/5" },
          ].map((a) => (
            <motion.div key={a.label} whileHover={{ y: -2 }} transition={{ duration: 0.14 }}>
              <NavLink to={a.to} className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-[13px] transition-all duration-140 ${a.style}`} style={{ fontWeight: 550 }}>
                <a.icon className="w-4.5 h-4.5" /> {a.label}
              </NavLink>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Chart + Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chart */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.3 }} className="lg:col-span-2">
          <SectionCard
            title="Stock Movement"
            subtitle="This week's inventory flow"
            actions={
              <span className="flex items-center gap-4 text-[11px]">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-r from-indigo-500 to-blue-500" /> Inbound</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-r from-cyan-500 to-teal-500" /> Outbound</span>
              </span>
            }
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} barGap={4} barSize={20}>
                <defs>
                  <linearGradient id="inboundGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                  <linearGradient id="outboundGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" />
                    <stop offset="100%" stopColor="#14b8a6" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f1f5" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={32} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: "1px solid #e2e4ed", boxShadow: "0 8px 24px rgba(0,0,0,0.1)", padding: "8px 12px" }} cursor={{ fill: "rgba(79,70,229,0.04)" }} />
                <Bar key="bar-inbound" dataKey="inbound" fill="url(#inboundGrad)" radius={[6, 6, 2, 2]} />
                <Bar key="bar-outbound" dataKey="outbound" fill="url(#outboundGrad)" radius={[6, 6, 2, 2]} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        </motion.div>

        {/* Alerts + AI */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.3 }}>
          <div className="space-y-4">
            {/* Alerts */}
            <SectionCard title="Alerts" subtitle="Items requiring attention">
              <div className="space-y-2">
                {[
                  { message: `${kpi.lowStock} books below minimum stock threshold`, type: "warning" as const, icon: AlertTriangle, color: "text-amber-500", bg: "bg-amber-50/80 border-amber-100/60" },
                  { message: `${kpi.draftReceipts} draft receipts pending approval`, type: "info" as const, icon: FileText, color: "text-sky-500", bg: "bg-sky-50/80 border-sky-100/60" },
                  { message: `${kpi.overdueBorrows} overdue borrows need attention`, type: "danger" as const, icon: Clock, color: "text-rose-500", bg: "bg-rose-50/80 border-rose-100/60" },
                ].map((a, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.06, duration: 0.28 }}
                    className={`flex items-start gap-2.5 p-3 rounded-xl border hover:shadow-sm cursor-pointer transition-all duration-140 ${a.bg}`}>
                    <a.icon className={`w-4 h-4 mt-0.5 shrink-0 ${a.color}`} />
                    <span className="text-[12px]" style={{ lineHeight: 1.5 }}>{a.message}</span>
                  </motion.div>
                ))}
              </div>
            </SectionCard>

            {/* AI Insights */}
            <div className="relative overflow-hidden rounded-xl border border-cyan-100/60 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-50/90 via-blue-50/50 to-violet-50/40" />
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-cyan-200/20 to-transparent rounded-full -translate-y-1/2 translate-x-1/4" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-[8px] bg-gradient-to-br from-cyan-500/20 to-violet-500/15 flex items-center justify-center border border-cyan-200/40">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-600" />
                  </div>
                  <span className="text-[12px] text-cyan-700" style={{ fontWeight: 650 }}>AI Insights</span>
                </div>
                <p className="text-[12px] text-slate-600" style={{ lineHeight: 1.6 }}>5 books have high demand signals. Consider restocking "Clean Code" and "The Pragmatic Programmer" this week.</p>
                <NavLink to="/recommendations" className="inline-flex items-center gap-1 text-[11px] text-indigo-600 mt-3 hover:underline" style={{ fontWeight: 550 }}>
                  View recommendations <ArrowRight className="w-3 h-3" />
                </NavLink>
                <div className="mt-3">
                  <ResponsiveContainer width="100%" height={48}>
                    <AreaChart data={trendData}>
                      <defs>
                        <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="v" stroke="#06b6d4" strokeWidth={2} fill="url(#trendGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Recent Stock Movements */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.3 }}>
        <SectionCard
          title="Recent Stock Movements"
          subtitle="Latest inventory changes"
          actions={
            <div className="flex items-center gap-2">
              <button onClick={() => void loadDashboard()} className="inline-flex items-center gap-1.5 h-8 rounded-lg border border-input bg-background px-3 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" style={{ fontWeight: 500 }}>
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <NavLink to="/movements" className="text-[12px] text-primary font-medium hover:underline">
                View all
              </NavLink>
            </div>
          }
        >
          {recentMovements.length === 0 ? (
            <EmptyState variant="no-data" title="No recent movements" description="Stock movement records will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["ID", "Book", "Type", "Qty", "Warehouse", "Time"].map((h, i) => (
                      <th key={h} className={`${i === 5 ? "text-right" : "text-left"} text-[11px] text-muted-foreground uppercase tracking-wider px-5 py-3`} style={{ fontWeight: 550 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentMovements.map((m, i) => (
                    <motion.tr key={m.id || i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04, duration: 0.28 }}
                      className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors cursor-pointer">
                      <td className="px-5 py-3.5 text-[13px] font-mono" style={{ fontWeight: 550 }}>{m.id || `SM-${String(i + 1).padStart(3, '0')}`}</td>
                      <td className="px-5 py-3.5 text-[13px]">{m.book_title || m.reference_type || '-'}</td>
                      <td className="px-5 py-3.5">
                        <StatusBadge label={m.movement_type || 'Transfer'} variant={
                          m.movement_type === 'INBOUND' ? 'success' :
                          m.movement_type === 'OUTBOUND' ? 'danger' :
                          m.movement_type === 'TRANSFER' ? 'info' : 'warning'
                        } dot />
                      </td>
                      <td className="px-5 py-3.5 text-[13px] font-mono" style={{ fontWeight: 550 }}>
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-muted-foreground">{m.warehouse_name || m.warehouse_id || '-'}</td>
                      <td className="px-5 py-3.5 text-[12px] text-muted-foreground text-right">
                        {m.created_at ? new Date(m.created_at).toLocaleString('vi-VN') : '-'}
                      </td>
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
