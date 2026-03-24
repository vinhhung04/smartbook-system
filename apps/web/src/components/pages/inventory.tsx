import { useEffect, useMemo, useState } from "react";
import { Search, Package, AlertTriangle, Leaf, Download, ArrowRightLeft } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { motion } from "motion/react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";

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

interface InventoryWarehouseRow extends InventoryBook {
  rowKey: string;
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

function expandBooksByWarehouse(data: InventoryBook[]): InventoryWarehouseRow[] {
  const rows: InventoryWarehouseRow[] = [];
  for (const item of data) {
    const locs = item.locations || [];
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
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-100 to-teal-50 flex items-center justify-center border border-emerald-200/40">
            <Package className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Inventory</h1>
            <p className="text-[12px] text-muted-foreground mt-0.5">{whSubtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => toast.success("Export started", { description: `${filtered.length} rows` })} className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-emerald-100 bg-white text-emerald-700 text-[13px] hover:bg-emerald-50 transition-all shadow-sm font-medium">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <NavLink to="/movements" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-blue-100 bg-white text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm font-medium">
            <ArrowRightLeft className="w-3.5 h-3.5" /> Movements
          </NavLink>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <FilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search inventory by title/barcode..."
          showSearchClear
          filters={
            <>
              <label className="flex items-center gap-2 text-[12px] text-muted-foreground font-medium">
                <span>Warehouse</span>
                <select
                  value={whFilterId}
                  onChange={(e) => setWhFilterId(e.target.value)}
                  className="min-w-[200px] max-w-[280px] px-3 py-2 bg-white border border-input rounded-lg text-[13px] outline-none shadow-sm cursor-pointer"
                >
                  {warehouseOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-1 bg-white border border-input rounded-lg p-[3px] shadow-sm">
                {statusFilters.map(f => (
                  <button key={f} onClick={() => setStatusFilter(f)} className={`relative px-3.5 py-1.5 rounded-lg text-[12px] transition-all duration-160 font-medium ${statusFilter === f ? "text-white" : "text-muted-foreground hover:text-foreground"}`}>
                    {statusFilter === f && <motion.div layoutId="inv-filter" className="absolute inset-0 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 shadow-sm" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
                    <span className="relative z-10">{f}</span>
                  </button>
                ))}
              </div>
            </>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-4"
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Units" value={totalUnits} icon={Package} variant="default" />
          <StatCard label="Healthy" value={healthyCount} icon={Leaf} variant="success" />
          <StatCard label="Low Stock" value={lowCount} icon={AlertTriangle} variant="warning" />
          <StatCard label="Out of Stock" value={outCount} icon={Package} variant="danger" />
        </div>
        <div className="bg-card rounded-xl border border-black/5 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-3 flex flex-col items-center justify-center">
          <div className="text-[11px] text-muted-foreground mb-1 font-medium">Health</div>
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
              <span key={d.name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />{d.value}
              </span>
            ))}
          </div>
        </div>
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
                {tableHeaders.map(h => (
                  <th key={h} className={`${["Qty"].includes(h) ? "text-right" : "text-left"} text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-14 text-[13px] text-muted-foreground">Dang tai du lieu ton kho...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9}><EmptyState variant="no-data" title="No inventory items found" description="Try adjusting your search or filters" className="py-12" /></td></tr>
              ) : filtered.map((row, i) => {
                const qty = Number(row.warehouseQty || 0);
                const status = getStockStatus(qty);
                const healthPct = Math.min(Math.max((qty / 5) * 100, 0), 100);
                return (
                  <motion.tr key={row.rowKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer">
                    <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{row.isbn || "-"}</td>
                    <td className="px-5 py-3.5 text-[13px] font-medium">{row.title}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{row.category || "-"}</td>
                    <td className="px-5 py-3.5 text-[12px] font-medium">{row.warehouseName}</td>
                    <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{row.locationSummary}</td>
                    <td className="px-5 py-3.5 text-right text-[14px] font-mono font-bold">
                      <span className={qty === 0 ? "text-red-500" : qty <= 5 ? "text-amber-600" : "text-emerald-600"}>{qty}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${healthPct}%` }} transition={{ duration: 0.6, ease: "easeOut", delay: i * 0.02 }}
                          className={`h-full rounded-full ${status === "out-of-stock" ? "bg-red-500" : status === "low-stock" ? "bg-amber-500" : "bg-emerald-500"}`} />
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge label={status === "in-stock" ? "Healthy" : status === "low-stock" ? "Low" : "Out"} variant={status === "in-stock" ? "success" : status === "low-stock" ? "warning" : "danger"} dot />
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatUpdatedTime(row.updated_at)}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground">
            <span>Showing {filtered.length} of {whScopedRows.length} lines ({data.length} titles)</span>
          </div>
        </SectionCard>
      </motion.div>
    </div>
  );
}
