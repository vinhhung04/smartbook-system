import { useEffect, useMemo, useState } from "react";
import { Search, Package, AlertTriangle, Leaf, Download, ArrowRightLeft } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { motion } from "motion/react";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { SkeletonTableRow } from "@/components/ui/loading-state";
import { Button } from "@/components/ui/button";

interface InventoryLocation {
  warehouse_id?: string;
  warehouse_name: string;
  location_code: string;
  quantity: number;
  available_quantity?: number;
  receiving_quantity?: number;
  label: string;
  is_receiving?: boolean;
}

interface InventoryBook {
  id: string;
  title: string;
  isbn: string;
  category: string;
  quantity: number;
  available_quantity?: number;
  receiving_quantity?: number;
  location: string;
  locations?: InventoryLocation[];
  updated_at: string;
}

interface InventoryWarehouseRow extends InventoryBook {
  rowKey: string;
  warehouseId: string;
  warehouseName: string;
  warehouseQty: number;
  warehouseAvailQty: number;
  warehouseRecvQty: number;
  locationSummary: string;
}

const statusFilters = ["Tất cả", "Còn hàng", "Sắp hết", "Hết hàng"];

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
        warehouseAvailQty: 0,
        warehouseRecvQty: 0,
        locationSummary: "-",
      });
      continue;
    }
    for (const [key, { name: whName, locs: whLocs }] of byWh) {
      const warehouseQty = whLocs.reduce((s, l) => s + Number(l.quantity || 0), 0);
      const warehouseAvailQty = whLocs.reduce((s, l) => s + Number(l.available_quantity ?? l.quantity), 0);
      const warehouseRecvQty = whLocs.reduce((s, l) => s + Number(l.receiving_quantity ?? 0), 0);
      rows.push({
        ...item,
        rowKey: `${item.id}::${key}`,
        warehouseId: key,
        warehouseName: whName,
        warehouseQty,
        warehouseAvailQty,
        warehouseRecvQty,
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
  const [statusFilter, setStatusFilter] = useState("Tất cả");
  const [searchQuery, setSearchQuery] = useState("");
  const [exporting, setExporting] = useState(false);

  const loadInventory = async () => {
    try {
      setLoading(true);
      const response = await bookService.getAll();
      setData((response || []) as InventoryBook[]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được dữ liệu tồn kho"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInventory();
  }, []);

  const handleExport = async () => {
    setExporting(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      toast.success("Export started", { description: `${filtered.length} rows` });
    } finally {
      setExporting(false);
    }
  };

  const expandedRows = useMemo(() => expandBooksByWarehouse(data), [data]);

  const warehouseOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of expandedRows) {
      if (row.warehouseId === "__none__") continue;
      map.set(row.warehouseId, row.warehouseName);
    }
    const sorted = Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "vi"));
    return [{ value: "all", label: "Tất cả kho" }, ...sorted.map(([value, label]) => ({ value, label }))];
  }, [expandedRows]);

  const whScopedRows = useMemo(() => {
    if (whFilterId === "all") return expandedRows;
    return expandedRows.filter((row) => row.warehouseId === whFilterId);
  }, [expandedRows, whFilterId]);

  const filtered = whScopedRows
    .filter((row) => {
      const status = getStockStatus(Number(row.warehouseAvailQty ?? row.warehouseQty));
      if (statusFilter === "Còn hàng" && status !== "in-stock") return false;
      if (statusFilter === "Sắp hết" && status !== "low-stock") return false;
      if (statusFilter === "Hết hàng" && status !== "out-of-stock") return false;
      return true;
    })
    .filter((row) => {
      if (!searchQuery.trim()) return true;
      const keyword = searchQuery.trim().toLowerCase();
      return row.title.toLowerCase().includes(keyword) || String(row.isbn || "").toLowerCase().includes(keyword);
    });

  const totalUnits = whScopedRows.reduce((sum, row) => sum + Number(row.warehouseQty || 0), 0);
  const healthyCount = whScopedRows.filter((row) => getStockStatus(Number(row.warehouseAvailQty ?? row.warehouseQty)) === "in-stock").length;
  const lowCount = whScopedRows.filter((row) => getStockStatus(Number(row.warehouseAvailQty ?? row.warehouseQty)) === "low-stock").length;
  const outCount = whScopedRows.filter((row) => getStockStatus(Number(row.warehouseAvailQty ?? row.warehouseQty)) === "out-of-stock").length;

  const uniqueTitles = new Set(whScopedRows.map((r) => r.id)).size;
  const selectedWhLabel = warehouseOptions.find((o) => o.value === whFilterId)?.label ?? "Tất cả kho";
  const whSubtitle =
    whFilterId === "all"
      ? `${data.length} đầu sách · ${expandedRows.length} dòng kho · ${totalUnits} bản tổng cộng`
      : `${uniqueTitles} đầu sách · ${selectedWhLabel} · ${totalUnits} bản trong kho này`;

  const tableHeaders = ["Barcode", "Tên sách", "Thể loại", "Kho", "Vị trí", "SL", "Tình trạng", "Trạng thái", "Cập nhật"];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <PageHeader
          icon={Package}
          title="Tồn kho"
          description={whSubtitle}
          iconBg="bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-500/20 dark:to-teal-500/10"
          iconColor="text-emerald-600 dark:text-emerald-400"
          actions={
            <>
              <Button
                variant="outline"
                loading={exporting}
                onClick={() => void handleExport()}
                className="rounded-xl border-emerald-100 bg-card text-emerald-700 hover:bg-emerald-50 shadow-sm dark:border-emerald-500/20 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
              >
                {!exporting && <Download className="w-3.5 h-3.5" />} Xuất
              </Button>
              <NavLink to="/movements" className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-blue-100 bg-card text-blue-700 text-[13px] hover:bg-blue-50 transition-all shadow-sm font-medium dark:border-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/10">
                <ArrowRightLeft className="w-3.5 h-3.5" /> Biến động
              </NavLink>
            </>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
      >
        <FilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Tìm theo tên sách / mã barcode..."
          showSearchClear
          filters={
            <>
              <label className="flex items-center gap-2 text-[12px] text-muted-foreground font-medium">
                <span>Kho</span>
                <select
                  value={whFilterId}
                  onChange={(e) => setWhFilterId(e.target.value)}
                  className="min-w-[200px] max-w-[280px] px-3 py-2 bg-card border border-input rounded-lg text-[13px] outline-none shadow-sm cursor-pointer"
                >
                  {warehouseOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-1 bg-card border border-input rounded-lg p-[3px] shadow-sm">
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
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <StatCard label="Tổng bản sao" value={totalUnits} icon={Package} variant="default" />
        <StatCard label="Tình trạng tốt" value={healthyCount} icon={Leaf} variant="success" />
        <StatCard label="Sắp hết" value={lowCount} icon={AlertTriangle} variant="warning" />
        <StatCard label="Hết hàng" value={outCount} icon={Package} variant="danger" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <SectionCard noPadding>
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {tableHeaders.map(h => (
                  <th key={h} className={`${["SL"].includes(h) ? "text-right" : "text-left"} text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={9} rows={4} />
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9}><EmptyState variant="no-data" title="Không tìm thấy mục tồn kho" description="Thử điều chỉnh tìm kiếm hoặc bộ lọc" className="py-12" /></td></tr>
              ) : filtered.map((row, i) => {
                const qty = Number(row.warehouseQty || 0);
                const availQty = Number(row.warehouseAvailQty ?? row.warehouseQty);
                const recvQty = Number(row.warehouseRecvQty || 0);
                const status = getStockStatus(availQty);
                const healthPct = Math.min(Math.max((availQty / 5) * 100, 0), 100);
                return (
                  <motion.tr key={row.rowKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-border last:border-0 hover:bg-muted/40 hover:shadow-[inset_0_0_0_1px_var(--color-border)] transition-all duration-150 cursor-pointer">
                    <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{row.isbn || "-"}</td>
                    <td className="px-5 py-3.5 text-[13px] font-medium">{row.title}</td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{row.category || "-"}</td>
                    <td className="px-5 py-3.5 text-[12px] font-medium">{row.warehouseName}</td>
                    <td className="px-5 py-3.5 text-[12px] font-mono text-muted-foreground">{row.locationSummary}</td>
                    <td className="px-5 py-3.5 text-right">
                      <span className={`text-[14px] font-mono font-bold ${qty === 0 ? "text-red-500 dark:text-red-400" : qty <= 5 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{qty}</span>
                      {recvQty > 0 && (
                        <div className="text-[10px] text-amber-500 dark:text-amber-400 leading-tight mt-0.5">
                          Sẵn sàng: {availQty} · Nhận: {recvQty}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${healthPct}%` }} transition={{ duration: 0.6, ease: "easeOut", delay: i * 0.02 }}
                          className={`h-full rounded-full ${status === "out-of-stock" ? "bg-red-500" : status === "low-stock" ? "bg-amber-500" : "bg-emerald-500"}`} />
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge label={status === "in-stock" ? "Tốt" : status === "low-stock" ? "Sắp hết" : "Hết hàng"} variant={status === "in-stock" ? "success" : status === "low-stock" ? "warning" : "danger"} dot />
                    </td>
                    <td className="px-5 py-3.5 text-[12px] text-muted-foreground">{formatUpdatedTime(row.updated_at)}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground">
            <span>Showing {filtered.length} of {whScopedRows.length} lines ({data.length} titles)</span>
          </div>
        </SectionCard>
      </motion.div>
    </div>
  );
}
