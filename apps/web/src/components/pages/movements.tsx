import { useEffect, useMemo, useState } from "react";
import { Search, ArrowDown, ArrowUp, ArrowRightLeft, Minus, BookOpen, RotateCcw, ChevronDown } from "lucide-react";
import { StatusBadge } from "../status-badge";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion, AnimatePresence } from "motion/react";
import { stockMovementService, type StockMovement } from "@/services/stock-movement";
import { getApiErrorMessage } from "@/services/api";
import { toast } from "sonner";

const movementTypes = {
  inbound: { label: "Inbound", color: "emerald", icon: ArrowDown, gradient: "from-emerald-500 to-teal-500" },
  outbound: { label: "Outbound", color: "rose", icon: ArrowUp, gradient: "from-rose-500 to-red-500" },
  transfer: { label: "Transfer", color: "blue", icon: ArrowRightLeft, gradient: "from-blue-500 to-indigo-500" },
  adjustment: { label: "Adjustment", color: "amber", icon: Minus, gradient: "from-amber-500 to-orange-500" },
  borrow: { label: "Borrow", color: "violet", icon: BookOpen, gradient: "from-violet-500 to-purple-500" },
  return: { label: "Return", color: "cyan", icon: RotateCcw, gradient: "from-cyan-500 to-blue-500" },
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
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-cyan-100 to-blue-50 flex items-center justify-center border border-cyan-200/40">
              <ArrowRightLeft className="w-5 h-5 text-cyan-600" />
            </div>
            <div>
              <h1 className="tracking-[-0.02em]">Stock Movements</h1>
              <p className="text-[12px] text-slate-400 mt-0.5">{movements.length} movements · View audit trail</p>
            </div>
          </div>
        </div>
      </FadeItem>

      {/* Filters */}
      <FadeItem>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search movements..."
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-cyan-100/60 rounded-[10px] text-[13px] outline-none focus:ring-[3px] focus:ring-cyan-500/10 focus:border-cyan-300/60 transition-all shadow-sm" />
          </div>
          <div className="flex items-center gap-1 bg-white border border-slate-200/60 rounded-[10px] p-[3px] shadow-sm overflow-x-auto">
            {[{ id: "all", label: "All" }, ...Object.entries(movementTypes).map(([k, v]) => ({ id: k, label: v.label }))] .map(f => (
              <button key={f.id} onClick={() => setTypeFilter(f.id)} className={`relative px-3.5 py-1.5 rounded-[8px] text-[12px] whitespace-nowrap transition-all duration-160 ${typeFilter === f.id ? "text-white" : "text-slate-500 hover:text-slate-700"}`} style={{ fontWeight: 550 }}>
                {typeFilter === f.id && <motion.div layoutId="move-filter" className="absolute inset-0 rounded-[8px] bg-gradient-to-r from-cyan-600 to-blue-600 shadow-sm" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
                <span className="relative z-10">{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      </FadeItem>

      {/* Movements List */}
      <FadeItem>
        <div className="space-y-3">
          <AnimatePresence>
            {loading ? (
              <div className="text-center py-14 text-[13px] text-slate-400">Dang tai stock movements...</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-14">
                <ArrowRightLeft className="w-8 h-8 text-cyan-300 mx-auto mb-2" />
                <p className="text-[13px] text-slate-400">No movements found</p>
              </div>
            ) : filtered.map((m, i) => {
              const typeConfig = movementTypes[m.type as keyof typeof movementTypes] || movementTypes.inbound;
              const Icon = typeConfig.icon;
              return (
                <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  className="bg-white rounded-[12px] border border-white/80 overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-all duration-200">
                  <button onClick={() => setExpandedId(expandedId === m.id ? null : m.id)} className="w-full p-4 flex items-center gap-4 hover:bg-slate-50/40 transition-colors text-left">
                    <div className={`w-10 h-10 rounded-[10px] bg-gradient-to-br ${typeConfig.gradient} flex items-center justify-center text-white`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-1">
                        <span className="text-[13px]" style={{ fontWeight: 650 }}>{m.movement_number || m.id}</span>
                        <StatusBadge label={typeConfig.label} variant={typeConfig.color} dot />
                        <span className="text-[11px] text-slate-400 ml-auto">{formatDate(m.created_at)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[12px] text-slate-600">
                        <span style={{ fontWeight: 550 }}>{m.book_title}</span>
                        <span className="text-slate-400">·</span>
                        <span className={m.type === "transfer" ? "text-blue-600" : (m.delta >= 0 ? "text-emerald-600" : "text-rose-600")} style={{ fontWeight: 550 }}>
                          {m.delta >= 0 ? "+" : ""}{m.delta} units
                        </span>
                      </div>
                    </div>
                    <motion.div animate={{ rotate: expandedId === m.id ? 180 : 0 }} transition={{ duration: 0.2 }}>
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    </motion.div>
                  </button>

                  {/* Expanded Details */}
                  <AnimatePresence>
                    {expandedId === m.id && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}
                        className="border-t border-slate-100">
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
                                <p className="text-[10px] text-slate-400 uppercase mb-1" style={{ fontWeight: 550 }}>{f.label}</p>
                                <p className={`text-[12px] ${f.mono ? "font-mono text-slate-500" : ""} ${f.bold ? "text-slate-700" : "text-slate-600"}`} style={{ fontWeight: f.bold ? 600 : 500 }}>
                                  {f.value}
                                </p>
                              </div>
                            ))}
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-400 uppercase mb-1" style={{ fontWeight: 550 }}>Notes</p>
                            <p className="text-[12px] text-slate-600">
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
      </FadeItem>

      {/* Summary */}
      <FadeItem>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Inbound", value: summary.inbound, color: "from-emerald-50 to-teal-50/50 border-emerald-100/60" },
            { label: "Total Outbound", value: summary.outbound, color: "from-rose-50 to-red-50/50 border-rose-100/60" },
            { label: "Transfers", value: summary.transfer, color: "from-blue-50 to-indigo-50/50 border-blue-100/60" },
            { label: "Records", value: movements.length, color: "from-amber-50 to-orange-50/50 border-amber-100/60" },
          ].map(s => (
            <div key={s.label} className={`bg-gradient-to-br ${s.color} rounded-[12px] border p-3`}>
              <p className="text-[11px] text-slate-500 mb-1" style={{ fontWeight: 550 }}>{s.label}</p>
              <p className="text-[22px] text-slate-700" style={{ fontWeight: 700, lineHeight: 1 }}>{s.value}</p>
            </div>
          ))}
        </div>
      </FadeItem>
    </PageWrapper>
  );
}
