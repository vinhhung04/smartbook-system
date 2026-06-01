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

const movementTypes = {
  inbound: { label: "Nhập kho", color: "emerald", icon: ArrowDown, gradient: "from-emerald-500 to-teal-500" },
  outbound: { label: "Xuất kho", color: "rose", icon: ArrowUp, gradient: "from-rose-500 to-red-500" },
  transfer: { label: "Chuyển kho", color: "blue", icon: ArrowRightLeft, gradient: "from-blue-500 to-indigo-500" },
  adjustment: { label: "Điều chỉnh", color: "amber", icon: Minus, gradient: "from-amber-500 to-orange-500" },
  borrow: { label: "Mượn", color: "violet", icon: BookOpen, gradient: "from-violet-500 to-purple-500" },
  return: { label: "Trả", color: "sky", icon: RotateCcw, gradient: "from-sky-500 to-blue-500" },
};

const REASON_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  LOST:           { label: "Mất sách",    icon: AlertTriangle, className: "bg-red-50 text-red-700 border-red-200" },
  DAMAGED_RETURN: { label: "Trả hư hỏng", icon: Wrench,        className: "bg-orange-50 text-orange-700 border-orange-200" },
  RETURNED:       { label: "Trả bình thường", icon: RotateCcw,  className: "bg-sky-50 text-sky-700 border-sky-200" },
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
      code === 'LOST'           ? 'text-red-600' :
      code === 'DAMAGED_RETURN' ? 'text-orange-600' :
      'text-emerald-600';
    return { text: fn(Math.abs(m.delta)), className: colorClass };
  }
  if (m.type === 'transfer') return { text: `${Math.abs(m.delta)} cuốn`, className: 'text-blue-600' };
  return {
    text: `${m.delta >= 0 ? '+' : ''}${m.delta} cuốn`,
    className: m.delta >= 0 ? 'text-emerald-600' : 'text-rose-600',
  };
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

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center gap-3"
      >
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-100 to-blue-50 flex items-center justify-center border border-cyan-200/40">
          <ArrowRightLeft className="w-5 h-5 text-cyan-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Biến động tồn kho</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">{movements.length} biến động</p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="flex items-center gap-3 flex-wrap"
      >
        <div className="relative flex-1 max-w-sm">
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Tìm biến động..."
            className="w-full pl-9 pr-4 py-2.5 bg-card border border-input rounded-xl text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
          />
          <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </div>
        <div className="flex items-center gap-1 bg-card border border-input rounded-lg p-[3px] shadow-sm overflow-x-auto">
          {[{ id: "all", label: "Tất cả" }, ...Object.entries(movementTypes).map(([k, v]) => ({ id: k, label: v.label }))].map(f => (
            <button key={f.id} onClick={() => setTypeFilter(f.id)} className={`relative px-3.5 py-1.5 rounded-lg text-[12px] whitespace-nowrap transition-all duration-160 font-medium ${typeFilter === f.id ? "text-white" : "text-muted-foreground hover:text-foreground"}`}>
              {typeFilter === f.id && <motion.div layoutId="move-filter" className="absolute inset-0 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 shadow-sm" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
              <span className="relative z-10">{f.label}</span>
            </button>
          ))}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        {loading ? (
          <SectionCard><p className="text-center py-12 text-[13px] text-muted-foreground">Đang tải lịch sử tồn kho...</p></SectionCard>
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
                    className="bg-card rounded-xl border border-black/5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-all duration-200 overflow-hidden">
                    <button onClick={() => setExpandedId(expandedId === m.id ? null : m.id)} className="w-full p-4 flex items-center gap-4 hover:bg-muted/40 transition-colors text-left">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${typeConfig.gradient} flex items-center justify-center text-white`}>
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
                              {[
                                { label: "FROM/TO", value: m.transfer_note || `${m.from_location_code || "-"} → ${m.to_location_code || "-"}` },
                                { label: "WAREHOUSE", value: m.warehouse_name || m.warehouse_code || "-" },
                                { label: "LOCATION", value: m.to_location_code || m.from_location_code || "-", mono: true },
                                { label: "USER", value: m.created_by_user_id || "-" },
                                { label: "QTY", value: formatDeltaLabel(m).text, bold: true, colored: true, positive: m.delta >= 0 },
                              ].map(f => (
                                <div key={f.label}>
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">{f.label}</p>
                                  <p
                                    className={`text-[12px] ${(f as any).mono ? "font-mono text-muted-foreground" : ""} ${(f as any).colored ? ((f as any).positive ? "text-emerald-600" : "text-rose-600") : "text-muted-foreground"}`}
                                    style={{ fontWeight: (f as any).bold ? 600 : 500 }}
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

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.15 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <StatCard label="Tổng nhập" value={summary.inbound} variant="success" />
        <StatCard label="Tổng xuất" value={summary.outbound} variant="danger" />
        <StatCard label="Chuyển kho" value={summary.transfer} variant="info" />
        <StatCard label="Records" value={movements.length} variant="default" />
      </motion.div>
    </div>
  );
}
