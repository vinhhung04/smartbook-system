import { useEffect, useMemo, useState } from "react";
import { Search, Package, AlertTriangle, Leaf, Download, ArrowRightLeft } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion } from "motion/react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api";

interface InventoryLocation {
  warehouse_id?: string;
  warehouse_name: string;
  location_code: string;
  quantity: number;
  label: string;
}

interface InventoryBook {
  id: string;
  title: string;
  isbn: string;
  category: string;
  quantity: number;
  location: string;
  locations?: InventoryLocation[];
  updated_at: string;
}

/** One table row = one book in one warehouse (qty is only for that warehouse). */
interface InventoryWarehouseRow extends InventoryBook {
  rowKey: string;
  /** Filter key: real `warehouse_id` UUID, or `__name:...` if API had no id, or `__none__`. */
  warehouseId: string;
  warehouseName: string;
  warehouseQty: number;
  locationSummary: string;
}

const statusFilters = ["All", "In Stock", "Low Stock", "Out of Stock"];

function getStockStatus(quantity: number) {
  if (quantity <= 0) return "out-of-stock";
  if (quantity <= 5) return "low-stock";
  return "in-stock";
}

function formatUpdatedTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN");
}

function summarizeLocationCodes(locs: InventoryLocation[]): string {
  if (locs.length === 0) return "-";
  const sorted = [...locs].sort((a, b) => b.quantity - a.quantity || a.location_code.localeCompare(b.location_code));
  const first = sorted[0];
  return sorted.length > 1 ? `${first.location_code} +${sorted.length - 1}` : first.location_code;
}

/** Split each book into one row per warehouse using `locations` from API. */
function expandBooksByWarehouse(data: InventoryBook[]): InventoryWarehouseRow[] {
  const rows: InventoryWarehouseRow[] = [];
  for (const item of data) {
    const locs = item.locations || [];
    /** Group by warehouse_id when present so filter matches API data reliably. */
    const byWh = new Map<string, { name: string; locs: InventoryLocation[] }>();
    for (const loc of locs) {
      const wid = loc.warehouse_id ? String(loc.warehouse_id) : "";
      const key = wid || `__name:${loc.warehouse_name || "Unknown"}`;
      const displayName = loc.warehouse_name || "Unknown";
      if (!byWh.has(key)) {
        byWh.set(key, { name: displayName, locs: [] });
      }
      byWh.get(key)!.locs.push(loc);
    }
    if (byWh.size === 0) {
      rows.push({
        ...item,
        rowKey: `${item.id}::__none__`,
        warehouseId: "__none__",
        warehouseName: "-",
        warehouseQty: 0,
        locationSummary: "-",
      });
      continue;
    }
    for (const [key, { name: whName, locs: whLocs }] of byWh) {
      const warehouseQty = whLocs.reduce((s, l) => s + Number(l.quantity || 0), 0);
      rows.push({
        ...item,
        rowKey: `${item.id}::${key}`,
        warehouseId: key,
        warehouseName: whName,
        warehouseQty,
        locationSummary: summarizeLocationCodes(whLocs),
      });
    }
  }
  return rows;
}

export function InventoryPage() {
  const [data, setData] = useState<InventoryBook[]>([]);
  const [loading, setLoading] = useState(true);
  /** `"all"` or warehouse UUID from `stock_balances.warehouse_id` */
  const [whFilterId, setWhFilterId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const loadInventory = async () => {
    try {
      setLoading(true);
      const response = await bookService.getAll();
      setData((response || []) as InventoryBook[]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Khong tai duoc du lieu ton kho"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInventory();
  }, []);

  const expandedRows = useMemo(() => expandBooksByWarehouse(data), [data]);

  const warehouseOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of expandedRows) {
      if (row.warehouseId === "__none__") continue;
      map.set(row.warehouseId, row.warehouseName);
    }
    const sorted = Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "vi"));
    return [{ value: "all", label: "All Warehouses" }, ...sorted.map(([value, label]) => ({ value, label }))];
  }, [expandedRows]);

  const whScopedRows = useMemo(() => {
    if (whFilterId === "all") return expandedRows;
    return expandedRows.filter((row) => row.warehouseId === whFilterId);
  }, [expandedRows, whFilterId]);

  const filtered = whScopedRows
    .filter((row) => {
      const status = getStockStatus(Number(row.warehouseQty || 0));
      if (statusFilter === "In Stock" && status !== "in-stock") return false;
      if (statusFilter === "Low Stock" && status !== "low-stock") return false;
      if (statusFilter === "Out of Stock" && status !== "out-of-stock") return false;
      return true;
    })
    .filter((row) => {
      if (!searchQuery.trim()) return true;
      const keyword = searchQuery.trim().toLowerCase();
      return row.title.toLowerCase().includes(keyword) || String(row.isbn || "").toLowerCase().includes(keyword);
    });

  const totalUnits = whScopedRows.reduce((sum, row) => sum + Number(row.warehouseQty || 0), 0);
  const healthyCount = whScopedRows.filter((row) => getStockStatus(Number(row.warehouseQty || 0)) === "in-stock").length;
  const lowCount = whScopedRows.filter((row) => getStockStatus(Number(row.warehouseQty || 0)) === "low-stock").length;
  const outCount = whScopedRows.filter((row) => getStockStatus(Number(row.warehouseQty || 0)) === "out-of-stock").length;

  const healthData = [
    { name: "Healthy", value: healthyCount, color: "#10b981" },
    { name: "Low Stock", value: lowCount, color: "#f59e0b" },
    { name: "Out of Stock", value: outCount, color: "#ef4444" },
  ];

  const uniqueTitles = new Set(whScopedRows.map((r) => r.id)).size;
  const selectedWhLabel = warehouseOptions.find((o) => o.value === whFilterId)?.label ?? "All Warehouses";
  const whSubtitle =
    whFilterId === "all"
      ? `${data.length} titles · ${expandedRows.length} warehouse lines · ${totalUnits} total units`
      : `${uniqueTitles} titles · ${selectedWhLabel} · ${totalUnits} units in this warehouse`;

  const tableHeaders = ["Barcode", "Title", "Category", "Warehouse", "Location", "Qty", "Health", "Status", "Updated"];

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
              <p className="text-[12px] text-slate-400 mt-0.5">{whSubtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={() => toast.success("Export started", { description: `${filtered.length} rows` })} className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border border-emerald-100 bg-white text-emerald-700 text-[13px] hover:bg-emerald-50 transition-all shadow-sm" style={{ fontWeight: 550 }}>
              <Download className="w-3.5 h-3.5" /> Export
            </button>
            <NavLink to="/movements" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] border border-blue-100 bg-white text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm" style={{ fontWeight: 550 }}>
              <ArrowRightLeft className="w-3.5 h-3.5" /> Movements
            </NavLink>
          </div>
        </div>
      </FadeItem>

      {/* Filters first: stats below react to warehouse + status */}
      <FadeItem>
        <div className="rounded-[12px] border border-emerald-100/50 bg-emerald-50/20 px-4 py-3">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide mb-2" style={{ fontWeight: 600 }}>Scope</p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search inventory by title/barcode..."
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-emerald-100/60 rounded-[10px] text-[13px] outline-none focus:ring-[3px] focus:ring-emerald-500/10 focus:border-emerald-300/60 transition-all shadow-sm" />
            </div>
            <label className="flex items-center gap-2 text-[12px] text-slate-600 shrink-0">
              <span style={{ fontWeight: 600 }}>Warehouse</span>
              <select
                value={whFilterId}
                onChange={(e) => setWhFilterId(e.target.value)}
                className="min-w-[200px] max-w-[280px] px-3 py-2.5 bg-white border border-emerald-100/60 rounded-[10px] text-[13px] outline-none shadow-sm cursor-pointer"
              >
                {warehouseOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1 bg-white border border-slate-200/60 rounded-[10px] p-[3px] shadow-sm">
              {statusFilters.map(f => (
                <button key={f} onClick={() => setStatusFilter(f)} className={`relative px-3.5 py-1.5 rounded-[8px] text-[12px] transition-all duration-160 ${statusFilter === f ? "text-white" : "text-slate-500 hover:text-slate-700"}`} style={{ fontWeight: 550 }}>
                  {statusFilter === f && <motion.div layoutId="inv-filter" className="absolute inset-0 rounded-[8px] bg-gradient-to-r from-emerald-600 to-teal-600 shadow-sm" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
                  <span className="relative z-10">{f}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </FadeItem>

      {/* Health Summary with Chart — values follow whScopedRows */}
      <FadeItem>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Units", val: totalUnits, color: "from-emerald-50 to-teal-50/50 border-emerald-100/60", textColor: "text-emerald-700", icon: Package, iconColor: "text-emerald-500" },
              { label: "Healthy", val: healthyCount, color: "from-green-50 to-emerald-50/50 border-green-100/60", textColor: "text-green-700", icon: Leaf, iconColor: "text-green-500" },
              { label: "Low Stock", val: lowCount, color: "from-amber-50 to-orange-50/50 border-amber-100/60", textColor: "text-amber-700", icon: AlertTriangle, iconColor: "text-amber-500" },
              { label: "Out of Stock", val: outCount, color: "from-rose-50 to-red-50/50 border-rose-100/60", textColor: "text-rose-700", icon: Package, iconColor: "text-rose-500" },
            ].map(s => (
              <motion.div key={`${whFilterId}-${s.label}`} whileHover={{ y: -2 }} className={`bg-gradient-to-br ${s.color} rounded-[12px] border p-4 flex items-center gap-3`}>
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
            <ResponsiveContainer width="100%" height={100} key={`pie-${whFilterId}-${healthyCount}-${lowCount}-${outCount}`}>
              <PieChart>
                <Pie data={healthData} cx="50%" cy="50%" innerRadius={28} outerRadius={42} paddingAngle={3} dataKey="value" strokeWidth={0}>
                  {healthData.map((entry, index) => <Cell key={`cell-${whFilterId}-${index}`} fill={entry.color} />)}
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

      {/* Table */}
      <FadeItem>
        <div className="bg-white rounded-[16px] border border-white/80 overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-gradient-to-r from-emerald-50/40 to-transparent">
                {tableHeaders.map(h => (
                  <th key={h} className={`${["Qty"].includes(h) ? "text-right" : "text-left"} text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]`} style={{ fontWeight: 550 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-14 text-[13px] text-slate-400">Dang tai du lieu ton kho...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-14">
                  <Package className="w-8 h-8 text-emerald-300 mx-auto mb-2" />
                  <p className="text-[13px] text-slate-400">No inventory items found</p>
                </td></tr>
              ) : filtered.map((row, i) => {
                const qty = Number(row.warehouseQty || 0);
                const status = getStockStatus(qty);
                const healthPct = Math.min(Math.max((qty / 5) * 100, 0), 100);
                return (
                  <motion.tr key={row.rowKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-slate-50 last:border-0 hover:bg-gradient-to-r hover:from-emerald-50/30 hover:to-transparent transition-all duration-140 cursor-pointer">
                    <td className="px-5 py-3.5 text-[12px] font-mono text-slate-400">{row.isbn || "-"}</td>
                    <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 550 }}>{row.title}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-500">{row.category || "-"}</td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-700" style={{ fontWeight: 600 }}>{row.warehouseName}</td>
                    <td className="px-5 py-3.5 text-[12px] font-mono text-slate-500">{row.locationSummary}</td>
                    <td className="px-5 py-3.5 text-right text-[14px] font-mono" style={{ fontWeight: 700 }}>
                      <span className={qty === 0 ? "text-red-500" : qty <= 5 ? "text-amber-600" : "text-emerald-600"}>{qty}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${healthPct}%` }} transition={{ duration: 0.6, ease: "easeOut", delay: i * 0.02 }}
                          className={`h-full rounded-full ${status === "out-of-stock" ? "bg-red-500" : status === "low-stock" ? "bg-amber-500" : "bg-emerald-500"}`} />
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge label={status === "in-stock" ? "Healthy" : status === "low-stock" ? "Low" : "Out"} variant={status === "in-stock" ? "success" : status === "low-stock" ? "warning" : "danger"} dot />
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-slate-400">{formatUpdatedTime(row.updated_at)}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 text-[12px] text-slate-400">
            <span>Showing {filtered.length} of {whScopedRows.length} lines ({data.length} titles)</span>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
