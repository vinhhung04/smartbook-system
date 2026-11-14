import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bell, Download, History, Package, RefreshCw, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { NavLink } from "react-router";
import { StatusBadge } from "../status-badge";
import { bookService } from "@/services/book";
import { getApiErrorMessage } from "@/services/api";
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

const RULER_FILL: Record<StockStatus, string> = {
  OK: "bg-emerald-500",
  LOW: "bg-amber-500",
  RECEIVING: "bg-primary/40",
  ABSENT: "bg-muted-foreground/30",
};

/**
 * Copies ready to lend, read against the reorder line: the bar spans 0 to twice the
 * threshold, so the tick in the middle is exactly where a row turns "sắp hết".
 */
function ThresholdRuler({ available, status }: { available: number; status: StockStatus }) {
  const fillPct = Math.min(Math.max((available / (LOW_STOCK_THRESHOLD * 2)) * 100, 0), 100);
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "w-9 shrink-0 text-right font-serif text-[20px] font-semibold leading-none tabular-nums",
          status === "LOW" ? "text-amber-700 dark:text-amber-300" : status === "OK" ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {available}
      </span>
      <span className="relative h-1.5 min-w-12 flex-1 rounded-full bg-muted" aria-hidden="true">
        <span className={`absolute inset-y-0 left-0 rounded-full ${RULER_FILL[status]}`} style={{ width: `${fillPct}%` }} />
        <span className="absolute -bottom-1 -top-1 left-1/2 w-px bg-foreground/40" />
      </span>
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

  // Rows per warehouse, for the warehouse list in the rail (independent of the status filter).
  const warehouseCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of allRows) if (row.warehouseId) map.set(row.warehouseId, (map.get(row.warehouseId) ?? 0) + 1);
    return map;
  }, [allRows]);

  const statusKeys = FILTER_ORDER.filter((key) => key !== "ABSENT" || warehouseFilter === "all");
  const activeLabel = statusFilter === "ALL" ? "Tất cả dòng tồn kho" : STATUS[statusFilter].label;
  const activeWarehouse = warehouseFilter === "all" ? null : warehouseOptions.find((o) => o.value === warehouseFilter)?.label;

  const railButton = (active: boolean, onClick: () => void, label: string, count: number, attention = false) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active ? "bg-primary/[0.08] text-primary" : "text-foreground hover:bg-muted/60",
      )}
    >
      <span className={cn("min-w-0 truncate text-[13px]", active ? "font-semibold" : "font-medium")} title={label}>{label}</span>
      <span
        className={cn(
          "min-w-6 shrink-0 rounded-full px-1.5 text-center text-[12px] tabular-nums",
          attention && count > 0 ? "bg-amber-100 font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {loading ? "–" : count}
      </span>
    </button>
  );

  const statusChip = (key: StockStatus | "ALL") => {
    const active = statusFilter === key;
    const count = counts[key] ?? 0;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setStatusFilter(key)}
        aria-pressed={active}
        className={cn(
          "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          active ? "border-primary/30 bg-primary/[0.08] font-semibold text-primary" : "border-border bg-card font-medium hover:bg-muted/60",
        )}
      >
        <span className="whitespace-nowrap">{key === "ALL" ? "Tất cả" : STATUS[key].label}</span>
        <span className={cn("tabular-nums", key === "LOW" && count > 0 ? "font-semibold text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>{loading ? "–" : count}</span>
      </button>
    );
  };

  return (
    <PageWrapper className="space-y-6">
      <FadeItem>
        <PageHeader
          icon={Package}
          title="Tồn kho"
          description={
            loading
              ? "Đang tải tồn kho..."
              : `${totals.titles} đầu sách có hàng, ${totals.available.toLocaleString("vi-VN")} cuốn sẵn sàng${totals.receiving ? `, ${totals.receiving.toLocaleString("vi-VN")} cuốn còn ở khu nhận` : ""}${activeWarehouse ? ` tại ${activeWarehouse}` : ""}.`
          }
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => void loadInventory()} disabled={loading} aria-label="Làm mới">
                <RefreshCw className={cn("h-3.5 w-3.5 motion-reduce:animate-none", loading && "animate-spin")} />
                <span className="hidden sm:inline">Làm mới</span>
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExport} disabled={loading || filtered.length === 0}>
                <Download className="h-3.5 w-3.5" />Xuất CSV
              </Button>
              <Button asChild variant="outline" size="sm">
                <NavLink to="/movements"><History className="h-3.5 w-3.5" />Lịch sử kho</NavLink>
              </Button>
            </>
          }
        />
      </FadeItem>

      <AnimatePresence>
        {hasNewData && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/[0.05] px-5 py-3" role="status">
              <p className="flex items-center gap-2 text-[13px] text-primary">
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

      {!loading && lowCount > 0 && (
        <FadeItem>
          <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/25 dark:bg-amber-500/[0.07]" role="note">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
              <div>
                <p className="text-[14px] font-semibold text-amber-900 dark:text-amber-200">
                  {lowCount.toLocaleString("vi-VN")} dòng sắp hết hàng{activeWarehouse ? ` tại ${activeWarehouse}` : ""}
                </p>
                <p className="text-[13px] text-amber-800/90 dark:text-amber-300/90">
                  Còn {LOW_STOCK_THRESHOLD} cuốn trở xuống sẵn sàng ở một kho. Xem danh sách rồi lập đề xuất nhập hàng.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 pl-7 sm:pl-0">
              {statusFilter !== "LOW" && (
                <Button variant="outline" size="sm" onClick={() => setStatusFilter("LOW")} className="border-amber-300 bg-transparent text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/15">
                  Xem các dòng sắp hết
                </Button>
              )}
              <Button asChild size="sm">
                <NavLink to="/reorder-suggestions">Đề xuất nhập hàng <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></NavLink>
              </Button>
            </div>
          </div>
        </FadeItem>
      )}

      <FadeItem>
        {/* Named so the toolbar inside the list (its own container) can still ask whether the rail is showing. */}
        <div className="@container/page">
          <div className="grid grid-cols-1 items-start gap-4 @4xl/page:grid-cols-[232px_minmax(0,1fr)]">
            <nav aria-label="Lọc tồn kho" className="hidden max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-border bg-card p-3 @4xl/page:sticky @4xl/page:top-4 @4xl/page:block">
              <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Tình trạng</p>
              <div role="group" aria-label="Lọc theo tình trạng tồn kho">
                {railButton(statusFilter === "ALL", () => setStatusFilter("ALL"), "Tất cả", counts.ALL ?? 0)}
                {statusKeys.map((key) => (
                  <div key={key}>{railButton(statusFilter === key, () => setStatusFilter(key), STATUS[key].label, counts[key] ?? 0, key === "LOW")}</div>
                ))}
              </div>
              {warehouseOptions.length > 0 && (
                <div className="mt-3 border-t border-border pt-3" role="group" aria-label="Lọc theo kho">
                  <p className="px-3 pb-1.5 text-[12px] font-semibold text-muted-foreground">Kho</p>
                  {railButton(warehouseFilter === "all", () => setWarehouseFilter("all"), "Tất cả kho", allRows.length)}
                  {warehouseOptions.map((o) => (
                    <div key={o.value}>{railButton(warehouseFilter === o.value, () => setWarehouseFilter(o.value), o.label, warehouseCounts.get(o.value) ?? 0)}</div>
                  ))}
                </div>
              )}
            </nav>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] @4xl/page:hidden" role="group" aria-label="Lọc theo tình trạng tồn kho">
              {statusChip("ALL")}
              {statusKeys.map((key) => statusChip(key))}
            </div>

            <section aria-label="Danh sách tồn kho" className="@container min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-1 pt-4">
                <div className="min-w-0">
                  <h2 className="font-serif text-[18px] font-semibold tracking-tight">{activeLabel}</h2>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {statusFilter === "ALL" ? "Mỗi dòng là một đầu sách tại một kho." : STATUS[statusFilter].hint}
                    {activeWarehouse ? ` Đang xem ${activeWarehouse}.` : ""}
                  </p>
                </div>
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  <SelectTrigger size="sm" className="w-[190px]" aria-label="Sắp xếp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="border-b border-border px-4 py-3">
                <FilterBar
                  searchValue={searchQuery}
                  onSearchChange={setSearchQuery}
                  searchPlaceholder="Tìm tên sách, tác giả, ISBN, vị trí"
                  showSearchClear
                  filters={
                    <>
                      {/* The rail lists warehouses on wide screens; here it is a select. */}
                      <div className="@4xl/page:hidden">
                        <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
                          <SelectTrigger size="sm" className="w-[200px]" aria-label="Kho">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Tất cả kho</SelectItem>
                            {warehouseOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      {hasFilters && (
                        <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                          <X className="h-3.5 w-3.5" />Xóa lọc
                        </Button>
                      )}
                    </>
                  }
                />
              </div>

              <table className="w-full table-fixed">
                <thead>
                  <tr className="border-b border-border">
                    {[
                      { label: "Sách", className: "pl-5" },
                      { label: "Kho và vị trí", className: "hidden w-[230px] @2xl:table-cell" },
                      { label: `Sẵn sàng (ngưỡng ${LOW_STOCK_THRESHOLD})`, className: "w-[150px] @xl:w-[176px]" },
                      { label: "Cập nhật", className: "hidden w-[112px] pr-5 @5xl:table-cell" },
                    ].map((h) => (
                      <th key={h.label} scope="col" className={cn("px-3 py-3 text-left text-[12px] font-medium text-muted-foreground", h.className)}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <SkeletonTableRow columns={4} rows={6} />
                  ) : paged.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
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
                        <td className="py-3.5 pl-5 pr-3 align-top">
                          <p className={cn("line-clamp-2 text-[14px] font-semibold", absent ? "text-muted-foreground" : "text-foreground")} title={row.book.title}>{row.book.title}</p>
                          <p className="mt-0.5 flex min-w-0 gap-x-2 truncate text-[12px] text-muted-foreground">
                            <span className="font-mono">{row.book.isbn || "Không có ISBN"}</span>
                            {row.book.category ? <span className="truncate">{row.book.category}</span> : null}
                          </p>
                          {!absent && (
                            <p className="mt-1 truncate text-[12px] text-muted-foreground @2xl:hidden">
                              {row.warehouseName}: <span className="font-mono">{row.locs.map((l) => l.location_code).join(", ")}</span>
                            </p>
                          )}
                        </td>
                        <td className="hidden px-3 py-3.5 align-top @2xl:table-cell">
                          {absent ? (
                            <span className="text-[13px]">Không có ở kho nào</span>
                          ) : (
                            <>
                              <p className="truncate text-[13px] font-medium text-foreground" title={row.warehouseName}>{row.warehouseName}</p>
                              <div className="mt-1.5 flex flex-wrap gap-1" title={row.locs.map((l) => `${l.location_code}: ${l.quantity}`).join("\n")}>
                                {shownLocs.map((loc) => (
                                  <span
                                    key={`${loc.location_code}-${loc.is_receiving ? "r" : "s"}`}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[11px]",
                                      loc.is_receiving
                                        ? "border-primary/25 bg-primary/[0.06] text-primary"
                                        : "border-border bg-muted/40 text-muted-foreground",
                                    )}
                                  >
                                    {loc.location_code}<span className="font-semibold text-foreground/80">{loc.quantity}</span>
                                  </span>
                                ))}
                                {moreLocs > 0 && <span className="text-[11px] text-muted-foreground">và {moreLocs} vị trí khác</span>}
                              </div>
                              <p className="mt-1.5 text-[12px] tabular-nums text-muted-foreground @5xl:hidden" title={formatDateTime(row.book.updated_at)}>
                                Cập nhật {formatDate(row.book.updated_at)}
                              </p>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-3.5 align-top">
                          <ThresholdRuler available={row.available} status={row.status} />
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <StatusBadge label={status.label} variant={status.tone} dot />
                            {row.receiving > 0 && (
                              <span className="text-[12px] text-primary">+{row.receiving} ở khu nhận</span>
                            )}
                          </div>
                        </td>
                        <td className="hidden px-3 py-3.5 pr-5 align-top text-[13px] tabular-nums text-muted-foreground @5xl:table-cell" title={formatDateTime(row.book.updated_at)}>
                          {formatDate(row.book.updated_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-[12.5px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span aria-live="polite">
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
            </section>
          </div>
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
