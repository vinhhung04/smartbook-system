import { KpiCard } from "../kpi-card";
import { StatusBadge } from "../status-badge";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { BookOpen, Package, AlertTriangle, PackageX, FileText, CheckCircle, ScanBarcode, Plus, Sparkles, ArrowRight, Clock, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from "recharts";
import { NavLink } from "react-router";

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

const recentMovements = [
  { id: "SM-001", book: "Clean Code", type: "Inbound", qty: "+25", warehouse: "WH-01", time: "2 min ago", variant: "success" as const },
  { id: "SM-002", book: "Design Patterns", type: "Outbound", qty: "-10", warehouse: "WH-02", time: "15 min ago", variant: "danger" as const },
  { id: "SM-003", book: "The Pragmatic Programmer", type: "Transfer", qty: "8", warehouse: "WH-01 → WH-03", time: "1h ago", variant: "info" as const },
  { id: "SM-004", book: "Refactoring", type: "Inbound", qty: "+50", warehouse: "WH-01", time: "2h ago", variant: "success" as const },
  { id: "SM-005", book: "Domain-Driven Design", type: "Adjustment", qty: "-3", warehouse: "WH-02", time: "3h ago", variant: "warning" as const },
];

const alerts = [
  { message: "12 books below minimum stock threshold", type: "warning" as const, icon: AlertTriangle, bgTint: "bg-amber-50/80 border-amber-100/60" },
  { message: "3 draft receipts pending approval", type: "info" as const, icon: FileText, bgTint: "bg-sky-50/80 border-sky-100/60" },
  { message: "2 overdue borrows need attention", type: "danger" as const, icon: Clock, bgTint: "bg-rose-50/80 border-rose-100/60" },
];

export function DashboardPage() {
  return (
    <PageWrapper className="space-y-6">
      {/* Hero Header */}
      <FadeItem>
        <div className="relative overflow-hidden rounded-[16px] bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 p-6 shadow-lg shadow-indigo-500/15">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.12)_0%,transparent_50%)]" />
          <div className="absolute top-0 right-0 w-60 h-60 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3" />
          <div className="relative flex items-center justify-between">
            <div className="text-white">
              <h1 className="tracking-[-0.03em] text-white" style={{ fontWeight: 700 }}>Good afternoon, Admin</h1>
              <p className="text-white/65 text-[13px] mt-1">Wednesday, Mar 18, 2026 — Operational overview</p>
            </div>
            <div className="flex items-center gap-2.5">
              <NavLink to="/orders/new" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[11px] bg-white text-indigo-700 text-[13px] shadow-md hover:shadow-lg hover:bg-indigo-50 active:scale-[0.98] transition-all duration-140" style={{ fontWeight: 600 }}>
                <ScanBarcode className="w-4 h-4" /> New Receipt
              </NavLink>
            </div>
          </div>
        </div>
      </FadeItem>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard title="Total Titles" value="2,847" numericValue={2847} change="+12" icon={BookOpen} trend="up" tintFrom="from-blue-50/60" tintTo="to-indigo-50/30" iconBg="bg-blue-100" iconColor="text-blue-600" accentBorder="from-blue-500 to-indigo-500" />
        <KpiCard title="Total Units" value="45,230" numericValue={45230} change="+340" icon={Package} trend="up" tintFrom="from-emerald-50/60" tintTo="to-teal-50/30" iconBg="bg-emerald-100" iconColor="text-emerald-600" accentBorder="from-emerald-500 to-teal-500" />
        <KpiCard title="Low Stock" value="12" numericValue={12} change="↑ 3" icon={AlertTriangle} trend="down" tintFrom="from-amber-50/60" tintTo="to-orange-50/20" iconBg="bg-amber-100" iconColor="text-amber-600" accentBorder="from-amber-500 to-orange-500" />
        <KpiCard title="Out of Stock" value="4" numericValue={4} icon={PackageX} tintFrom="from-rose-50/60" tintTo="to-red-50/20" iconBg="bg-rose-100" iconColor="text-rose-600" accentBorder="from-rose-500 to-red-500" />
        <KpiCard title="Draft Receipts" value="7" numericValue={7} icon={FileText} tintFrom="from-sky-50/60" tintTo="to-cyan-50/20" iconBg="bg-sky-100" iconColor="text-sky-600" accentBorder="from-sky-500 to-cyan-500" />
        <KpiCard title="Posted Today" value="3" numericValue={3} change="+1" icon={CheckCircle} trend="up" tintFrom="from-violet-50/60" tintTo="to-purple-50/20" iconBg="bg-violet-100" iconColor="text-violet-600" accentBorder="from-violet-500 to-purple-500" />
      </div>

      {/* Quick Actions */}
      <FadeItem>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Scan & Receive", icon: ScanBarcode, to: "/orders/new", style: "bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 text-white shadow-lg shadow-indigo-500/15 hover:shadow-xl hover:shadow-indigo-500/25" },
            { label: "Add Book", icon: Plus, to: "/catalog", style: "bg-white text-blue-700 border border-blue-100 shadow-sm hover:border-blue-200 hover:shadow-md hover:shadow-blue-500/5" },
            { label: "View Inventory", icon: Package, to: "/inventory", style: "bg-white text-emerald-700 border border-emerald-100 shadow-sm hover:border-emerald-200 hover:shadow-md hover:shadow-emerald-500/5" },
            { label: "AI Import", icon: Sparkles, to: "/ai-import", style: "bg-white text-cyan-700 border border-cyan-100 shadow-sm hover:border-cyan-200 hover:shadow-md hover:shadow-cyan-500/5" },
          ].map((a) => (
            <motion.div key={a.label} whileHover={{ y: -2 }} transition={{ duration: 0.14 }}>
              <NavLink to={a.to} className={`flex items-center gap-3 px-4 py-3.5 rounded-[12px] text-[13px] transition-all duration-140 ${a.style}`} style={{ fontWeight: 550 }}>
                <a.icon className="w-4.5 h-4.5" /> {a.label}
              </NavLink>
            </motion.div>
          ))}
        </div>
      </FadeItem>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Chart */}
        <FadeItem className="lg:col-span-2">
          <div className="bg-white rounded-[16px] border border-white/80 p-6 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-[15px] tracking-[-0.01em]" style={{ fontWeight: 650 }}>Stock Movement</h3>
                <p className="text-[12px] text-slate-400 mt-0.5">This week's inventory flow</p>
              </div>
              <div className="flex items-center gap-5 text-[11px]">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-r from-indigo-500 to-blue-500" /> Inbound</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px] bg-gradient-to-r from-cyan-500 to-teal-500" /> Outbound</span>
              </div>
            </div>
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
          </div>
        </FadeItem>

        {/* Alerts + AI */}
        <FadeItem>
          <div className="space-y-5">
            {/* Alerts */}
            <div className="bg-white rounded-[16px] border border-white/80 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
              <h3 className="text-[14px] mb-3" style={{ fontWeight: 650 }}>Alerts</h3>
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.06, duration: 0.28 }}
                    className={`flex items-start gap-2.5 p-3 rounded-[11px] border hover:shadow-sm cursor-pointer transition-all duration-140 ${a.bgTint}`}>
                    <a.icon className={`w-4 h-4 mt-0.5 shrink-0 ${a.type === "warning" ? "text-amber-500" : a.type === "danger" ? "text-rose-500" : "text-sky-500"}`} />
                    <span className="text-[12px]" style={{ lineHeight: 1.5 }}>{a.message}</span>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* AI Insights */}
            <div className="relative overflow-hidden rounded-[16px] border border-cyan-100/60 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
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
        </FadeItem>
      </div>

      {/* Recent Movements */}
      <FadeItem>
        <div className="bg-white rounded-[16px] border border-white/80 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-[8px] bg-blue-100 flex items-center justify-center">
                <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
              </div>
              <h3 className="text-[14px]" style={{ fontWeight: 650 }}>Recent Stock Movements</h3>
            </div>
            <NavLink to="/movements" className="text-[12px] text-indigo-600 hover:underline" style={{ fontWeight: 550 }}>View all</NavLink>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-t border-b border-slate-100">
                  {["ID", "Book", "Type", "Qty", "Warehouse", "Time"].map((h, i) => (
                    <th key={h} className={`${i === 5 ? "text-right" : "text-left"} text-[11px] text-slate-400 px-6 py-2.5 uppercase tracking-[0.05em]`} style={{ fontWeight: 550 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentMovements.map((m, i) => (
                  <motion.tr key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04, duration: 0.28 }}
                    className="border-b border-slate-50 last:border-0 hover:bg-gradient-to-r hover:from-indigo-50/30 hover:to-transparent transition-all duration-140 cursor-pointer">
                    <td className="px-6 py-3.5 text-[13px]" style={{ fontWeight: 550 }}>{m.id}</td>
                    <td className="px-6 py-3.5 text-[13px]">{m.book}</td>
                    <td className="px-6 py-3.5"><StatusBadge label={m.type} variant={m.variant} dot /></td>
                    <td className="px-6 py-3.5 text-[13px] font-mono" style={{ fontWeight: 550 }}>{m.qty}</td>
                    <td className="px-6 py-3.5 text-[13px] text-slate-500">{m.warehouse}</td>
                    <td className="px-6 py-3.5 text-[12px] text-slate-400 text-right">{m.time}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
