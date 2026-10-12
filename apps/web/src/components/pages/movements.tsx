import { Fragment, useEffect, useMemo, useState, type ElementType } from "react";
import {
  ArrowDown, ArrowRightLeft, ArrowUp, BookOpen, Bookmark, ChevronDown, Download, History, Minus, RefreshCw, RotateCcw, X,
} from "lucide-react";
import { NavLink } from "react-router";
import { toast } from "sonner";
import { PageWrapper, FadeItem } from "../motion-utils";
import { stockMovementService, type StockMovement } from "@/services/stock-movement";
import { userService } from "@/services/user";
import { authService } from "@/services/auth";
import { getApiErrorMessage } from "@/services/api";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/loading-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/components/ui/utils";
import { exportToCsv } from "@/lib/export-utils";

// The API's `type` folds loan reservations (RESERVE/RELEASE) and shelf moves into
// "transfer". Neither changes how many copies the warehouse holds, so the ledger
// splits them out and keeps them out of every net figure.
type Kind = "inbound" | "outbound" | "borrow" | "return" | "adjustment" | "move" | "reserve";

const KINDS: Record<Kind, { label: string; icon: ElementType; color: string; changesStock: boolean }> = {
  inbound: { label: "Nhập kho", icon: ArrowDown, color: "emerald", changesStock: true },
  outbound: { label: "Xuất kho", icon: ArrowUp, color: "rose", changesStock: true },
  borrow: { label: "Cho mượn", icon: BookOpen, color: "violet", changesStock: true },
  return: { label: "Trả sách", icon: RotateCcw, color: "sky", changesStock: true },
  adjustment: { label: "Điều chỉnh", icon: Minus, color: "amber", changesStock: true },
  move: { label: "Di chuyển trong kho", icon: ArrowRightLeft, color: "blue", changesStock: false },
  reserve: { label: "Giữ chỗ cho mượn", icon: Bookmark, color: "slate", changesStock: false },
};
const KIND_ORDER: Kind[] = ["inbound", "outbound", "borrow", "return", "adjustment", "move", "reserve"];

function kindOf(m: StockMovement): Kind {
  const raw = String(m.movement_type || "").toUpperCase();
  if (raw === "RESERVE" || raw === "RELEASE") return "reserve";
  const t = m.type as string;
  if (t === "transfer") return "move";
  if (t === "outbound" || t === "borrow" || t === "return" || t === "adjustment") return t;
  return "inbound";
}

// Ink-stamp badge per movement — a nod to the library due-date stamp SmartBook is built around.
const STAMP_STYLE: Record<string, { ring: string; text: string; bg: string; badge: string }> = {
  emerald: { ring: "border-emerald-500 dark:border-emerald-400", text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10", badge: "success" },
  rose: { ring: "border-rose-500 dark:border-rose-400", text: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-500/10", badge: "rose" },
  blue: { ring: "border-blue-500 dark:border-blue-400", text: "text-blue-600 dark:text-blue-400", bg: "bg-blue-50 dark:bg-blue-500/10", badge: "info" },
  amber: { ring: "border-amber-500 dark:border-amber-400", text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-500/10", badge: "warning" },
  violet: { ring: "border-violet-500 dark:border-violet-400", text: "text-violet-600 dark:text-violet-400", bg: "bg-violet-50 dark:bg-violet-500/10", badge: "violet" },
  sky: { ring: "border-sky-500 dark:border-sky-400", text: "text-sky-600 dark:text-sky-400", bg: "bg-sky-50 dark:bg-sky-500/10", badge: "info" },
  slate: { ring: "border-slate-400 dark:border-slate-500", text: "text-slate-500 dark:text-slate-400", bg: "bg-slate-50 dark:bg-slate-500/10", badge: "neutral" },
};

const KIND_CHIP: Record<string, string> = {
  emerald: "bg-emerald-500", rose: "bg-rose-500", blue: "bg-blue-500", amber: "bg-amber-500", violet: "bg-violet-500", sky: "bg-sky-500", slate: "bg-slate-400",
};

// Deterministic -4..+4deg tilt per movement id so each stamp reads as hand-pressed.
function stampRotation(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 9) - 4;
}

const REASON_LABEL: Record<string, string> = {
  LOST: "Mất sách",
  DAMAGED_RETURN: "Trả hư hỏng",
  DAMAGE: "Hư hỏng khi kiểm kê",
  CYCLE_COUNT: "Kiểm kê định kỳ",
  MANUAL_RECEIPT: "Nhập trực tiếp",
  PURCHASE_RECEIPT: "Nhập theo PO",
  CUSTOMER_ORDER: "Đơn khách hàng",
};
const REASON_TONE: Record<string, string> = {
  LOST: "text-red-600 dark:text-red-400",
  DAMAGED_RETURN: "text-orange-600 dark:text-orange-400",
  DAMAGE: "text-orange-600 dark:text-orange-400",
};

function moveLabel(m: StockMovement) {
  const raw = String(m.movement_type || "").toUpperCase();
  const ref = String(m.reference_type || "").toUpperCase();
  if (raw === "RESERVE") return "Giữ chỗ";
  if (raw === "RELEASE") return "Nhả giữ chỗ";
  if (ref === "RECEIVING_SHELF_PUTAWAY") return "Cất lên kệ";
  if (ref === "OUTBOUND_PICKING") return "Lấy hàng";
  return null;
}

const REFERENCE_LABEL: Record<string, string> = {
  GOODS_RECEIPT: "Phiếu nhập kho",
  RECEIVING_SHELF_PUTAWAY: "Cất hàng của phiếu nhập",
  LOAN_TRANSACTION: "Giao dịch mượn/trả",
  LOAN_RESERVATION: "Đặt giữ sách",
  STOCK_AUDIT: "Kiểm kê kho",
  STOCKTAKE: "Kiểm kê kho",
  DEMO_ORDER: "Đơn hàng",
  OUTBOUND_PICKING: "Lấy hàng xuất kho",
};

// Only references whose id is a goods receipt can be opened directly.
function referencePath(m: StockMovement) {
  const ref = String(m.reference_type || "").toUpperCase();
  if (m.reference_id && (ref === "GOODS_RECEIPT" || ref === "RECEIVING_SHELF_PUTAWAY")) return `/orders/${m.reference_id}`;
  return null;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function dateKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayGroupLabel(key: string, todayKey: string, yesterdayKey: string): string {
  if (key === todayKey) return "Hôm nay";
  if (key === yesterdayKey) return "Hôm qua";
  const [y, mo, d] = key.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
}

function signed(n: number) {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("vi-VN")}`;
}

const RANGE_OPTIONS: { value: "ALL" | "TODAY" | "7D" | "30D"; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "TODAY", label: "Hôm nay" },
  { value: "7D", label: "7 ngày" },
  { value: "30D", label: "30 ngày" },
];

const DAY_GROUP_PAGE_SIZE = 7;
const API_LIMIT = 500;

interface Row { m: StockMovement; kind: Kind; netDelta: number }

export function MovementsPage() {
  const currentUser = authService.getCurrentUser();
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<Kind | "all">("all");
  const [rangeFilter, setRangeFilter] = useState<"ALL" | "TODAY" | "7D" | "30D">("ALL");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleDayCount, setVisibleDayCount] = useState(DAY_GROUP_PAGE_SIZE);

  const loadMovements = async () => {
    try {
      setLoading(true);
      const [response, staff] = await Promise.all([
        stockMovementService.getAll(),
        userService.getWarehouseStaff().catch(() => null),
      ]);
      setMovements(response);
      setStaffNames(new Map((staff?.data ?? []).map((s) => [s.id, s.full_name || s.username])));
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được lịch sử biến động tồn kho"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadMovements(); }, []);
  useEffect(() => { setVisibleDayCount(DAY_GROUP_PAGE_SIZE); }, [kindFilter, rangeFilter, searchQuery, warehouseFilter]);

  const personName = (userId?: string | null) => {
    if (!userId) return "-";
    if (currentUser?.id && userId === currentUser.id) return "Bạn";
    return staffNames.get(userId) ?? "Người dùng khác";
  };

  const rows = useMemo<Row[]>(() => movements.map((m) => {
    const kind = kindOf(m);
    return { m, kind, netDelta: KINDS[kind].changesStock ? m.delta : 0 };
  }), [movements]);

  const warehouses = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of movements) if (m.warehouse_id) map.set(m.warehouse_id, [m.warehouse_code, m.warehouse_name].filter(Boolean).join(" - ") || m.warehouse_id);
    return Array.from(map, ([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [movements]);

  // Everything except the kind chip — the chips and the summary are counted from this.
  const scoped = useMemo(() => {
    const now = new Date();
    const cutoff = rangeFilter === "TODAY"
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : rangeFilter === "7D" ? new Date(now.getTime() - 7 * 86400000)
        : rangeFilter === "30D" ? new Date(now.getTime() - 30 * 86400000) : null;
    const keyword = searchQuery.trim().toLowerCase();
    return rows.filter(({ m }) => {
      if (warehouseFilter && m.warehouse_id !== warehouseFilter) return false;
      if (cutoff && new Date(m.created_at) < cutoff) return false;
      if (!keyword) return true;
      return [m.book_title, m.movement_number, m.barcode, m.sku, m.from_location_code, m.to_location_code]
        .some((v) => String(v || "").toLowerCase().includes(keyword));
    });
  }, [rows, rangeFilter, searchQuery, warehouseFilter]);

  const filtered = useMemo(() => (kindFilter === "all" ? scoped : scoped.filter((r) => r.kind === kindFilter)), [scoped, kindFilter]);

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of scoped) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    return counts;
  }, [scoped]);

  const summary = useMemo(() => {
    let inQty = 0;
    let outQty = 0;
    let internal = 0;
    for (const r of scoped) {
      if (!KINDS[r.kind].changesStock) internal += 1;
      else if (r.netDelta >= 0) inQty += r.netDelta;
      else outQty += -r.netDelta;
    }
    return { inQty, outQty, net: inQty - outQty, internal };
  }, [scoped]);

  const dayGroups = useMemo(() => {
    const now = new Date();
    const todayKey = dateKeyOf(now);
    const yesterdayKey = dateKeyOf(new Date(now.getTime() - 86400000));
    const order: string[] = [];
    const buckets = new Map<string, Row[]>();
    for (const r of filtered) {
      const key = dateKeyOf(new Date(r.m.created_at));
      if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
      buckets.get(key)!.push(r);
    }
    return order.map((key) => {
      const items = buckets.get(key)!;
      return { key, label: dayGroupLabel(key, todayKey, yesterdayKey), net: items.reduce((s, r) => s + r.netDelta, 0), items };
    });
  }, [filtered]);

  const visibleDayGroups = dayGroups.slice(0, visibleDayCount);
  const hasMoreDays = dayGroups.length > visibleDayCount;
  const hasFilters = kindFilter !== "all" || rangeFilter !== "ALL" || !!warehouseFilter || !!searchQuery.trim();
  const capped = movements.length >= API_LIMIT;

  const clearFilters = () => {
    setKindFilter("all");
    setRangeFilter("ALL");
    setWarehouseFilter("");
    setSearchQuery("");
  };

  const handleExport = () => {
    exportToCsv(
      filtered.map(({ m, kind, netDelta }) => ({
        time: formatDateTime(m.created_at),
        movement_number: m.movement_number,
        book_title: m.book_title,
        barcode: m.barcode || "",
        kind: moveLabel(m) || KINDS[kind].label,
        reason: REASON_LABEL[String(m.reason_code || "").toUpperCase()] || "",
        quantity: m.quantity,
        net: netDelta,
        warehouse: m.warehouse_code || "",
        from: m.from_location_code || "",
        to: m.to_location_code || "",
        reference: REFERENCE_LABEL[String(m.reference_type || "").toUpperCase()] || m.reference_type || "",
      })),
      [
        { header: "Thời gian", key: "time" },
        { header: "Mã biến động", key: "movement_number" },
        { header: "Sách", key: "book_title" },
        { header: "Mã vạch/ISBN", key: "barcode" },
        { header: "Loại", key: "kind" },
        { header: "Lý do", key: "reason" },
        { header: "Số lượng", key: "quantity" },
        { header: "Thay đổi tồn", key: "net" },
        { header: "Kho", key: "warehouse" },
        { header: "Từ vị trí", key: "from" },
        { header: "Đến vị trí", key: "to" },
        { header: "Chứng từ", key: "reference" },
      ],
      "lich-su-kho",
    );
  };

  const quantityCell = ({ m, kind }: Row) => {
    if (!KINDS[kind].changesStock) {
      return <span className="text-muted-foreground">{m.quantity} cuốn</span>;
    }
    return (
      <span className={m.delta >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
        {signed(m.delta)}
      </span>
    );
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <PageHeader
          icon={History}
          title="Lịch sử kho"
          description="Sổ ghi mọi lần sách vào, ra và di chuyển trong kho"
          iconBg="bg-gradient-to-br from-cyan-100 to-blue-50 dark:from-cyan-500/20 dark:to-blue-500/10"
          iconColor="text-cyan-600 dark:text-cyan-400"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void loadMovements()} disabled={loading} aria-label="Làm mới">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                <span className="hidden sm:inline">Làm mới</span>
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
                <Download className="h-3.5 w-3.5" />Xuất CSV
              </Button>
            </div>
          }
        />
      </FadeItem>

      <FadeItem>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.03),0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-none">
          <dl className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
            {[
              { label: "Sách vào kho", value: loading ? "–" : signed(summary.inQty), tone: "text-emerald-600 dark:text-emerald-400" },
              { label: "Sách ra khỏi kho", value: loading ? "–" : signed(-summary.outQty), tone: "text-rose-600 dark:text-rose-400" },
              { label: "Thay đổi ròng", value: loading ? "–" : signed(summary.net), tone: summary.net >= 0 ? "text-foreground" : "text-rose-600 dark:text-rose-400" },
              { label: "Di chuyển & giữ chỗ", value: loading ? "–" : summary.internal.toLocaleString("vi-VN"), unit: "lượt", tone: "text-muted-foreground", hint: "Không làm đổi tồn kho" },
            ].map((item) => (
              <div key={item.label} className="px-4 py-3">
                <dt className="text-[12px] text-muted-foreground">{item.label}</dt>
                <dd className={cn("mt-0.5 font-mono text-[22px] font-semibold leading-tight tabular-nums", item.tone)}>
                  {item.value}
                  {"unit" in item && item.unit ? <span className="ml-1 font-sans text-[12px] font-normal">{item.unit}</span> : null}
                </dd>
                {item.hint ? <p className="text-[10px] text-muted-foreground">{item.hint}</p> : null}
              </div>
            ))}
          </dl>

          <div className="flex items-center gap-1 overflow-x-auto border-t border-border p-2 [scrollbar-width:thin]" role="group" aria-label="Lọc theo loại biến động">
            <button
              type="button"
              aria-pressed={kindFilter === "all"}
              onClick={() => setKindFilter("all")}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                kindFilter === "all" ? "border-foreground/20 bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              Tất cả <span className="font-mono text-[11px] opacity-70">{scoped.length}</span>
            </button>
            {KIND_ORDER.map((kind, i) => {
              const cfg = KINDS[kind];
              const active = kindFilter === kind;
              const count = kindCounts[kind] ?? 0;
              if (!count && !active) return null;
              return (
                <Fragment key={kind}>
                  {i === KIND_ORDER.indexOf("move") && <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />}
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => setKindFilter(kind)}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "border-foreground/20 bg-foreground text-background" : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", KIND_CHIP[cfg.color])} aria-hidden="true" />
                    {cfg.label}
                    <span className="font-mono text-[11px] opacity-70">{count}</span>
                  </button>
                </Fragment>
              );
            })}
          </div>

          <div className="border-t border-border px-4 py-3">
            <FilterBar
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="Tìm tên sách, ISBN, mã biến động, vị trí..."
              showSearchClear
              filters={
                <>
                  <div className="max-w-full overflow-x-auto">
                    <SegmentedControl options={RANGE_OPTIONS} value={rangeFilter} onChange={setRangeFilter} layoutId="move-range-filter" gradientClassName="from-cyan-600 to-blue-600" className="w-max whitespace-nowrap" />
                  </div>
                  {warehouses.length > 1 && (
                    <Select value={warehouseFilter || "__all__"} onValueChange={(v) => setWarehouseFilter(v === "__all__" ? "" : v)}>
                      <SelectTrigger size="sm" className="w-[190px]" aria-label="Kho">
                        <SelectValue placeholder="Tất cả kho" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">Tất cả kho</SelectItem>
                        {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {hasFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                      <X className="h-3.5 w-3.5" />Xóa lọc
                    </Button>
                  )}
                </>
              }
            />
          </div>
          {capped ? (
            <p className="border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
              Đang hiển thị {API_LIMIT} biến động gần nhất. Biến động cũ hơn không có trong danh sách và các con số ở trên.
            </p>
          ) : null}
        </div>
      </FadeItem>

      <FadeItem>
        {loading ? (
          <SectionCard noPadding>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <Skeleton className="h-7 w-7 rounded-full" />
                <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-64" /><Skeleton className="h-3 w-40" /></div>
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </SectionCard>
        ) : filtered.length === 0 ? (
          <SectionCard>
            <EmptyState
              variant="no-results"
              title={movements.length === 0 ? "Chưa có biến động nào" : "Không có biến động phù hợp"}
              description={movements.length === 0 ? "Biến động được ghi khi nhập, xuất, mượn, trả hoặc điều chỉnh tồn kho." : "Thử đổi khoảng thời gian, loại biến động hoặc từ khóa."}
              action={hasFilters ? <Button variant="outline" size="sm" onClick={clearFilters}><X className="h-3.5 w-3.5" />Xóa lọc</Button> : undefined}
              className="py-12"
            />
          </SectionCard>
        ) : (
          <div className="space-y-6">
            {visibleDayGroups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <div className="mb-2 flex min-w-0 items-baseline gap-3 px-1">
                  <h3 className="whitespace-nowrap text-[13px] font-semibold text-foreground first-letter:uppercase">{group.label}</h3>
                  <span className="hidden whitespace-nowrap text-[11px] text-muted-foreground sm:inline">{group.items.length} biến động</span>
                  <div className="h-px flex-1 bg-border" />
                  <span
                    className={cn(
                      "whitespace-nowrap font-mono text-[11px] font-semibold tabular-nums",
                      group.net > 0 ? "text-emerald-600 dark:text-emerald-400" : group.net < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
                    )}
                    title="Thay đổi tồn kho trong ngày, không tính di chuyển và giữ chỗ"
                  >
                    Tồn kho {signed(group.net)}
                  </span>
                </div>

                <SectionCard noPadding>
                  <ul className="divide-y divide-border">
                    {group.items.map((row) => {
                      const { m, kind } = row;
                      const cfg = KINDS[kind];
                      const Icon = cfg.icon;
                      const stamp = STAMP_STYLE[cfg.color];
                      const rotation = stampRotation(m.id);
                      const expanded = expandedId === m.id;
                      const reasonCode = String(m.reason_code || "").toUpperCase();
                      const reason = kind === "return" ? null : REASON_LABEL[reasonCode];
                      const subLabel = moveLabel(m);
                      const where = kind === "move" && (m.from_location_code || m.to_location_code)
                        ? `${m.from_location_code || "?"} → ${m.to_location_code || "?"}`
                        : m.to_location_code || m.from_location_code;
                      const refPath = referencePath(m);
                      const detailsId = `movement-${m.id}`;
                      return (
                        <li key={m.id}>
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : m.id)}
                            aria-expanded={expanded}
                            aria-controls={detailsId}
                            className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none", !cfg.changesStock && "opacity-80")}
                          >
                            <span className="hidden w-10 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground sm:block">{formatTime(m.created_at)}</span>
                            <span className="relative flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden="true">
                              <span className={cn("flex h-7 w-7 items-center justify-center rounded-full border-2", stamp.ring, stamp.bg)} style={{ transform: `rotate(${rotation}deg)` }}>
                                <Icon className={cn("h-3.5 w-3.5", stamp.text)} />
                              </span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-foreground" title={m.book_title}>{m.book_title}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                <span className={cn("font-medium", stamp.text)}>{subLabel || cfg.label}</span>
                                {reason ? <span className={cn("font-medium", REASON_TONE[reasonCode])}> · {reason}</span> : null}
                                {m.warehouse_code ? ` · ${m.warehouse_code}` : ""}
                                {where ? <span className="font-mono"> · {where}</span> : null}
                                <span className="sm:hidden"> · {formatTime(m.created_at)}</span>
                              </span>
                            </span>
                            <span className="shrink-0 text-right font-mono text-[14px] font-semibold tabular-nums">{quantityCell(row)}</span>
                            <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform", expanded && "rotate-180")} aria-hidden="true" />
                          </button>

                          {expanded && (
                            <div id={detailsId} className="border-t border-dashed border-border bg-muted/20 px-4 py-3 sm:pl-[100px]">
                              <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[12px] md:grid-cols-3">
                                {[
                                  { label: "Thời gian", value: formatDateTime(m.created_at) },
                                  { label: "Mã biến động", value: m.movement_number || m.id, mono: true },
                                  { label: "Mã vạch / ISBN", value: m.barcode || m.sku || "-", mono: true },
                                  { label: "Kho", value: [m.warehouse_code, m.warehouse_name].filter(Boolean).join(" · ") || "-" },
                                  { label: "Từ → đến", value: m.from_location_code || m.to_location_code ? `${m.from_location_code || "-"} → ${m.to_location_code || "-"}` : "-", mono: true },
                                  { label: "Người thực hiện", value: personName(m.created_by_user_id) },
                                  { label: "Ảnh hưởng tồn kho", value: cfg.changesStock ? `${signed(m.delta)} cuốn` : "Không đổi tồn kho" },
                                  ...(m.unit_cost ? [{ label: "Đơn giá", value: `${m.unit_cost.toLocaleString("vi-VN")} VND`, mono: true }] : []),
                                ].map((field) => (
                                  <div key={field.label} className="min-w-0">
                                    <dt className="text-[11px] text-muted-foreground">{field.label}</dt>
                                    <dd className={cn("break-words text-foreground", "mono" in field && field.mono && "font-mono text-[11px]")}>{field.value}</dd>
                                  </div>
                                ))}
                                <div className="min-w-0">
                                  <dt className="text-[11px] text-muted-foreground">Chứng từ</dt>
                                  <dd className="text-foreground">
                                    {refPath ? (
                                      <NavLink to={refPath} className="rounded text-indigo-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-indigo-400">
                                        Mở {REFERENCE_LABEL[String(m.reference_type).toUpperCase()]?.toLowerCase()}
                                      </NavLink>
                                    ) : (
                                      REFERENCE_LABEL[String(m.reference_type || "").toUpperCase()] || m.reference_type || "-"
                                    )}
                                  </dd>
                                </div>
                              </dl>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </SectionCard>
              </section>
            ))}

            {hasMoreDays && (
              <div className="flex justify-center pt-1">
                <Button variant="outline" size="sm" onClick={() => setVisibleDayCount((count) => count + DAY_GROUP_PAGE_SIZE)}>
                  Xem thêm các ngày trước ({dayGroups.length - visibleDayCount} ngày)
                </Button>
              </div>
            )}
          </div>
        )}
      </FadeItem>
    </PageWrapper>
  );
}
