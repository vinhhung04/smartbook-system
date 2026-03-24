import { useEffect, useMemo, useState } from "react";
import { Package, Plus, Download, MoreVertical, ClipboardCheck } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { motion } from "motion/react";
import { NavLink } from "react-router";
import { goodsReceiptService, type GoodsReceipt } from "@/services/goods-receipt";
import { getApiErrorMessage } from "@/services/api.ts";
import { toast } from "sonner";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";

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
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-100 to-indigo-50 flex items-center justify-center border border-blue-200/40">
            <Package className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Goods Receipts</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">{receiptsData.length} receipts · {totalUnits} total items</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <NavLink to="/putaway" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-emerald-100 bg-white text-emerald-700 text-[13px] hover:bg-emerald-50 transition-all shadow-sm font-medium">
            <ClipboardCheck className="w-3.5 h-3.5" /> Putaway
          </NavLink>
          <button className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-blue-100 bg-white text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm font-medium">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <NavLink to="/orders/new" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[13px] shadow-md shadow-blue-500/15 hover:shadow-lg transition-all font-medium">
            <Plus className="w-3.5 h-3.5" /> New Receipt
          </NavLink>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <StatCard label="Draft" value={draftCount} variant="default" />
        <StatCard label="Posted" value={postedCount} variant="success" />
        <StatCard label="Total Items" value={totalUnits} variant="info" />
        <StatCard label="Posted Today" value={postedToday} variant="primary" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <FilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search by receipt or warehouse..."
          showSearchClear
          filters={
            <div className="flex items-center gap-1 bg-white border border-input rounded-lg p-[3px] shadow-sm">
              {["All", "Draft", "Posted", "Cancelled"].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} className={`relative px-3.5 py-1.5 rounded-lg text-[12px] transition-all duration-160 font-medium ${statusFilter === s ? "text-white" : "text-muted-foreground hover:text-foreground"}`}>
                  {statusFilter === s && <motion.div layoutId="orders-status-filter" className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
                  <span className="relative z-10">{s}</span>
                </button>
              ))}
            </div>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <SectionCard noPadding>
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {["Receipt ID", "Warehouse", "Status", "Created By", "Date", "Items", "Total", "Action"].map(h => (
                  <th key={h} className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-14 text-[13px] text-muted-foreground">Loading receipts...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8}><EmptyState variant="no-data" title="No receipts found" description="Try adjusting your search or filters" className="py-12" /></td></tr>
              ) : filtered.map((r, i) => (
                <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-5 py-3.5">
                    <NavLink to={`/orders/${r.id}`} className="text-[13px] text-indigo-600 hover:text-indigo-800 font-medium">{r.receipt_number}</NavLink>
                  </td>
                  <td className="px-5 py-3.5 text-[13px]">{r.warehouse_code || r.warehouse_name || "-"}</td>
                  <td className="px-5 py-3.5">
                    <StatusBadge label={r.status} variant={r.status === "DRAFT" ? "info" : r.status === "POSTED" ? "success" : "danger"} dot />
                  </td>
                  <td className="px-5 py-3.5 text-[13px] text-muted-foreground">{r.received_by_user_id?.slice(0, 8) || "-"}</td>
                  <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatDate(r.created_at)}</td>
                  <td className="px-5 py-3.5 text-[13px] font-medium">{r.item_count}</td>
                  <td className="px-5 py-3.5 text-[13px] font-mono font-medium">{formatCurrency(r.total_amount || 0)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <button className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground">
            <span>Showing {filtered.length} of {receiptsData.length} receipts</span>
            <div className="flex items-center gap-1">
              <button className="px-2 py-1 rounded text-muted-foreground cursor-default">1</button>
              <button className="px-2 py-1 rounded text-muted-foreground cursor-default">2</button>
              <button className="px-3 py-1 rounded border border-input text-blue-600 cursor-pointer hover:bg-blue-50">Next</button>
            </div>
          </div>
        </SectionCard>
      </motion.div>
    </div>
  );
}
