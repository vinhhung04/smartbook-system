import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowRightLeft, Minus, BookOpen, RotateCcw, ChevronDown } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { motion, AnimatePresence } from "motion/react";
import { stockMovementService, type StockMovement } from "@/services/stock-movement";
import { getApiErrorMessage } from "@/services/api";
import { toast } from "sonner";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/ui/stat-card";

const movementTypes = {
  inbound: { label: "Inbound", color: "emerald", icon: ArrowDown, gradient: "from-emerald-500 to-teal-500" },
  outbound: { label: "Outbound", color: "rose", icon: ArrowUp, gradient: "from-rose-500 to-red-500" },
  transfer: { label: "Transfer", color: "blue", icon: ArrowRightLeft, gradient: "from-blue-500 to-indigo-500" },
  adjustment: { label: "Adjustment", color: "amber", icon: Minus, gradient: "from-amber-500 to-orange-500" },
  borrow: { label: "Borrow", color: "violet", icon: BookOpen, gradient: "from-violet-500 to-purple-500" },
  return: { label: "Return", color: "sky", icon: RotateCcw, gradient: "from-sky-500 to-blue-500" },
};

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
      toast.error(getApiErrorMessage(error, "Khong tai duoc lich su stock movements"));
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
          <h1 className="text-xl font-semibold tracking-tight">Stock Movements</h1>
          <p className="text-[12px] text-muted-foreground mt-0.5">{movements.length} movements · View audit trail</p>
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
            placeholder="Search movements..."
            className="w-full pl-9 pr-4 py-2.5 bg-card border border-input rounded-xl text-[13px] outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary/40 transition-all"
          />
          <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        </div>
        <div className="flex items-center gap-1 bg-card border border-input rounded-lg p-[3px] shadow-sm overflow-x-auto">
          {[{ id: "all", label: "All" }, ...Object.entries(movementTypes).map(([k, v]) => ({ id: k, label: v.label }))].map(f => (
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
          <SectionCard><p className="text-center py-12 text-[13px] text-muted-foreground">Dang tai stock movements...</p></SectionCard>
        ) : filtered.length === 0 ? (
          <SectionCard><EmptyState variant="no-results" title="No movements found" description="Try adjusting your search or filters" className="py-12" /></SectionCard>
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
                        <div className="flex items-center gap-2.5 mb-1">
                          <span className="text-[13px] font-semibold">{m.movement_number || m.id}</span>
                          <StatusBadge label={typeConfig.label} variant={typeConfig.color as "success" | "warning" | "danger" | "info"} dot />
                          <span className="text-[11px] text-muted-foreground ml-auto">{formatDate(m.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                          <span className="font-medium">{m.book_title}</span>
                          <span>·</span>
                          <span className={m.type === "transfer" ? "text-blue-600" : (m.delta >= 0 ? "text-emerald-600" : "text-rose-600") + " font-medium"}>
                            {m.delta >= 0 ? "+" : ""}{m.delta} units
                          </span>
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
                                { label: "From/To", value: m.transfer_note || `${m.from_location_code || "-"} -> ${m.to_location_code || "-"}` },
                                { label: "Warehouse", value: m.warehouse_name || m.warehouse_code || "-" },
                                { label: "Location", value: m.to_location_code || m.from_location_code || "-", mono: true },
                                { label: "User", value: m.created_by_user_id || "-" },
                                { label: "Qty", value: `${m.delta >= 0 ? "+" : ""}${m.delta}`, bold: true },
                              ].map(f => (
                                <div key={f.label}>
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">{f.label}</p>
                                  <p className={`text-[12px] ${f.mono ? "font-mono text-muted-foreground" : ""} ${f.bold ? "text-foreground" : "text-muted-foreground"}`} style={{ fontWeight: f.bold ? 600 : 500 }}>
                                    {f.value}
                                  </p>
                                </div>
                              ))}
                            </div>
                            <div>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-1">Notes</p>
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
        <StatCard label="Total Inbound" value={summary.inbound} variant="success" />
        <StatCard label="Total Outbound" value={summary.outbound} variant="danger" />
        <StatCard label="Transfers" value={summary.transfer} variant="info" />
        <StatCard label="Records" value={movements.length} variant="default" />
      </motion.div>
    </div>
  );
}
