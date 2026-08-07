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

const movementTypes = {
  inbound: { label: "Nhập kho", color: "emerald", icon: ArrowDown, gradient: "from-emerald-500 to-teal-500" },
  outbound: { label: "Xuất kho", color: "rose", icon: ArrowUp, gradient: "from-rose-500 to-red-500" },
  transfer: { label: "Chuyển kho", color: "blue", icon: ArrowRightLeft, gradient: "from-blue-500 to-indigo-500" },
  adjustment: { label: "Điều chỉnh", color: "amber", icon: Minus, gradient: "from-amber-500 to-orange-500" },
  borrow: { label: "Mượn", color: "violet", icon: BookOpen, gradient: "from-violet-500 to-purple-500" },
  return: { label: "Trả", color: "sky", icon: RotateCcw, gradient: "from-sky-500 to-blue-500" },
};

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

export function MovementsPage() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  const filtered = movements.filter(m => {
    if (typeFilter !== "all" && m.type !== typeFilter) return false;
    if (!searchQuery.trim()) return true;
    const keyword = searchQuery.trim().toLowerCase();
    return (
      m.book_title.toLowerCase().includes(keyword)
      || m.movement_number.toLowerCase().includes(keyword)
      || String(m.barcode || "").toLowerCase().includes(keyword)
    );
  });

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
          title="Biến động tồn kho"
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
            <SegmentedControl
              options={[{ value: "all", label: "Tất cả" }, ...Object.entries(movementTypes).map(([k, v]) => ({ value: k, label: v.label }))]}
              value={typeFilter}
              onChange={setTypeFilter}
              layoutId="move-filter"
              gradientClassName="from-cyan-600 to-blue-600"
              className="overflow-x-auto"
            />
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
          <div className="space-y-3">
            <AnimatePresence>
              {filtered.map((m, i) => {
                const typeConfig = movementTypes[m.type as keyof typeof movementTypes] || movementTypes.inbound;
                const Icon = typeConfig.icon;
                return (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                    whileHover={{ y: -2 }}
                    className="bg-card rounded-xl border border-border shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-none hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:hover:shadow-none transition-shadow duration-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
                      aria-expanded={expandedId === m.id}
                      className="w-full p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors text-left"
                    >
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${typeConfig.gradient} flex items-center justify-center text-white shadow-sm`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-[13px] font-semibold">{m.movement_number || m.id}</span>
                          <StatusBadge label={typeConfig.label} variant={typeConfig.color as "success" | "warning" | "danger" | "info"} dot />
                          <ReasonBadge reasonCode={m.reason_code} />
                          <span className="text-[11px] text-muted-foreground ml-auto">{formatDate(m.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                          <span className="font-medium">{m.book_title}</span>
                          <span>·</span>
                          {(() => { const d = formatDeltaLabel(m); return <span className={`font-medium ${d.className}`}>{d.text}</span>; })()}
                        </div>
                      </div>
                      <motion.div animate={{ rotate: expandedId === m.id ? 180 : 0 }} transition={{ duration: 0.2 }}>
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </motion.div>
                    </button>

                    <AnimatePresence>
                      {expandedId === m.id && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                          className="border-t border-border">
                          <div className="p-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              {(
                                [
                                  { label: "FROM/TO", value: m.transfer_note || `${m.from_location_code || "-"} → ${m.to_location_code || "-"}` },
                                  { label: "WAREHOUSE", value: m.warehouse_name || m.warehouse_code || "-" },
                                  { label: "LOCATION", value: m.to_location_code || m.from_location_code || "-", mono: true },
                                  { label: "USER", value: m.created_by_user_id || "-" },
                                  { label: "QTY", value: formatDeltaLabel(m).text, bold: true, colored: true, positive: m.delta >= 0 },
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
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </div>
  );
}
