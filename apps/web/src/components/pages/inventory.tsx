import { useState } from "react";
import { Search, Package, AlertTriangle, Leaf, Download, ArrowRightLeft } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import { NavLink } from "react-router";

const inventoryData = [
  { id: 1, barcode: "978-0132350884", title: "Clean Code", warehouse: "WH-01", bin: "A3-2-05", qty: 45, minQty: 10, status: "in-stock", lastMoved: "2h ago" },
  { id: 2, barcode: "978-0201633610", title: "Design Patterns", warehouse: "WH-02", bin: "B1-4-12", qty: 12, minQty: 15, status: "low-stock", lastMoved: "1d ago" },
  { id: 3, barcode: "978-0596007126", title: "Head First Design Patterns", warehouse: "WH-01", bin: "A3-3-01", qty: 30, minQty: 10, status: "in-stock", lastMoved: "5h ago" },
  { id: 4, barcode: "978-0321125217", title: "Domain-Driven Design", warehouse: "WH-02", bin: "C2-1-08", qty: 8, minQty: 10, status: "low-stock", lastMoved: "3d ago" },
  { id: 5, barcode: "978-0596517748", title: "JavaScript: The Good Parts", warehouse: "WH-01", bin: "A5-1-03", qty: 0, minQty: 5, status: "out-of-stock", lastMoved: "7d ago" },
  { id: 6, barcode: "978-0321146533", title: "Test Driven Development", warehouse: "WH-03", bin: "A1-2-06", qty: 2, minQty: 5, status: "low-stock", lastMoved: "2d ago" },
  { id: 7, barcode: "978-0134685991", title: "Effective Java", warehouse: "WH-01", bin: "B2-3-10", qty: 22, minQty: 10, status: "in-stock", lastMoved: "6h ago" },
  { id: 8, barcode: "978-1491950296", title: "Programming Rust", warehouse: "WH-01", bin: "C1-1-04", qty: 18, minQty: 8, status: "in-stock", lastMoved: "1d ago" },
  { id: 9, barcode: "978-0131177055", title: "Working Effectively with Legacy Code", warehouse: "WH-01", bin: "D1-2-03", qty: 14, minQty: 8, status: "in-stock", lastMoved: "4h ago" },
  { id: 10, barcode: "978-0201485677", title: "Refactoring", warehouse: "WH-01", bin: "A1-1-02", qty: 35, minQty: 10, status: "in-stock", lastMoved: "3h ago" },
];

const warehouses = ["All Warehouses", "WH-01", "WH-02", "WH-03"];
const statusFilters = ["All", "In Stock", "Low Stock", "Out of Stock"];

export function InventoryPage() {
  const [whFilter, setWhFilter] = useState("All Warehouses");
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = inventoryData.filter(item => {
    if (whFilter !== "All Warehouses" && item.warehouse !== whFilter) return false;
    if (statusFilter === "In Stock" && item.status !== "in-stock") return false;
    if (statusFilter === "Low Stock" && item.status !== "low-stock") return false;
    if (statusFilter === "Out of Stock" && item.status !== "out-of-stock") return false;
    return true;
  }).filter(i => searchQuery === "" || i.title.toLowerCase().includes(searchQuery.toLowerCase()) || i.barcode.includes(searchQuery));

  const totalUnits = inventoryData.reduce((s, i) => s + i.qty, 0);
  const healthyCount = inventoryData.filter(i => i.status === "in-stock").length;
  const lowCount = inventoryData.filter(i => i.status === "low-stock").length;
  const outCount = inventoryData.filter(i => i.status === "out-of-stock").length;

  const healthData = [
    { name: "Healthy", value: healthyCount, color: "#10b981" },
    { name: "Low Stock", value: lowCount, color: "#f59e0b" },
    { name: "Out of Stock", value: outCount, color: "#ef4444" },
  ];

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-emerald-100 to-teal-50 flex items-center justify-center border border-emerald-200/40">
              <Package className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h1 className="tracking-[-0.02em]">Inventory</h1>
              <p className="text-[12px] text-slate-400 mt-0.5">{inventoryData.length} items · {totalUnits} total units</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={() => toast.success("Export started", { description: `${filtered.length} items` })} className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border border-emerald-100 bg-white text-emerald-700 text-[13px] hover:bg-emerald-50 transition-all shadow-sm" style={{ fontWeight: 550 }}>
              <Download className="w-3.5 h-3.5" /> Export
            </button>
            <NavLink to="/movements" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border border-blue-100 bg-white text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm" style={{ fontWeight: 550 }}>
              <ArrowRightLeft className="w-3.5 h-3.5" /> Movements
            </NavLink>
          </div>
        </div>
      </FadeItem>

      {/* Health Summary with Chart */}
      <FadeItem>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Units", val: totalUnits, color: "from-emerald-50 to-teal-50/50 border-emerald-100/60", textColor: "text-emerald-700", icon: Package, iconColor: "text-emerald-500" },
              { label: "Healthy", val: healthyCount, color: "from-green-50 to-emerald-50/50 border-green-100/60", textColor: "text-green-700", icon: Leaf, iconColor: "text-green-500" },
              { label: "Low Stock", val: lowCount, color: "from-amber-50 to-orange-50/50 border-amber-100/60", textColor: "text-amber-700", icon: AlertTriangle, iconColor: "text-amber-500" },
              { label: "Out of Stock", val: outCount, color: "from-rose-50 to-red-50/50 border-rose-100/60", textColor: "text-rose-700", icon: Package, iconColor: "text-rose-500" },
            ].map(s => (
              <motion.div key={s.label} whileHover={{ y: -2 }} className={`bg-gradient-to-br ${s.color} rounded-[12px] border p-4 flex items-center gap-3`}>
                <s.icon className={`w-5 h-5 ${s.iconColor}`} />
                <div>
                  <div className={`text-[20px] tracking-[-0.02em] ${s.textColor}`} style={{ fontWeight: 700, lineHeight: 1 }}>{s.val}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5" style={{ fontWeight: 500 }}>{s.label}</div>
                </div>
              </motion.div>
            ))}
          </div>
          <div className="bg-white rounded-[12px] border border-white/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-3 flex flex-col items-center justify-center">
            <div className="text-[11px] text-slate-400 mb-1" style={{ fontWeight: 550 }}>Health</div>
            <ResponsiveContainer width="100%" height={100}>
              <PieChart>
                <Pie data={healthData} cx="50%" cy="50%" innerRadius={28} outerRadius={42} paddingAngle={3} dataKey="value" strokeWidth={0}>
                  {healthData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 10, border: "1px solid #e2e4ed" }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex items-center gap-3 mt-1">
              {healthData.map(d => (
                <span key={d.name} className="flex items-center gap-1 text-[10px] text-slate-500">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />{d.value}
                </span>
              ))}
            </div>
          </div>
        </div>
      </FadeItem>

      {/* Filters */}
      <FadeItem>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search inventory..."
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-emerald-100/60 rounded-[10px] text-[13px] outline-none focus:ring-[3px] focus:ring-emerald-500/10 focus:border-emerald-300/60 transition-all shadow-sm" />
          </div>
          <select value={whFilter} onChange={(e) => setWhFilter(e.target.value)} className="px-3 py-2.5 bg-white border border-emerald-100/60 rounded-[10px] text-[13px] outline-none shadow-sm cursor-pointer">
            {warehouses.map(w => <option key={w}>{w}</option>)}
          </select>
          <div className="flex items-center gap-1 bg-white border border-slate-200/60 rounded-[10px] p-[3px] shadow-sm">
            {statusFilters.map(f => (
              <button key={f} onClick={() => setStatusFilter(f)} className={`relative px-3.5 py-1.5 rounded-[8px] text-[12px] transition-all duration-160 ${statusFilter === f ? "text-white" : "text-slate-500 hover:text-slate-700"}`} style={{ fontWeight: 550 }}>
                {statusFilter === f && <motion.div layoutId="inv-filter" className="absolute inset-0 rounded-[8px] bg-gradient-to-r from-emerald-600 to-teal-600 shadow-sm" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
                <span className="relative z-10">{f}</span>
              </button>
            ))}
          </div>
        </div>
      </FadeItem>

      {/* Table */}
      <FadeItem>
        <div className="bg-white rounded-[16px] border border-white/80 overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/40 to-transparent">
                {["Barcode", "Title", "Warehouse", "Location", "Qty", "Min", "Health", "Status", "Last Moved"].map(h => (
                  <th key={h} className={`${["Qty", "Min"].includes(h) ? "text-right" : "text-left"} text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]`} style={{ fontWeight: 550 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-14">
                  <Package className="w-8 h-8 text-emerald-300 mx-auto mb-2" />
                  <p className="text-[13px] text-slate-400">No inventory items found</p>
                </td></tr>
              ) : filtered.map((item, i) => {
                const healthPct = item.minQty > 0 ? Math.min(item.qty / item.minQty, 3) / 3 * 100 : 100;
                return (
                  <motion.tr key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                    className="border-b border-slate-50 last:border-0 hover:bg-gradient-to-r hover:from-emerald-50/30 hover:to-transparent transition-all duration-140 cursor-pointer">
                    <td className="px-5 py-3.5 text-[12px] font-mono text-slate-400">{item.barcode}</td>
                    <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 550 }}>{item.title}</td>
                    <td className="px-5 py-3.5 text-[13px]">{item.warehouse}</td>
                    <td className="px-5 py-3.5 text-[12px] font-mono text-slate-500">{item.bin}</td>
                    <td className="px-5 py-3.5 text-right text-[14px] font-mono" style={{ fontWeight: 700 }}>
                      <span className={item.qty === 0 ? "text-red-500" : item.qty <= item.minQty ? "text-amber-600" : "text-emerald-600"}>{item.qty}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right text-[13px] text-slate-400">{item.minQty}</td>
                    <td className="px-5 py-3.5">
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${healthPct}%` }} transition={{ duration: 0.6, ease: "easeOut", delay: i * 0.03 }}
                          className={`h-full rounded-full ${item.status === "out-of-stock" ? "bg-red-500" : item.status === "low-stock" ? "bg-amber-500" : "bg-emerald-500"}`} />
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge label={item.status === "in-stock" ? "Healthy" : item.status === "low-stock" ? "Low" : "Out"} variant={item.status === "in-stock" ? "success" : item.status === "low-stock" ? "warning" : "danger"} dot />
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-400">{item.lastMoved}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-[12px] text-slate-400">
            <span>Showing {filtered.length} of {inventoryData.length} items</span>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
