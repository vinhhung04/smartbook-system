import { useEffect, useMemo, useState } from "react";
import { Search, Package, Plus, Download, MoreVertical, ClipboardCheck } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { NavLink } from "react-router";
import { goodsReceiptService, type GoodsReceipt } from "@/services/goods-receipt";
import { getApiErrorMessage } from "@/services/api.ts";
import { toast } from "sonner";

function formatCurrency(value: number): string {
  return `${value.toLocaleString("vi-VN")} VND`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrdersPage() {
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [receiptsData, setReceiptsData] = useState<GoodsReceipt[]>([]);

  useEffect(() => {
    const fetchReceipts = async () => {
      try {
        setLoading(true);
        const data = await goodsReceiptService.getAll();
        setReceiptsData(Array.isArray(data) ? data : []);
      } catch (error) {
        toast.error(getApiErrorMessage(error, "Failed to load goods receipts"));
      } finally {
        setLoading(false);
      }
    };

    fetchReceipts();
  }, []);

  const filtered = useMemo(() => receiptsData.filter((r) => {
    if (statusFilter === "Draft" && r.status !== "DRAFT") return false;
    if (statusFilter === "Posted" && r.status !== "POSTED") return false;
    if (statusFilter === "Cancelled" && r.status !== "CANCELLED") return false;
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      r.receipt_number.toLowerCase().includes(query)
      || (r.warehouse_code || "").toLowerCase().includes(query)
      || (r.warehouse_name || "").toLowerCase().includes(query)
    );
  }), [receiptsData, statusFilter, searchQuery]);

  const draftCount = receiptsData.filter(r => r.status === "DRAFT").length;
  const postedCount = receiptsData.filter(r => r.status === "POSTED").length;
  const totalUnits = receiptsData.reduce((s, r) => s + r.item_count, 0);

  const postedToday = receiptsData.filter((r) => {
    if (r.status !== "POSTED") return false;
    const d = new Date(r.created_at);
    const now = new Date();
    return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-blue-100 to-indigo-50 flex items-center justify-center border border-blue-200/40">
              <Package className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h1 className="tracking-[-0.02em]">Goods Receipts</h1>
              <p className="text-[12px] text-slate-400 mt-0.5">{receiptsData.length} receipts · {totalUnits} total items</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <NavLink to="/putaway" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border border-emerald-100 bg-white text-emerald-700 text-[13px] hover:bg-emerald-50 transition-all shadow-sm" style={{ fontWeight: 550 }}>
              <ClipboardCheck className="w-3.5 h-3.5" /> Putaway
            </NavLink>
            <button className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border border-blue-100 bg-white text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm" style={{ fontWeight: 550 }}>
              <Download className="w-3.5 h-3.5" /> Export
            </button>
            <NavLink to="/orders/new" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] shadow-md shadow-blue-500/15 hover:shadow-lg transition-all" style={{ fontWeight: 550 }}>
              <Plus className="w-3.5 h-3.5" /> New Receipt
            </NavLink>
          </div>
        </div>
      </FadeItem>

      {/* Summary KPIs */}
      <FadeItem>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Draft", val: draftCount, color: "from-slate-50 to-slate-50/50 border-slate-100/60", textColor: "text-slate-700", num: "text-slate-600" },
            { label: "Posted", val: postedCount, color: "from-emerald-50 to-teal-50/50 border-emerald-100/60", textColor: "text-emerald-700", num: "text-emerald-600" },
            { label: "Total Items", val: totalUnits, color: "from-blue-50 to-indigo-50/50 border-blue-100/60", textColor: "text-blue-700", num: "text-blue-600" },
              { label: "Posted Today", val: postedToday, color: "from-violet-50 to-purple-50/50 border-violet-100/60", textColor: "text-violet-700", num: "text-violet-600" },
          ].map(s => (
            <motion.div key={s.label} whileHover={{ y: -2 }} className={`bg-gradient-to-br ${s.color} rounded-[12px] border p-3`}>
              <div className={`text-[28px] tracking-[-0.02em] ${s.num}`} style={{ fontWeight: 700, lineHeight: 1 }}>{s.val}</div>
              <div className="text-[11px] text-slate-500 mt-1" style={{ fontWeight: 500 }}>{s.label}</div>
            </motion.div>
          ))}
        </div>
      </FadeItem>

      {/* Filters */}
      <FadeItem>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search by receipt or warehouse..."
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-blue-100/60 rounded-[10px] text-[13px] outline-none focus:ring-[3px] focus:ring-blue-500/10 focus:border-blue-300/60 transition-all shadow-sm" />
          </div>
          <div className="flex items-center gap-1 bg-white border border-slate-200/60 rounded-[10px] p-[3px] shadow-sm">
            {["All", "Draft", "Posted", "Cancelled"].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} className={`relative px-3.5 py-1.5 rounded-[8px] text-[12px] transition-all duration-160 ${statusFilter === s ? "text-white" : "text-slate-500 hover:text-slate-700"}`} style={{ fontWeight: 550 }}>
                {statusFilter === s && <motion.div layoutId="orders-status-filter" className="absolute inset-0 rounded-[8px] bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
                <span className="relative z-10">{s}</span>
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
              <tr className="border-b border-slate-100 bg-gradient-to-r from-blue-50/40 to-transparent">
                {["Receipt ID", "Warehouse", "Status", "Created By", "Date", "Items", "Total", "Action"].map(h => (
                  <th key={h} className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-14">
                  <p className="text-[13px] text-slate-400">Loading receipts...</p>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-14">
                  <Package className="w-8 h-8 text-blue-300 mx-auto mb-2" />
                  <p className="text-[13px] text-slate-400">No receipts found</p>
                </td></tr>
              ) : filtered.map((r, i) => (
                <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  className="border-b border-slate-50 last:border-0 hover:bg-gradient-to-r hover:from-blue-50/30 hover:to-transparent transition-all">
                  <td className="px-5 py-3.5">
                    <NavLink to={`/orders/${r.id}`} className="text-[13px] text-indigo-600 hover:text-indigo-800" style={{ fontWeight: 550 }}>{r.receipt_number}</NavLink>
                  </td>
                  <td className="px-5 py-3.5 text-[13px]">{r.warehouse_code || r.warehouse_name || "-"}</td>
                  <td className="px-5 py-3.5">
                    <StatusBadge label={r.status} variant={r.status === "DRAFT" ? "info" : r.status === "POSTED" ? "success" : "danger"} dot />
                  </td>
                  <td className="px-5 py-3.5 text-[13px] text-slate-500">{r.received_by_user_id?.slice(0, 8) || "-"}</td>
                  <td className="px-5 py-3.5 text-[12px] text-slate-400">{formatDate(r.created_at)}</td>
                  <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 550 }}>{r.item_count}</td>
                  <td className="px-5 py-3.5 text-[13px] font-mono" style={{ fontWeight: 550 }}>{formatCurrency(r.total_amount || 0)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <button className="inline-flex items-center justify-center w-8 h-8 rounded-[8px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-[12px] text-slate-400">
            <span>Showing {filtered.length} of {receiptsData.length} receipts</span>
            <div className="flex items-center gap-1">
              <button className="px-2 py-1 rounded text-slate-400 cursor-default">1</button>
              <button className="px-2 py-1 rounded text-slate-400 cursor-default">2</button>
              <button className="px-3 py-1 rounded border border-slate-200 text-blue-600 cursor-pointer hover:bg-blue-50">Next</button>
            </div>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
