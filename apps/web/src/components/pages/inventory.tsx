import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, AlertTriangle, Leaf, Download, ArrowRightLeft, ArrowRight, MapPin, Check, Bell, RefreshCw } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { motion, AnimatePresence } from "motion/react";
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
import {
  Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink,
  PaginationNext, PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/components/ui/utils";
import { getPaginationRange } from "@/lib/pagination";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageWrapper, FadeItem } from "@/components/motion-utils";
import { getStatusVariant } from "@/lib/status-registry";
import { useInventoryRealtime } from "@/hooks/useInventoryRealtime";

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

const LOW_STOCK_THRESHOLD = 5;
const PAGE_SIZE = 25;

type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  IN_STOCK: "Tốt",
  LOW_STOCK: "Sắp hết",
  OUT_OF_STOCK: "Hết hàng",
};

function getStockStatus(quantity: number): StockStatus {
  if (quantity <= 0) return "OUT_OF_STOCK";
  if (quantity <= LOW_STOCK_THRESHOLD) return "LOW_STOCK";
  return "IN_STOCK";
}

const GAUGE_TONE_FILL: Record<StockStatus, string> = {
  IN_STOCK: "bg-emerald-500",
  LOW_STOCK: "bg-amber-500",
  OUT_OF_STOCK: "bg-red-500",
};

/**
 * A vertical bin-level gauge — fills bottom-up relative to 2x the reorder
 * threshold, with a fixed tick at the halfway mark showing exactly where
 * that threshold sits. Reads like a warehouse bin gauge: below the tick
 * means "below the reorder line," at or above means clear of it.
 */
function StockGauge({ quantity, status }: { quantity: number; status: StockStatus }) {
  const fillPct = Math.min(Math.max((quantity / (LOW_STOCK_THRESHOLD * 2)) * 100, 0), 100);
  return (
    <div
      className="relative h-8 w-2 shrink-0 overflow-hidden rounded-full bg-muted"
      title={`Ngưỡng cảnh báo: dưới ${LOW_STOCK_THRESHOLD} bản`}
      aria-hidden="true"
    >
      <motion.div
        className={`absolute inset-x-0 bottom-0 rounded-full ${GAUGE_TONE_FILL[status]}`}
        initial={{ height: 0 }}
        animate={{ height: `${fillPct}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
      <div className="absolute inset-x-0 top-1/2 h-px bg-background/70" />
    </div>
  );
}

function csvCell(value: string | number) {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function formatUpdatedDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
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
  const [hasNewData, setHasNewData] = useState(false);
  const [page, setPage] = useState(1);

  const loadInventory = async () => {
    try {
      setLoading(true);
      setHasNewData(false);
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

  const markNewData = useCallback(() => {
    setHasNewData((prev) => prev || true);
  }, []);

  useInventoryRealtime({
    onStockEvent: markNewData,
    onPurchaseRequestEvent: markNewData,
    onGoodsReceiptEvent: markNewData,
  });

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("Không có dòng tồn kho nào để xuất");
      return;
    }
    setExporting(true);
    try {
      const header = ["Sách", "ISBN", "Thể loại", "Kho", "Vị trí", "Số lượng", "Sẵn sàng", "Đang nhận", "Trạng thái", "Cập nhật"];
      const rows = filtered.map((row) => {
        const availQty = Number(row.warehouseAvailQty ?? row.warehouseQty);
        const status = getStockStatus(availQty);
        return [
          row.title,
          row.isbn || "",
          row.category || "",
          row.warehouseName,
          row.locationSummary,
          row.warehouseQty,
          availQty,
          row.warehouseRecvQty,
          STOCK_STATUS_LABEL[status],
          formatUpdatedTime(row.updated_at),
        ];
      });
      const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
      const csvBom = String.fromCharCode(0xfeff);
      const blob = new Blob([csvBom + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `ton-kho-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`Đã xuất ${filtered.length} dòng`);
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
      if (statusFilter === "Còn hàng" && status !== "IN_STOCK") return false;
      if (statusFilter === "Sắp hết" && status !== "LOW_STOCK") return false;
      if (statusFilter === "Hết hàng" && status !== "OUT_OF_STOCK") return false;
      return true;
    })
    .filter((row) => {
      if (!searchQuery.trim()) return true;
      const keyword = searchQuery.trim().toLowerCase();
      return row.title.toLowerCase().includes(keyword) || String(row.isbn || "").toLowerCase().includes(keyword);
    });

  const totalUnits = whScopedRows.reduce((sum, row) => sum + Number(row.warehouseQty || 0), 0);
  const healthyCount = whScopedRows.filter((row) => getStockStatus(Number(row.warehouseAvailQty ?? row.warehouseQty)) === "IN_STOCK").length;
  const lowCount = whScopedRows.filter((row) => getStockStatus(Number(row.warehouseAvailQty ?? row.warehouseQty)) === "LOW_STOCK").length;
  const outCount = whScopedRows.filter((row) => getStockStatus(Number(row.warehouseAvailQty ?? row.warehouseQty)) === "OUT_OF_STOCK").length;

  const uniqueTitles = new Set(whScopedRows.map((r) => r.id)).size;
  const selectedWhLabel = warehouseOptions.find((o) => o.value === whFilterId)?.label ?? "Tất cả kho";
  const whSubtitle =
    whFilterId === "all"
      ? `${data.length} đầu sách · ${expandedRows.length} dòng kho · ${totalUnits} bản tổng cộng`
      : `${uniqueTitles} đầu sách · ${selectedWhLabel} · ${totalUnits} bản trong kho này`;

  useEffect(() => {
    setPage(1);
  }, [whFilterId, statusFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const qtyTone = (qty: number) =>
    qty === 0 ? "text-red-500 dark:text-red-400" : qty <= LOW_STOCK_THRESHOLD ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400";

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
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
      </FadeItem>

      <AnimatePresence>
        {hasNewData && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 dark:border-indigo-500/20 dark:bg-indigo-500/10">
              <div className="flex items-center gap-2 text-[13px] text-indigo-700 dark:text-indigo-400">
                <Bell className="h-4 w-4 shrink-0" />
                Có dữ liệu mới — số liệu tồn kho bên dưới có thể đã thay đổi.
              </div>
              <button
                type="button"
                onClick={() => void loadInventory()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-indigo-700 transition-colors"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Làm mới
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The four tiles double as the status filter - click one to filter, click again to clear. */}
      <FadeItem className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
      </FadeItem>

      <FadeItem>
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
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          {(lowCount > 0 || outCount > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border bg-amber-50/70 px-4 py-2.5 text-[12px] text-amber-800 dark:bg-amber-500/[0.07] dark:text-amber-300 sm:px-5">
              <p className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {outCount > 0 && <span className="font-semibold">{outCount} hết hàng</span>}
                  {outCount > 0 && lowCount > 0 && " · "}
                  {lowCount > 0 && <span className="font-semibold">{lowCount} sắp hết</span>}
                  <span className="text-amber-700/80 dark:text-amber-300/70"> (dưới {LOW_STOCK_THRESHOLD} bản mỗi kho)</span>
                </span>
              </p>
              <NavLink
                to="/reorder-suggestions"
                className="inline-flex items-center gap-1 font-semibold underline decoration-current/40 underline-offset-4 hover:opacity-80"
              >
                Xem đề xuất nhập hàng <ArrowRight className="h-3 w-3" />
              </NavLink>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {[
                    { label: "Sách", className: "" },
                    { label: "Kho / Vị trí", className: "hidden w-[200px] md:table-cell" },
                    { label: "Số lượng", className: "w-[130px]" },
                    { label: "Trạng thái", className: "hidden w-[130px] sm:table-cell" },
                    { label: "Cập nhật", className: "hidden w-[110px] xl:table-cell" },
                  ].map((h) => (
                    <th key={h.label} className={cn("px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground", h.className)}>{h.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonTableRow columns={5} rows={6} />
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={5}><EmptyState variant="no-data" title="Không tìm thấy mục tồn kho" description="Thử điều chỉnh tìm kiếm hoặc bộ lọc" className="py-12" /></td></tr>
                ) : paged.map((row, i) => {
                  const qty = Number(row.warehouseQty || 0);
                  const availQty = Number(row.warehouseAvailQty ?? row.warehouseQty);
                  const recvQty = Number(row.warehouseRecvQty || 0);
                  const status = getStockStatus(availQty);
                  return (
                    <motion.tr key={row.rowKey} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 10) * 0.02 }}
                      className="border-b border-border transition-all duration-150 last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <p className="truncate text-[13px] font-semibold text-foreground" title={row.title}>{row.title}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {[row.isbn || "-", row.category].filter(Boolean).join(" · ")}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                          <StatusBadge label={STOCK_STATUS_LABEL[status]} variant={getStatusVariant("stockLevel", status)} dot />
                        </div>
                        <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-muted-foreground md:hidden">
                          <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /> {row.warehouseName} · {row.locationSummary}
                        </p>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <p className="flex items-center gap-1.5 truncate text-[12px] font-medium text-foreground" title={row.warehouseName}>
                          <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" /> {row.warehouseName}
                        </p>
                        <p className="ml-[18px] truncate font-mono text-[11px] text-muted-foreground">{row.locationSummary}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className={cn("shrink-0 font-mono text-[15px] font-bold tabular-nums", qtyTone(qty))}>{qty}</span>
                          <StockGauge quantity={availQty} status={status} />
                        </div>
                        {recvQty > 0 && (
                          <p className="mt-1 text-[10px] leading-tight text-amber-600 dark:text-amber-400">Sẵn sàng {availQty} · Nhận {recvQty}</p>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <StatusBadge label={STOCK_STATUS_LABEL[status]} variant={getStatusVariant("stockLevel", status)} dot />
                      </td>
                      <td className="hidden px-4 py-3 text-[12px] text-muted-foreground xl:table-cell" title={formatUpdatedTime(row.updated_at)}>
                        {formatUpdatedDate(row.updated_at)}
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>Hiển thị {paged.length} / {filtered.length} dòng ({data.length} đầu sách)</span>
            {totalPages > 1 && (
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={(event) => { event.preventDefault(); setPage((p) => Math.max(1, p - 1)); }}
                      className={cn("cursor-pointer", currentPage === 1 && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                  {getPaginationRange(currentPage, totalPages).map((item, i) => (
                    <PaginationItem key={`${item}-${i}`}>
                      {typeof item === "number" ? (
                        <PaginationLink isActive={item === currentPage} onClick={(event) => { event.preventDefault(); setPage(item); }} className="cursor-pointer">
                          {item}
                        </PaginationLink>
                      ) : (
                        <PaginationEllipsis />
                      )}
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={(event) => { event.preventDefault(); setPage((p) => Math.min(totalPages, p + 1)); }}
                      className={cn("cursor-pointer", currentPage === totalPages && "pointer-events-none opacity-50")}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        </SectionCard>
      </FadeItem>
    </PageWrapper>
  );
}
