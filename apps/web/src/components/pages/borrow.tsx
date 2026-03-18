import { useState } from "react";
import { PageWrapper, FadeItem } from "../motion-utils";
import { motion, AnimatePresence } from "motion/react";
import { StatusBadge } from "../status-badge";
import { BookMarked, AlertCircle, Clock, Plus, RotateCcw, CheckCircle } from "lucide-react";
import { toast } from "sonner";

const borrowsData = [
  { id: "BRW-2026-0012", book: "Clean Code", borrower: "John Doe", dueDate: "2026-03-25", status: "active", daysRemaining: 2, fines: 0 },
  { id: "BRW-2026-0011", book: "Design Patterns", borrower: "Jane Smith", dueDate: "2026-03-22", status: "overdue", daysRemaining: -3, fines: "90,000 VND" },
  { id: "BRW-2026-0010", book: "Head First Design Patterns", borrower: "Mike Johnson", dueDate: "2026-03-30", status: "active", daysRemaining: 7, fines: 0 },
  { id: "BRW-2026-0009", book: "Effective Java", borrower: "Sarah Wilson", dueDate: "2026-03-28", status: "due-soon", daysRemaining: 5, fines: 0 },
  { id: "BRW-2026-0008", book: "Refactoring", borrower: "Robert Brown", dueDate: "2026-03-20", status: "returned", returnDate: "2026-03-20", fines: "0 VND" },
  { id: "BRW-2026-0007", book: "Working Effectively with Legacy Code", borrower: "Emily Davis", dueDate: "2026-03-18", status: "returned", returnDate: "2026-03-18", fines: "0 VND" },
  { id: "BRW-2026-0006", book: "Programming Rust", borrower: "Alex Martinez", dueDate: "2026-04-10", status: "active", daysRemaining: 21, fines: 0 },
];

export function BorrowPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [showNewBorrow, setShowNewBorrow] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(null);

  const filtered = borrowsData.filter(b => {
    if (statusFilter === "overdue" && b.status !== "overdue") return false;
    if (statusFilter === "active" && (b.status === "overdue" || b.status === "returned")) return false;
    if (statusFilter === "returned" && b.status !== "returned") return false;
    return true;
  });

  const activeCount = borrowsData.filter(b => b.status === "active").length;
  const overdueCount = borrowsData.filter(b => b.status === "overdue").length;
  const dueSoonCount = borrowsData.filter(b => b.status === "due-soon").length;
  const totalFines = borrowsData.filter(b => b.status === "overdue").length * 30;

  const getStatusColor = (status) => {
    return status === "active" ? "success" : status === "overdue" ? "danger" : status === "due-soon" ? "warning" : "info";
  };

  const getStatusLabel = (status) => {
    return status === "active" ? "Active" : status === "overdue" ? "Overdue" : status === "due-soon" ? "Due Soon" : "Returned";
  };

  return (
    <PageWrapper className="space-y-5">
      <FadeItem>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[12px] bg-gradient-to-br from-rose-100 to-pink-50 flex items-center justify-center border border-rose-200/40">
              <BookMarked className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h1 className="tracking-[-0.02em]">Library Borrows</h1>
              <p className="text-[12px] text-slate-400 mt-0.5">{activeCount} active borrows · {overdueCount} overdue</p>
            </div>
          </div>
          <button onClick={() => setShowNewBorrow(true)} className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] bg-gradient-to-r from-rose-600 to-pink-600 text-white text-[13px] shadow-md shadow-rose-500/15 hover:shadow-lg transition-all" style={{ fontWeight: 550 }}>
            <Plus className="w-3.5 h-3.5" /> New Borrow
          </button>
        </div>
      </FadeItem>

      {/* Summary KPIs */}
      <FadeItem>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Active", val: activeCount, color: "from-emerald-50 to-teal-50/50 border-emerald-100/60", textColor: "text-emerald-700" },
            { label: "Overdue", val: overdueCount, color: "from-rose-50 to-red-50/50 border-rose-100/60", textColor: "text-rose-700" },
            { label: "Due Soon", val: dueSoonCount, color: "from-amber-50 to-orange-50/50 border-amber-100/60", textColor: "text-amber-700" },
            { label: "Total Fines", val: `${totalFines}K VND`, color: "from-violet-50 to-purple-50/50 border-violet-100/60", textColor: "text-violet-700" },
          ].map(s => (
            <motion.div key={s.label} whileHover={{ y: -2 }} className={`bg-gradient-to-br ${s.color} rounded-[12px] border p-3`}>
              <p className="text-[11px] text-slate-500 mb-1" style={{ fontWeight: 550 }}>{s.label}</p>
              <p className={`text-[22px] ${s.textColor}`} style={{ fontWeight: 700, lineHeight: 1 }}>{s.val}</p>
            </motion.div>
          ))}
        </div>
      </FadeItem>

      {/* Filters */}
      <FadeItem>
        <div className="flex items-center gap-1 bg-white border border-slate-200/60 rounded-[10px] p-[3px] shadow-sm w-fit">
          {[{ id: "all", label: "All" }, { id: "active", label: "Active" }, { id: "due-soon", label: "Due Soon" }, { id: "overdue", label: "Overdue" }, { id: "returned", label: "Returned" }].map(f => (
            <button key={f.id} onClick={() => setStatusFilter(f.id)} className={`relative px-3.5 py-1.5 rounded-[8px] text-[12px] transition-all duration-160 ${statusFilter === f.id ? "text-white" : "text-slate-500 hover:text-slate-700"}`} style={{ fontWeight: 550 }}>
              {statusFilter === f.id && <motion.div layoutId="borrow-filter" className="absolute inset-0 rounded-[8px] bg-gradient-to-r from-rose-600 to-pink-600 shadow-sm" transition={{ duration: 0.22 }} />}
              <span className="relative z-10">{f.label}</span>
            </button>
          ))}
        </div>
      </FadeItem>

      {/* Table */}
      <FadeItem>
        <div className="bg-white rounded-[16px] border border-white/80 overflow-hidden shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-gradient-to-r from-rose-50/40 to-transparent">
                {["Borrow ID", "Book", "Borrower", "Due Date", "Status", "Days", "Action"].map(h => (
                  <th key={h} className="text-left text-[11px] text-slate-400 px-5 py-3 uppercase tracking-[0.05em]" style={{ fontWeight: 550 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-14">
                  <BookMarked className="w-8 h-8 text-rose-300 mx-auto mb-2" />
                  <p className="text-[13px] text-slate-400">No borrows found</p>
                </td></tr>
              ) : filtered.map((b) => (
                <motion.tr key={b.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.02 }}
                  className={`border-b border-slate-50 last:border-0 hover:bg-rose-50/20 transition-all ${b.status === "active" ? "bg-white" : ""}`}>
                  <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 550 }}>{b.id}</td>
                  <td className="px-5 py-3.5 text-[13px]">{b.book}</td>
                  <td className="px-5 py-3.5 text-[13px] text-slate-600">{b.borrower}</td>
                  <td className="px-5 py-3.5 text-[12px] text-slate-500">{b.dueDate}</td>
                  <td className="px-5 py-3.5">
                    <StatusBadge label={getStatusLabel(b.status)} variant={getStatusColor(b.status)} dot />
                  </td>
                  <td className="px-5 py-3.5 text-[13px]" style={{ fontWeight: 550 }}>
                    <span className={b.status === "overdue" ? "text-red-600" : b.status === "due-soon" ? "text-amber-600" : "text-emerald-600"}>
                      {b.status === "returned" ? "—" : `${b.daysRemaining} days`}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    {b.status === "overdue" && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowReturnModal(b.id)} className="px-2.5 py-1 rounded-[6px] border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] hover:bg-emerald-100 transition-all" style={{ fontWeight: 550 }}>
                          Return
                        </button>
                        <span className="text-[11px] text-red-600" style={{ fontWeight: 550 }}>+{b.fines}</span>
                      </div>
                    )}
                    {b.status === "active" && (
                      <button className="px-2.5 py-1 rounded-[6px] border border-blue-200 bg-blue-50 text-blue-700 text-[11px] hover:bg-blue-100 transition-all" style={{ fontWeight: 550 }}>
                        <Clock className="w-3 h-3 inline mr-1" /> Extend
                      </button>
                    )}
                    {b.status === "returned" && <span className="text-[11px] text-slate-500">✓ Returned</span>}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </FadeItem>

      {/* New Borrow Modal */}
      <AnimatePresence>
        {showNewBorrow && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[16px] p-6 max-w-sm shadow-2xl">
              <h3 className="text-[16px] mb-4" style={{ fontWeight: 650 }}>New Borrow</h3>
              <div className="space-y-4 mb-4">
                <div>
                  <label className="text-[12px] text-slate-600 block mb-2" style={{ fontWeight: 550 }}>Book</label>
                  <input placeholder="Select book..." className="w-full px-3 py-2 border border-slate-200 rounded-[8px] text-[13px] outline-none focus:ring-[2px] focus:ring-rose-500/15 focus:border-rose-300" />
                </div>
                <div>
                  <label className="text-[12px] text-slate-600 block mb-2" style={{ fontWeight: 550 }}>Borrower</label>
                  <input placeholder="Enter borrower name..." className="w-full px-3 py-2 border border-slate-200 rounded-[8px] text-[13px] outline-none focus:ring-[2px] focus:ring-rose-500/15 focus:border-rose-300" />
                </div>
                <div>
                  <label className="text-[12px] text-slate-600 block mb-2" style={{ fontWeight: 550 }}>Due Date</label>
                  <input type="date" className="w-full px-3 py-2 border border-slate-200 rounded-[8px] text-[13px] outline-none focus:ring-[2px] focus:ring-rose-500/15 focus:border-rose-300" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowNewBorrow(false)} className="flex-1 px-4 py-2.5 rounded-[10px] border border-slate-200 bg-white text-slate-700 text-[13px] hover:bg-slate-50" style={{ fontWeight: 550 }}>
                  Cancel
                </button>
                <button onClick={() => { setShowNewBorrow(false); toast.success("Borrow recorded"); }} className="flex-1 px-4 py-2.5 rounded-[10px] bg-gradient-to-r from-rose-600 to-pink-600 text-white text-[13px] shadow-md" style={{ fontWeight: 550 }}>
                  Create
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Return Confirmation Modal */}
      <AnimatePresence>
        {showReturnModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-[16px] p-6 max-w-sm shadow-2xl">
              <div className="flex items-center gap-3 mb-3">
                <AlertCircle className="w-6 h-6 text-amber-500" />
                <h3 className="text-[16px]" style={{ fontWeight: 650 }}>Confirm Return</h3>
              </div>
              <p className="text-[13px] text-slate-600 mb-4">This item is <span style={{ fontWeight: 600, color: "#dc2626" }}>3 days overdue</span>. Fine: <span style={{ fontWeight: 600, color: "#dc2626" }}>90,000 VND</span></p>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowReturnModal(null)} className="flex-1 px-4 py-2.5 rounded-[10px] border border-slate-200 bg-white text-slate-700 text-[13px] hover:bg-slate-50" style={{ fontWeight: 550 }}>
                  Cancel
                </button>
                <button onClick={() => { setShowReturnModal(null); toast.success("Book returned. Fine recorded."); }} className="flex-1 px-4 py-2.5 rounded-[10px] bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[13px] shadow-md flex items-center justify-center gap-2" style={{ fontWeight: 550 }}>
                  <CheckCircle className="w-4 h-4" /> Return
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageWrapper>
  );
}
