import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowRightLeft, Minus, BookOpen, RotateCcw, ChevronDown, AlertTriangle, Wrench } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { motion, AnimatePresence } from "motion/react";
import { stockMovementService, type StockMovement } from "@/services/stock-movement";
import { getApiErrorMessage } from "@/services/api";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingOverlay } from "@/components/ui/loading-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { cn } from "@/components/ui/utils";

const movementTypes = {
  inbound: { label: "Nhập kho", color: "emerald", icon: ArrowDown, gradient: "from-emerald-500 to-teal-500" },
  outbound: { label: "Xuất kho", color: "rose", icon: ArrowUp, gradient: "from-rose-500 to-red-500" },
  transfer: { label: "Chuyển kho", color: "blue", icon: ArrowRightLeft, gradient: "from-blue-500 to-indigo-500" },
  adjustment: { label: "Điều chỉnh", color: "amber", icon: Minus, gradient: "from-amber-500 to-orange-500" },
  borrow: { label: "Mượn", color: "violet", icon: BookOpen, gradient: "from-violet-500 to-purple-500" },
  return: { label: "Trả", color: "sky", icon: RotateCcw, gradient: "from-sky-500 to-blue-500" },
};

const RANGE_OPTIONS: { value: "ALL" | "TODAY" | "7D" | "30D"; label: string }[] = [
  { value: "ALL", label: "Tất cả" },
  { value: "TODAY", label: "Hôm nay" },
  { value: "7D", label: "7 ngày" },
  { value: "30D", label: "30 ngày" },
];

const DAY_GROUP_PAGE_SIZE = 7;

// Each movement gets an ink-stamp badge instead of a flat icon tile — a nod to the
// library due-date stamp this system's own domain (SmartBook) is built around.
const STAMP_STYLE: Record<string, { ring: string; text: string; bg: string }> = {
  emerald: { ring: "border-emerald-500 dark:border-emerald-400", text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-500/10" },
  rose:    { ring: "border-rose-500 dark:border-rose-400",       text: "text-rose-600 dark:text-rose-400",       bg: "bg-rose-50 dark:bg-rose-500/10" },
  blue:    { ring: "border-blue-500 dark:border-blue-400",       text: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-50 dark:bg-blue-500/10" },
  amber:   { ring: "border-amber-500 dark:border-amber-400",     text: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-500/10" },
  violet:  { ring: "border-violet-500 dark:border-violet-400",   text: "text-violet-600 dark:text-violet-400",   bg: "bg-violet-50 dark:bg-violet-500/10" },
  sky:     { ring: "border-sky-500 dark:border-sky-400",         text: "text-sky-600 dark:text-sky-400",         bg: "bg-sky-50 dark:bg-sky-500/10" },
};

// Deterministic -4..+4deg tilt per movement id, so each stamp reads as hand-pressed
// rather than perfectly uniform, without jittering between renders.
function stampRotation(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 9) - 4;
}

const REASON_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  LOST:           { label: "Mất sách",    icon: AlertTriangle, className: "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20" },
  DAMAGED_RETURN: { label: "Trả hư hỏng", icon: Wrench,        className: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20" },
  RETURNED:       { label: "Trả bình thường", icon: RotateCcw,  className: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20" },
};

function ReasonBadge({ reasonCode }: { reasonCode: string | null }) {
  if (!reasonCode) return null;
  const cfg = REASON_CONFIG[reasonCode.toUpperCase()];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${cfg.className}`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

const DELTA_LABEL: Record<string, (qty: number) => string> = {
  LOST:           (qty) => `Mất ${qty} cuốn`,
  DAMAGED_RETURN: (qty) => `Hư hỏng ${qty} cuốn`,
  RETURNED:       (qty) => `Trả lại ${qty} cuốn`,
};

function formatDeltaLabel(m: StockMovement): { text: string; className: string } {
  const code = m.reason_code?.toUpperCase() ?? '';
  const fn = DELTA_LABEL[code];
  if (fn) {
    const colorClass =
      code === 'LOST'           ? 'text-red-600 dark:text-red-400' :
      code === 'DAMAGED_RETURN' ? 'text-orange-600 dark:text-orange-400' :
      'text-emerald-600 dark:text-emerald-400';
    return { text: fn(Math.abs(m.delta)), className: colorClass };
  }
  if (m.type === 'transfer') return { text: `${Math.abs(m.delta)} cuốn`, className: 'text-blue-600 dark:text-blue-400' };
  return {
    text: `${m.delta >= 0 ? '+' : ''}${m.delta} cuốn`,
    className: m.delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
  };
}

interface MovementDetailField {
  label: string;
  value: string;
  mono?: boolean;
  bold?: boolean;
  colored?: boolean;
  positive?: boolean;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN");
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

interface DayGroup {
  key: string;
  label: string;
  net: number;
  items: StockMovement[];
}

export function MovementsPage() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [rangeFilter, setRangeFilter] = useState<"ALL" | "TODAY" | "7D" | "30D">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleDayCount, setVisibleDayCount] = useState(DAY_GROUP_PAGE_SIZE);

  const loadMovements = async () => {
    try {
      setLoading(true);
      const response = await stockMovementService.getAll();
      setMovements(response);
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không tải được lịch sử biến động tồn kho"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMovements();
  }, []);

  useEffect(() => {
    setVisibleDayCount(DAY_GROUP_PAGE_SIZE);
  }, [typeFilter, rangeFilter, searchQuery]);

  const filtered = useMemo(() => {
    const now = new Date();
    const cutoff = rangeFilter === "TODAY"
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : rangeFilter === "7D"
        ? new Date(now.getTime() - 7 * 86400000)
        : rangeFilter === "30D"
          ? new Date(now.getTime() - 30 * 86400000)
          : null;

    const keyword = searchQuery.trim().toLowerCase();

    return movements.filter((m) => {
      if (typeFilter !== "all" && m.type !== typeFilter) return false;
      if (cutoff && new Date(m.created_at) < cutoff) return false;
      if (!keyword) return true;
      return (
        m.book_title.toLowerCase().includes(keyword)
        || m.movement_number.toLowerCase().includes(keyword)
        || String(m.barcode || "").toLowerCase().includes(keyword)
      );
    });
  }, [movements, typeFilter, rangeFilter, searchQuery]);

  const dayGroups = useMemo<DayGroup[]>(() => {
    const now = new Date();
    const todayKey = dateKeyOf(now);
    const yesterdayKey = dateKeyOf(new Date(now.getTime() - 86400000));

    const order: string[] = [];
    const buckets = new Map<string, StockMovement[]>();
    filtered.forEach((m) => {
      const key = dateKeyOf(new Date(m.created_at));
      if (!buckets.has(key)) {
        buckets.set(key, []);
        order.push(key);
      }
      buckets.get(key)!.push(m);
    });

    return order.map((key) => {
      const items = buckets.get(key)!;
      return {
        key,
        label: dayGroupLabel(key, todayKey, yesterdayKey),
        net: items.reduce((sum, m) => sum + m.delta, 0),
        items,
      };
    });
  }, [filtered]);

  const visibleDayGroups = dayGroups.slice(0, visibleDayCount);
  const hasMoreDays = dayGroups.length > visibleDayCount;

  const summary = useMemo(() => {
    return {
      inbound: movements.filter((m) => m.type === "inbound").reduce((sum, m) => sum + m.quantity, 0),
      outbound: movements.filter((m) => m.type === "outbound").reduce((sum, m) => sum + Math.abs(m.quantity), 0),
      transfer: movements.filter((m) => m.type === "transfer").length,
    };
  }, [movements]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    movements.forEach((m) => {
      counts[m.type] = (counts[m.type] || 0) + 1;
    });
    return counts;
  }, [movements]);

  const distribution = useMemo(() => {
    const total = movements.length;
    if (total === 0) return [];
    return Object.entries(movementTypes)
      .map(([key, cfg]) => ({ key, cfg, count: typeCounts[key] || 0, pct: ((typeCounts[key] || 0) / total) * 100 }))
      .filter((d) => d.count > 0);
  }, [movements.length, typeCounts]);

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <PageHeader
          icon={ArrowRightLeft}
          title="Sổ cái biến động kho"
          description={`${movements.length} biến động`}
          iconBg="bg-gradient-to-br from-cyan-100 to-blue-50 dark:from-cyan-500/20 dark:to-blue-500/10"
          iconColor="text-cyan-600 dark:text-cyan-400"
        />
      </motion.div>

      {movements.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.03 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4"
        >
          <StatCard label="Tổng nhập" value={summary.inbound} icon={movementTypes.inbound.icon} accentBorder={movementTypes.inbound.gradient} variant="success" animateValue />
          <StatCard label="Tổng xuất" value={summary.outbound} icon={movementTypes.outbound.icon} accentBorder={movementTypes.outbound.gradient} variant="danger" animateValue />
          <StatCard label="Chuyển kho" value={summary.transfer} icon={movementTypes.transfer.icon} accentBorder={movementTypes.transfer.gradient} variant="info" animateValue />
          <StatCard label="Records" value={movements.length} variant="default" animateValue />
        </motion.div>
      )}

      {distribution.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="rounded-xl border border-border bg-card p-4"
        >
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-3">Phân bố loại biến động</p>
          <div className="flex w-full h-2.5 rounded-full overflow-hidden bg-muted">
            {distribution.map((d) => (
              <div
                key={d.key}
                style={{ width: `${d.pct}%` }}
                className={`h-full bg-gradient-to-r ${d.cfg.gradient} first:rounded-l-full last:rounded-r-full`}
                title={`${d.cfg.label}: ${d.count}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3">
            {distribution.map((d) => (
              <div key={d.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={`w-2 h-2 rounded-full bg-gradient-to-br ${d.cfg.gradient}`} />
                {d.cfg.label} <span className="font-semibold text-foreground">{d.count}</span>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.07 }}
      >
        <FilterBar
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Tìm biến động..."
          showSearchClear
          filters={
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground/70 font-medium shrink-0">Loại</span>
                <SegmentedControl
                  options={[{ value: "all", label: "Tất cả" }, ...Object.entries(movementTypes).map(([k, v]) => ({ value: k, label: v.label }))]}
                  value={typeFilter}
                  onChange={setTypeFilter}
                  layoutId="move-filter"
                  gradientClassName="from-cyan-600 to-blue-600"
                  className="overflow-x-auto"
                />
              </div>
              <div className="hidden sm:block h-5 w-px bg-border" />
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground/70 font-medium shrink-0">Thời gian</span>
                <SegmentedControl
                  options={RANGE_OPTIONS}
                  value={rangeFilter}
                  onChange={setRangeFilter}
                  layoutId="move-range-filter"
                  gradientClassName="from-cyan-600 to-blue-600"
                />
              </div>
            </div>
          }
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        {loading ? (
          <SectionCard><LoadingOverlay /></SectionCard>
        ) : filtered.length === 0 ? (
          <SectionCard><EmptyState variant="no-results" title="Không tìm thấy biến động" description="Thử điều chỉnh tìm kiếm hoặc bộ lọc" className="py-12" /></SectionCard>
        ) : (
          <div className="space-y-8">
            {visibleDayGroups.map((group, groupIndex) => (
              <motion.div
                key={group.key}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(groupIndex, 6) * 0.05, duration: 0.3 }}
              >
                <div className="flex items-baseline gap-3 mb-3 px-1">
                  <h3 className="font-semibold text-[13px] text-foreground whitespace-nowrap">{group.label}</h3>
                  <div className="h-px flex-1 bg-border" />
                  <span
                    className={cn(
                      "font-mono text-[11px] font-semibold tabular-nums whitespace-nowrap",
                      group.net > 0 ? "text-emerald-600 dark:text-emerald-400" : group.net < 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
                    )}
                  >
                    Ròng {group.net > 0 ? "+" : ""}{group.net}
                  </span>
                </div>

                <SectionCard noPadding>
                  <div className="hidden sm:flex items-center justify-between px-4 pt-3 pb-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Diễn giải</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Số lượng</span>
                  </div>
                  <div className="divide-y divide-border">
                    {group.items.map((m) => {
                      const typeConfig = movementTypes[m.type as keyof typeof movementTypes] || movementTypes.inbound;
                      const Icon = typeConfig.icon;
                      const delta = formatDeltaLabel(m);
                      const stamp = STAMP_STYLE[typeConfig.color] || STAMP_STYLE.emerald;
                      const rotation = stampRotation(m.id);
                      const expanded = expandedId === m.id;

                      return (
                        <div key={m.id}>
                          <button
                            onClick={() => setExpandedId(expanded ? null : m.id)}
                            aria-expanded={expanded}
                            className="w-full px-4 py-4 flex items-center gap-4 hover:bg-muted/40 transition-colors text-left"
                          >
                            <div className="relative shrink-0 w-11 h-11 flex items-center justify-center">
                              <div className={cn("absolute inset-0 rounded-full border border-dashed opacity-50", stamp.ring)} style={{ transform: `rotate(${rotation}deg)` }} />
                              <div className={cn("w-9 h-9 rounded-full border-2 flex items-center justify-center", stamp.ring, stamp.bg)} style={{ transform: `rotate(${rotation}deg)` }}>
                                <Icon className={cn("w-4 h-4", stamp.text)} />
                              </div>
                            </div>

                            <div className="flex-1 min-w-0">
                              <p className="font-mono text-[10px] text-muted-foreground/60 mb-0.5">{m.movement_number || m.id}</p>
                              <p className="text-[14px] font-medium text-foreground truncate">{m.book_title}</p>
                              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                <StatusBadge label={typeConfig.label} variant={typeConfig.color as "success" | "warning" | "danger" | "info"} dot />
                                <ReasonBadge reasonCode={m.reason_code} />
                                {m.warehouse_code && <span className="font-mono text-[10px] text-muted-foreground">{m.warehouse_code}</span>}
                              </div>
                            </div>

                            <div className="shrink-0 text-right sm:border-l sm:border-border sm:pl-4">
                              <p className={cn("font-mono text-[16px] font-bold tabular-nums leading-tight", delta.className)}>{delta.text}</p>
                              <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{formatTime(m.created_at)}</p>
                            </div>
                            <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="shrink-0 text-muted-foreground/60">
                              <ChevronDown className="w-4 h-4" />
                            </motion.div>
                          </button>

                          <AnimatePresence>
                            {expanded && (
                              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                                className="overflow-hidden bg-muted/20">
                                <div className="p-4 space-y-3">
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    {(
                                      [
                                        { label: "THỜI GIAN", value: formatDate(m.created_at) },
                                        { label: "FROM/TO", value: m.transfer_note || `${m.from_location_code || "-"} → ${m.to_location_code || "-"}` },
                                        { label: "WAREHOUSE", value: m.warehouse_name || m.warehouse_code || "-" },
                                        { label: "LOCATION", value: m.to_location_code || m.from_location_code || "-", mono: true },
                                        { label: "USER", value: m.created_by_user_id || "-" },
                                        { label: "QTY", value: delta.text, bold: true, colored: true, positive: m.delta >= 0 },
                                      ] as MovementDetailField[]
                                    ).map(f => (
                                      <div key={f.label}>
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">{f.label}</p>
                                        <p
                                          className={`text-[12px] ${f.mono ? "font-mono text-muted-foreground" : ""} ${f.colored ? (f.positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400") : "text-muted-foreground"}`}
                                          style={{ fontWeight: f.bold ? 600 : 500 }}
                                        >
                                          {f.value}
                                        </p>
                                      </div>
                                    ))}
                                    {m.reason_code && REASON_CONFIG[m.reason_code.toUpperCase()] && (
                                      <div>
                                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">LÝ DO</p>
                                        <ReasonBadge reasonCode={m.reason_code} />
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">NOTES</p>
                                    <p className="text-[12px] text-muted-foreground">
                                      Ref: {m.reference_type || "-"} / {m.reference_id || "-"}
                                    </p>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              </motion.div>
            ))}

            {hasMoreDays && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => setVisibleDayCount((count) => count + DAY_GROUP_PAGE_SIZE)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-input bg-background text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                  style={{ fontWeight: 550 }}
                >
                  Xem thêm ngày trước
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
