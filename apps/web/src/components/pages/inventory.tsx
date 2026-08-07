import { useEffect, useMemo, useState } from "react";
import { Package, AlertTriangle, Leaf, Download, ArrowRightLeft, BookOpen, MapPin, Clock, Check } from "lucide-react";
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
import { SkeletonCard, SkeletonTableRow } from "@/components/ui/loading-state";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

function getStockStatus(quantity: number) {
  if (quantity <= 0) return "out-of-stock";
  if (quantity <= 5) return "low-stock";
  return "in-stock";
}

function stockStatusMeta(status: string) {
  if (status === "in-stock") return { label: "Tốt", variant: "success" as const };
  if (status === "low-stock") return { label: "Sắp hết", variant: "warning" as const };
  return { label: "Hết hàng", variant: "danger" as const };
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

  const tableHeaders = ["Sách", "Thể loại", "Kho / Vị trí", "Số lượng", "Trạng thái", "Cập nhật"];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="rounded-2xl border border-border bg-gradient-to-br from-emerald-50 via-card to-card dark:from-emerald-500/[0.07] dark:via-card dark:to-card p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:shadow-none">
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
          searchPlaceholder="Tìm theo tên sách / mã barcode..."
          showSearchClear
          filters={
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground font-medium">
              <span>Kho</span>
              <Select value={whFilterId} onValueChange={setWhFilterId}>
                <SelectTrigger className="min-w-[200px] max-w-[280px] bg-card shadow-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {warehouseOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          }
        />
      </motion.div>

      {(lowCount > 0 || outCount > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08 }}
          className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-[13px] text-amber-800 shadow-[0_1px_4px_rgba(0,0,0,0.03)] dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300 dark:shadow-none sm:flex-row sm:items-center"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <p className="flex-1">
            {outCount > 0 && <span className="font-semibold">{outCount} sản phẩm đã hết hàng</span>}
            {outCount > 0 && lowCount > 0 && " · "}
            {lowCount > 0 && <span className="font-semibold">{lowCount} sản phẩm sắp hết</span>}
            {" "}— cần kiểm tra và bổ sung.
          </p>
          <Button
            size="sm"
            variant="warning-outline"
            className="shrink-0"
            onClick={() => setStatusFilter(outCount > 0 ? "Hết hàng" : "Sắp hết")}
          >
            Xem ngay
          </Button>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        {[
          { key: "Tất cả", label: "Tổng bản sao", value: totalUnits, icon: Package, variant: "default" as const },
          { key: "Còn hàng", label: "Tình trạng tốt", value: healthyCount, icon: Leaf, variant: "success" as const },
          { key: "Sắp hết", label: "Sắp hết", value: lowCount, icon: AlertTriangle, variant: "warning" as const },
          { key: "Hết hàng", label: "Hết hàng", value: outCount, icon: Package, variant: "danger" as const },
        ].map((card) => {
          const isActive = statusFilter === card.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setStatusFilter(isActive ? "Tất cả" : card.key)}
              aria-pressed={isActive}
              className={`relative w-full rounded-xl text-left transition-all cursor-pointer ${isActive ? "scale-[0.98] shadow-md" : ""}`}
            >
              <StatCard label={card.label} value={card.value} icon={card.icon} variant={card.variant} animateValue />
              {isActive && (
                <span className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </button>
          );
        })}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
      >
        <SectionCard noPadding>
          {/* Mobile cards (< md) */}
          {loading ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2 md:hidden">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="md:hidden">
              <EmptyState variant="no-data" title="Không tìm thấy mục tồn kho" description="Thử điều chỉnh tìm kiếm hoặc bộ lọc" className="py-12" />
            </div>
          ) : (
            <div className="grid gap-3 p-4 sm:grid-cols-2 md:hidden">
              {filtered.map((row, i) => {
                const qty = Number(row.warehouseQty || 0);
                const availQty = Number(row.warehouseAvailQty ?? row.warehouseQty);
                const recvQty = Number(row.warehouseRecvQty || 0);
                const status = getStockStatus(availQty);
                const healthPct = Math.min(Math.max((availQty / 5) * 100, 0), 100);
                const meta = stockStatusMeta(status);
                return (
                  <motion.div key={row.rowKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-foreground truncate">{row.title}</p>
                        <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{row.isbn || "-"}</p>
                      </div>
                      <StatusBadge label={meta.label} variant={meta.variant} dot />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{row.category || "-"}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" /> {row.warehouseName} · {row.locationSummary}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${status === "out-of-stock" ? "bg-red-500" : status === "low-stock" ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${healthPct}%` }} />
                      </div>
                      <span className={`text-[13px] font-mono font-bold shrink-0 ${qty === 0 ? "text-red-500 dark:text-red-400" : qty <= 5 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{qty}</span>
                    </div>
                    {recvQty > 0 && (
                      <p className="text-[10px] text-amber-500 dark:text-amber-400">Sẵn sàng: {availQty} · Nhận: {recvQty}</p>
                    )}
                    <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5 shrink-0" /> Cập nhật {formatUpdatedTime(row.updated_at)}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Desktop table (>= md) */}
          <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {tableHeaders.map(h => (
                  <th key={h} className="text-left text-[11px] text-muted-foreground px-5 py-3 uppercase tracking-wider font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={6} rows={4} />
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6}><EmptyState variant="no-data" title="Không tìm thấy mục tồn kho" description="Thử điều chỉnh tìm kiếm hoặc bộ lọc" className="py-12" /></td></tr>
              ) : filtered.map((row, i) => {
                const qty = Number(row.warehouseQty || 0);
                const availQty = Number(row.warehouseAvailQty ?? row.warehouseQty);
                const recvQty = Number(row.warehouseRecvQty || 0);
                const status = getStockStatus(availQty);
                const healthPct = Math.min(Math.max((availQty / 5) * 100, 0), 100);
                const meta = stockStatusMeta(status);
                return (
                  <motion.tr key={row.rowKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="border-b border-border last:border-0 hover:bg-muted/40 transition-all duration-150">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="hidden lg:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <BookOpen className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-foreground truncate">{row.title}</p>
                          <p className="text-[11px] font-mono text-muted-foreground mt-0.5">{row.isbn || "-"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">{row.category || "-"}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
                        <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" /> {row.warehouseName}
                      </div>
                      <p className="text-[11px] font-mono text-muted-foreground mt-0.5 ml-[18px]">{row.locationSummary}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className={`text-[14px] font-mono font-bold shrink-0 ${qty === 0 ? "text-red-500 dark:text-red-400" : qty <= 5 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{qty}</span>
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <motion.div initial={{ width: 0 }} animate={{ width: `${healthPct}%` }} transition={{ duration: 0.6, ease: "easeOut", delay: i * 0.02 }}
                            className={`h-full rounded-full ${status === "out-of-stock" ? "bg-red-500" : status === "low-stock" ? "bg-amber-500" : "bg-emerald-500"}`} />
                        </div>
                      </div>
                      {recvQty > 0 && (
                        <div className="text-[10px] text-amber-500 dark:text-amber-400 leading-tight mt-1">
                          Sẵn sàng: {availQty} · Nhận: {recvQty}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge label={meta.label} variant={meta.variant} dot />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                        <Clock className="h-3 w-3 shrink-0" /> {formatUpdatedTime(row.updated_at)}
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12px] text-muted-foreground">
            <span>Hiển thị {filtered.length}/{whScopedRows.length} dòng ({data.length} đầu sách)</span>
          </div>
        </SectionCard>
      </motion.div>
    </div>
  );
}
