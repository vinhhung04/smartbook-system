import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bell, Download, History, Package, RefreshCw, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { StatusBadge } from "../status-badge";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api";
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
  author?: string;
  quantity: number;
  locations?: InventoryLocation[];
  updated_at: string;
}

// One row per (book, warehouse). Books with no stock record anywhere get a single
// "absent" row — the API can't tell "never received" from "sold out everywhere".
interface StockRow {
  key: string;
  book: InventoryBook;
  warehouseId: string | null;
  warehouseName: string;
  total: number;
  available: number;
  receiving: number;
  locs: InventoryLocation[];
  status: StockStatus;
}

const LOW_STOCK_THRESHOLD = 5;
const PAGE_SIZE = 25;

type StockStatus = "LOW" | "RECEIVING" | "OK" | "ABSENT";

const STATUS: Record<StockStatus, { label: string; tone: string; hint: string }> = {
  LOW: { label: "Sắp hết", tone: "warning", hint: `Còn ${LOW_STOCK_THRESHOLD} cuốn trở xuống sẵn sàng` },
  RECEIVING: { label: "Chờ cất kệ", tone: "violet", hint: "Có hàng nhưng toàn bộ còn ở khu nhận" },
  OK: { label: "Đủ hàng", tone: "success", hint: `Trên ${LOW_STOCK_THRESHOLD} cuốn sẵn sàng` },
  ABSENT: { label: "Không có trong kho", tone: "neutral", hint: "Chưa nhập hoặc đã hết ở mọi kho" },
};
const FILTER_ORDER: StockStatus[] = ["LOW", "RECEIVING", "OK", "ABSENT"];
const ATTENTION_RANK: Record<StockStatus, number> = { LOW: 0, RECEIVING: 1, OK: 2, ABSENT: 3 };

type SortKey = "attention" | "title" | "available" | "updated";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "attention", label: "Cần chú ý trước" },
  { value: "available", label: "Ít hàng sẵn sàng nhất" },
  { value: "title", label: "Tên sách A–Z" },
  { value: "updated", label: "Cập nhật gần nhất" },
];

function statusOf(available: number, total: number): StockStatus {
  if (total <= 0) return "ABSENT";
  if (available <= 0) return "RECEIVING";
  if (available <= LOW_STOCK_THRESHOLD) return "LOW";
  return "OK";
}

const GAUGE_FILL: Record<StockStatus, string> = {
  OK: "bg-emerald-500",
  LOW: "bg-amber-500",
  RECEIVING: "bg-violet-400",
  ABSENT: "bg-muted-foreground/30",
};

/**
 * A vertical bin-level gauge — fills bottom-up relative to 2x the reorder
 * threshold, with a fixed tick at the halfway mark showing exactly where
 * that threshold sits.
 */
function StockGauge({ quantity, status }: { quantity: number; status: StockStatus }) {
  const fillPct = Math.min(Math.max((quantity / (LOW_STOCK_THRESHOLD * 2)) * 100, 0), 100);
  return (
    <div className="relative h-8 w-2 shrink-0 overflow-hidden rounded-full bg-muted" title={`Vạch giữa: ngưỡng ${LOW_STOCK_THRESHOLD} cuốn`} aria-hidden="true">
      <motion.div
        className={`absolute inset-x-0 bottom-0 rounded-full ${GAUGE_FILL[status]}`}
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

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("vi-VN");
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN");
}

function buildRows(data: InventoryBook[]): StockRow[] {
  const rows: StockRow[] = [];
  for (const book of data) {
    const byWarehouse = new Map<string, { name: string; locs: InventoryLocation[] }>();
    for (const loc of book.locations || []) {
      const key = loc.warehouse_id ? String(loc.warehouse_id) : `__name:${loc.warehouse_name || "?"}`;
      if (!byWarehouse.has(key)) byWarehouse.set(key, { name: loc.warehouse_name || "Không rõ kho", locs: [] });
      byWarehouse.get(key)!.locs.push(loc);
    }
    if (byWarehouse.size === 0) {
      rows.push({ key: `${book.id}::none`, book, warehouseId: null, warehouseName: "-", total: 0, available: 0, receiving: 0, locs: [], status: "ABSENT" });
      continue;
    }
    for (const [warehouseId, { name, locs }] of byWarehouse) {
      const total = locs.reduce((s, l) => s + Number(l.quantity || 0), 0);
      const available = locs.reduce((s, l) => s + Number(l.available_quantity ?? (l.is_receiving ? 0 : l.quantity)), 0);
      const receiving = locs.reduce((s, l) => s + Number(l.receiving_quantity ?? (l.is_receiving ? l.quantity : 0)), 0);
      const sortedLocs = [...locs].sort((a, b) => Number(!!a.is_receiving) - Number(!!b.is_receiving) || b.quantity - a.quantity);
      rows.push({ key: `${book.id}::${warehouseId}`, book, warehouseId, warehouseName: name, total, available, receiving, locs: sortedLocs, status: statusOf(available, total) });
    }
  }
  return rows;
}

export function InventoryPage() {
  const [data, setData] = useState<InventoryBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StockStatus | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("attention");
  const [searchQuery, setSearchQuery] = useState("");
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

  useEffect(() => { void loadInventory(); }, []);

  const markNewData = useCallback(() => setHasNewData(true), []);
  useInventoryRealtime({ onStockEvent: markNewData, onPurchaseRequestEvent: markNewData, onGoodsReceiptEvent: markNewData });

  const allRows = useMemo(() => buildRows(data), [data]);

  const warehouseOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of allRows) if (row.warehouseId) map.set(row.warehouseId, row.warehouseName);
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "vi"));
  }, [allRows]);

  // Absent titles have no warehouse, so they only belong to the all-warehouses view.
  const scoped = useMemo(
    () => (warehouseFilter === "all" ? allRows : allRows.filter((row) => row.warehouseId === warehouseFilter)),
    [allRows, warehouseFilter],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: scoped.length };
    for (const row of scoped) map[row.status] = (map[row.status] ?? 0) + 1;
    return map;
  }, [scoped]);

  const totals = useMemo(() => {
    let available = 0;
    let receiving = 0;
    const titles = new Set<string>();
    for (const row of scoped) {
      available += row.available;
      receiving += row.receiving;
      if (row.status !== "ABSENT") titles.add(row.book.id);
    }
    return { available, receiving, titles: titles.size };
  }, [scoped]);

  const filtered = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    const rows = scoped.filter((row) => {
      if (statusFilter !== "ALL" && row.status !== statusFilter) return false;
      if (!keyword) return true;
      return [row.book.title, row.book.isbn, row.book.author, ...row.locs.map((l) => l.location_code)]
        .some((v) => String(v || "").toLowerCase().includes(keyword));
    });
    return rows.sort((a, b) => {
      if (sortKey === "title") return a.book.title.localeCompare(b.book.title, "vi");
      if (sortKey === "available") return a.available - b.available || a.book.title.localeCompare(b.book.title, "vi");
      if (sortKey === "updated") return new Date(b.book.updated_at).getTime() - new Date(a.book.updated_at).getTime();
      return ATTENTION_RANK[a.status] - ATTENTION_RANK[b.status] || a.available - b.available || a.book.title.localeCompare(b.book.title, "vi");
    });
  }, [scoped, statusFilter, searchQuery, sortKey]);

  useEffect(() => { setPage(1); }, [warehouseFilter, statusFilter, searchQuery, sortKey]);
  useEffect(() => {
    if (statusFilter === "ABSENT" && warehouseFilter !== "all") setStatusFilter("ALL");
  }, [statusFilter, warehouseFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const hasFilters = statusFilter !== "ALL" || warehouseFilter !== "all" || !!searchQuery.trim();
  const lowCount = counts.LOW ?? 0;

  const clearFilters = () => {
    setStatusFilter("ALL");
    setWarehouseFilter("all");
    setSearchQuery("");
  };

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.error("Không có dòng tồn kho nào để xuất");
      return;
    }
    const header = ["Sách", "ISBN", "Thể loại", "Kho", "Vị trí", "Tổng", "Sẵn sàng", "Ở khu nhận", "Tình trạng", "Cập nhật"];
    const rows = filtered.map((row) => [
      row.book.title,
      row.book.isbn || "",
      row.book.category || "",
      row.warehouseName,
      row.locs.map((l) => `${l.location_code} (${l.quantity})`).join("; "),
      row.total,
      row.available,
      row.receiving,
      STATUS[row.status].label,
      formatDateTime(row.book.updated_at),
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob([String.fromCharCode(0xfeff) + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ton-kho-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Đã xuất ${filtered.length} dòng`);
  };

  const filterButton = (key: StockStatus | "ALL") => {
    const active = statusFilter === key;
    const count = counts[key] ?? 0;
    const label = key === "ALL" ? "Tất cả" : STATUS[key].label;
    const attention = key === "LOW" && count > 0;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setStatusFilter(key)}
        aria-pressed={active}
        title={key === "ALL" ? undefined : STATUS[key].hint}
        className={cn(
          "flex flex-1 shrink-0 flex-col items-start rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300"
            : "border-transparent hover:border-border hover:bg-muted/50",
        )}
      >
        <span className={cn("text-[18px] font-semibold leading-tight tabular-nums", !active && (count ? "text-foreground" : "text-muted-foreground/60"))}>{loading ? "–" : count}</span>
        <span className={cn("flex items-center gap-1.5 whitespace-nowrap text-[11px]", active ? "font-medium" : "text-muted-foreground")}>
          {attention && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="cần chú ý" />}
          {label}
        </span>
      </button>
    );
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={Package}
          title="Tồn kho"
          description={loading ? "Đang tải…" : `${totals.titles} đầu sách có hàng · ${totals.available.toLocaleString("vi-VN")} cuốn sẵn sàng${totals.receiving ? ` · ${totals.receiving.toLocaleString("vi-VN")} cuốn chờ cất kệ` : ""}`}
          iconBg="bg-gradient-to-br from-emerald-100 to-teal-50 dark:from-emerald-500/20 dark:to-teal-500/10"
          iconColor="text-emerald-600 dark:text-emerald-400"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void loadInventory()} disabled={loading} aria-label="Làm mới">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                <span className="hidden sm:inline">Làm mới</span>
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={loading || filtered.length === 0}>
                <Download className="h-3.5 w-3.5" />Xuất CSV
              </Button>
              <Button asChild variant="outline" size="sm">
                <NavLink to="/movements"><History className="h-3.5 w-3.5" />Lịch sử kho</NavLink>
              </Button>
            </div>
          }
        />
      </FadeItem>

      <AnimatePresence>
        {hasNewData && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 dark:border-indigo-500/20 dark:bg-indigo-500/10" role="status">
              <p className="flex items-center gap-2 text-[13px] text-indigo-700 dark:text-indigo-400">
                <Bell className="h-4 w-4 shrink-0" aria-hidden="true" />
                Tồn kho vừa thay đổi. Số liệu bên dưới có thể đã cũ.
              </p>
              <Button size="sm" onClick={() => void loadInventory()}>
                <RefreshCw className="h-3.5 w-3.5" />Tải số liệu mới
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <FadeItem>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none">
          <div className="flex items-center gap-1 overflow-x-auto p-2 [scrollbar-width:thin]" role="group" aria-label="Lọc theo tình trạng tồn kho">
            {filterButton("ALL")}
            <span className="mx-1 h-8 w-px shrink-0 bg-border" aria-hidden="true" />
            {FILTER_ORDER.filter((key) => key !== "ABSENT" || warehouseFilter === "all").map((key) => filterButton(key))}
          </div>
          <div className="border-t border-border px-4 py-3">
            <FilterBar
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Tìm tên sách, tác giả, ISBN, vị trí..."
              showSearchClear
              filters={
                <>
                  <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                    <SelectTrigger size="sm" className="w-[200px]" aria-label="Kho">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Tất cả kho</SelectItem>
                      {warehouseOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                    <SelectTrigger size="sm" className="w-[190px]" aria-label="Sắp xếp">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {hasFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                      <X className="h-3.5 w-3.5" />Xóa lọc
                    </Button>
                  )}
                </>
              }
            />
          </div>
          {lowCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border bg-amber-50/70 px-4 py-2.5 text-[12px] text-amber-800 dark:bg-amber-500/[0.07] dark:text-amber-300">
              <p className="flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span><span className="font-semibold">{lowCount} dòng sắp hết</span> (còn {LOW_STOCK_THRESHOLD} cuốn trở xuống sẵn sàng ở một kho)</span>
              </p>
              <NavLink to="/reorder-suggestions" className="inline-flex items-center gap-1 rounded font-semibold underline decoration-current/40 underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                Xem đề xuất nhập hàng <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </NavLink>
            </div>
          )}
        </div>
      </FadeItem>

      <FadeItem>
        <SectionCard noPadding>
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                {[
                  { label: "Sách", className: "" },
                  { label: "Kho · vị trí", className: "hidden w-[260px] md:table-cell" },
                  { label: "Sẵn sàng", className: "w-[120px] sm:w-[150px]" },
                  { label: "Tình trạng", className: "hidden w-[150px] sm:table-cell" },
                  { label: "Cập nhật", className: "hidden w-[100px] xl:table-cell" },
                ].map((h) => (
                  <th key={h.label} scope="col" className={cn("px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground", h.className)}>{h.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonTableRow columns={5} rows={6} />
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      variant={hasFilters ? "no-results" : "no-data"}
                      title={hasFilters ? "Không có dòng tồn kho phù hợp" : "Chưa có dữ liệu tồn kho"}
                      description={hasFilters ? "Thử đổi tình trạng, kho hoặc từ khóa tìm kiếm" : "Tồn kho xuất hiện sau khi phiếu nhập đầu tiên được ghi sổ"}
                      action={hasFilters ? <Button variant="outline" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5" />Xóa lọc</Button> : undefined}
                      className="py-12"
                    />
                  </td>
                </tr>
              ) : paged.map((row) => {
                const status = STATUS[row.status];
                const absent = row.status === "ABSENT";
                const shownLocs = row.locs.slice(0, 3);
                const moreLocs = row.locs.length - shownLocs.length;
                return (
                  <tr key={row.key} className={cn("border-b border-border last:border-0 hover:bg-muted/40", absent && "text-muted-foreground")}>
                    <td className="px-4 py-3 align-top">
                      <p className={cn("line-clamp-2 text-[13px] font-semibold sm:line-clamp-none sm:truncate", absent ? "text-muted-foreground" : "text-foreground")} title={row.book.title}>{row.book.title}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        <span className="font-mono">{row.book.isbn || "-"}</span>
                        {row.book.category ? ` · ${row.book.category}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 sm:hidden">
                        <StatusBadge label={status.label} variant={status.tone} dot />
                      </div>
                      {!absent && (
                        <p className="mt-1 truncate text-[11px] text-muted-foreground md:hidden">
                          {row.warehouseName} · <span className="font-mono">{row.locs.map((l) => l.location_code).join(", ")}</span>
                        </p>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 align-top md:table-cell">
                      {absent ? (
                        <span className="text-[12px]">-</span>
                      ) : (
                        <>
                          <p className="truncate text-[12px] font-medium text-foreground" title={row.warehouseName}>{row.warehouseName}</p>
                          <div className="mt-1 flex flex-wrap gap-1" title={row.locs.map((l) => `${l.location_code}: ${l.quantity}`).join("\n")}>
                            {shownLocs.map((loc) => (
                              <span
                                key={`${loc.location_code}-${loc.is_receiving ? "r" : "s"}`}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px]",
                                  loc.is_receiving
                                    ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300"
                                    : "border-border bg-muted/40 text-muted-foreground",
                                )}
                              >
                                {loc.location_code}<span className="font-semibold text-foreground/80">{loc.quantity}</span>
                              </span>
                            ))}
                            {moreLocs > 0 && <span className="text-[10px] text-muted-foreground">+{moreLocs} vị trí</span>}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center gap-2.5">
                        <span className={cn(
                          "w-8 shrink-0 text-right font-mono text-[16px] font-bold tabular-nums",
                          row.status === "LOW" ? "text-amber-600 dark:text-amber-400" : row.status === "OK" ? "text-foreground" : "text-muted-foreground",
                        )}
                        >
                          {row.available}
                        </span>
                        <StockGauge quantity={row.available} status={row.status} />
                      </div>
                      {row.receiving > 0 && (
                        <p className="mt-1 text-[10px] leading-tight text-violet-700 dark:text-violet-300">+{row.receiving} ở khu nhận</p>
                      )}
                    </td>
                    <td className="hidden px-4 py-3 align-top sm:table-cell">
                      <StatusBadge label={status.label} variant={status.tone} dot />
                    </td>
                    <td className="hidden px-4 py-3 align-top text-[12px] text-muted-foreground xl:table-cell" title={formatDateTime(row.book.updated_at)}>
                      {formatDate(row.book.updated_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              {filtered.length > 0
                ? `Hiển thị ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} trong ${filtered.length} dòng`
                : "Không có dòng nào"}
            </span>
            {totalPages > 1 && (
              <Pagination className="mx-0 w-auto justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={(event) => { event.preventDefault(); setPage(Math.max(1, currentPage - 1)); }}
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
                      onClick={(event) => { event.preventDefault(); setPage(Math.min(totalPages, currentPage + 1)); }}
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
