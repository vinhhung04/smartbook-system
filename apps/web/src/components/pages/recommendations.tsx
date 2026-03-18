import { useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { TrendingUp, AlertTriangle, Package, Zap, ArrowRight, Trash2, Sparkles } from "lucide-react";
import { BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { toast } from "sonner";

const recommendations = [
  { id: 1, priority: "high", category: "Restock", title: "Restock Clean Code", description: "Current stock is below optimal levels", action: "Create Receipt", estimatedSavings: "2.5M VND" },
  { id: 2, priority: "high", category: "Restock", title: "Restock Design Patterns", description: "Demand has exceeded supply", action: "Create Receipt", estimatedSavings: "1.8M VND" },
  { id: 3, priority: "medium", category: "Transfer", title: "Transfer Head First Design Patterns", description: "Rebalance inventory between warehouses", action: "Create Transfer", estimatedSavings: "0.8M VND" },
  { id: 4, priority: "medium", category: "Optimize", title: "Optimize Storage Layout", description: "Reorganize Zone A to improve efficiency", action: "Review Layout", estimatedSavings: "1.2M VND" },
  { id: 5, priority: "low", category: "Acquisition", title: "Add JavaScript: The Good Parts", description: "High demand but currently out of stock", action: "Order", estimatedSavings: "0.5M VND" },
];

const demandData = [
  { name: "Clean Code", demand: 65 },
  { name: "Design Patterns", demand: 52 },
  { name: "Head First", demand: 48 },
  { name: "Effective Java", demand: 42 },
  { name: "Refactoring", demand: 38 },
  { name: "TDD", demand: 35 },
];

const trendData = [
  { week: "Week 1", value: 420 },
  { week: "Week 2", value: 480 },
  { week: "Week 3", value: 510 },
  { week: "Week 4", value: 605 },
  { week: "Week 5", value: 720 },
  { week: "Week 6", value: 850 },
  { week: "Week 7", value: 920 },
  { week: "Week 8", value: 1050 },
];

export function RecommendationsPage() {
  const [dismissed, setDismissed] = useState([]);

  const handleDismiss = (id) => {
    setDismissed([...dismissed, id]);
    toast.info("Recommendation dismissed");
  };

  const visibleRecs = recommendations.filter(r => !dismissed.includes(r.id));

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-violet-100 to-purple-50 flex items-center justify-center border border-violet-200/40">
            <Sparkles className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h1 className="tracking-[-0.02em]">AI Recommendations</h1>
            <p className="text-[12px] text-slate-400 mt-0.5">Smart insights for inventory optimization</p>
          </div>
        </div>
      </FadeItem>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <FadeItem>
          <div className="bg-white rounded-[16px] border border-white/80 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
            <h3 className="text-[14px] mb-4" style={{ fontWeight: 650 }}>Top Demand Titles</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={demandData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" fontSize={11} stroke="#94a3b8" />
                <YAxis fontSize={11} stroke="#94a3b8" />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc" }} />
                <Bar dataKey="demand" radius={[8, 8, 0, 0]} fill="#6366f1">
                  {demandData.map((entry, i) => (
                    <Cell key={i} fill={["#6366f1", "#a78bfa", "#c7d2fe", "#ddd6fe", "#ede9fe", "#f5f3ff"][i % 6]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </FadeItem>

        <FadeItem>
          <div className="bg-white rounded-[16px] border border-white/80 p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
            <h3 className="text-[14px] mb-4" style={{ fontWeight: 650 }}>Demand Trend (8 weeks)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                <defs>
                  <linearGradient id="trend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="week" fontSize={11} stroke="#94a3b8" />
                <YAxis fontSize={11} stroke="#94a3b8" />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc" }} />
                <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} fill="url(#trend)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </FadeItem>
      </div>

      {/* Recommendations */}
      <FadeItem>
        <h3 className="text-[14px]" style={{ fontWeight: 650 }}>Active Recommendations</h3>
      </FadeItem>

      <div className="space-y-3">
        {visibleRecs.length === 0 ? (
          <div className="text-center py-8 bg-white rounded-[12px] border border-white/80">
            <TrendingUp className="w-8 h-8 text-violet-300 mx-auto mb-2" />
            <p className="text-[13px] text-slate-400">All recommendations have been reviewed</p>
          </div>
        ) : visibleRecs.map((rec, i) => (
          <motion.div key={rec.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
            className={`bg-white rounded-[12px] border p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-all ${rec.priority === "high" ? "border-rose-200/60 bg-gradient-to-r from-rose-50/40 to-orange-50/40" : rec.priority === "medium" ? "border-amber-200/60 bg-gradient-to-r from-amber-50/40 to-yellow-50/40" : "border-slate-200/60"}`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 ${rec.category === "Restock" ? "bg-gradient-to-br from-rose-500 to-red-500" : rec.category === "Transfer" ? "bg-gradient-to-br from-blue-500 to-indigo-500" : rec.category === "Optimize" ? "bg-gradient-to-br from-amber-500 to-orange-500" : "bg-gradient-to-br from-violet-500 to-purple-500"}`}>
                {rec.category === "Restock" && <AlertTriangle className="w-5 h-5 text-white" />}
                {rec.category === "Transfer" && <ArrowRight className="w-5 h-5 text-white" />}
                {rec.category === "Optimize" && <Zap className="w-5 h-5 text-white" />}
                {rec.category === "Acquisition" && <Package className="w-5 h-5 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between mb-1">
                  <h4 className="text-[13px]" style={{ fontWeight: 650 }}>{rec.title}</h4>
                  <span className={`px-2 py-1 rounded-full text-[10px] shrink-0 ${rec.priority === "high" ? "bg-rose-100 text-rose-700" : rec.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`} style={{ fontWeight: 550 }}>
                    {rec.priority.charAt(0).toUpperCase() + rec.priority.slice(1)}
                  </span>
                </div>
                <p className="text-[12px] text-slate-600 mb-2">{rec.description}</p>
                <div className="flex items-center gap-2 text-[11px] text-slate-500">
                  <span>Estimated savings: <span style={{ fontWeight: 600, color: "#059669" }}>{rec.estimatedSavings}</span></span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className="px-3 py-1.5 rounded-[8px] bg-slate-100 text-slate-700 text-[11px] hover:bg-slate-200 transition-all" style={{ fontWeight: 550 }}>
                  {rec.action}
                </button>
                <button onClick={() => handleDismiss(rec.id)} className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Summary Stats */}
      <FadeItem>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Active Recommendations", value: visibleRecs.length, color: "from-violet-50 to-purple-50/50 border-violet-100/60" },
            { label: "Total Savings Potential", value: "6.8M VND", color: "from-emerald-50 to-teal-50/50 border-emerald-100/60" },
            { label: "High Priority", value: recommendations.filter(r => r.priority === "high").length, color: "from-rose-50 to-red-50/50 border-rose-100/60" },
            { label: "Categories", value: [...new Set(recommendations.map(r => r.category))].length, color: "from-blue-50 to-indigo-50/50 border-blue-100/60" },
          ].map(s => (
            <div key={s.label} className={`bg-gradient-to-br ${s.color} rounded-[12px] border p-3`}>
              <p className="text-[11px] text-slate-500 mb-1" style={{ fontWeight: 550 }}>{s.label}</p>
              <p className="text-[22px] text-slate-700" style={{ fontWeight: 700, lineHeight: 1 }}>{s.value}</p>
            </div>
          ))}
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
