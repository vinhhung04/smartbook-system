import { NavLink } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  LayoutDashboard, BookOpen, Package, FileText, Warehouse, ArrowRightLeft,
  Sparkles, ThumbsUp, BookMarked, Users, Shield, ScanBarcode, ChevronLeft,
  UserRound, CalendarClock, HandCoins, ClipboardCheck, Layers3
} from "lucide-react";
import { authService } from "@/services/auth";

const navGroups = [
  {
    label: "Core Operations",
    color: "text-indigo-400",
    items: [
      { to: "/", icon: LayoutDashboard, label: "Dashboard", activeColor: "from-indigo-500/15 to-blue-500/10", textColor: "text-indigo-600", iconBg: "bg-indigo-500/10" },
      { to: "/catalog", icon: BookOpen, label: "Catalog", activeColor: "from-blue-500/15 to-teal-500/10", textColor: "text-blue-600", iconBg: "bg-blue-500/10" },
      { to: "/inventory", icon: Package, label: "Inventory", activeColor: "from-emerald-500/15 to-teal-500/10", textColor: "text-emerald-600", iconBg: "bg-emerald-500/10" },
      { to: "/orders", icon: FileText, label: "Goods Receipts", activeColor: "from-indigo-500/15 to-amber-500/5", textColor: "text-indigo-600", iconBg: "bg-indigo-500/10" },
      { to: "/putaway", icon: ClipboardCheck, label: "Putaway", activeColor: "from-violet-500/15 to-fuchsia-500/10", textColor: "text-violet-600", iconBg: "bg-violet-500/10" },
      { to: "/warehouses", icon: Warehouse, label: "Warehouses", activeColor: "from-emerald-500/12 to-green-500/8", textColor: "text-emerald-600", iconBg: "bg-emerald-500/10" },
      { to: "/shelves", icon: Layers3, label: "Shelves", activeColor: "from-cyan-500/12 to-blue-500/8", textColor: "text-cyan-700", iconBg: "bg-cyan-500/10" },
      { to: "/movements", icon: ArrowRightLeft, label: "Stock Movements", activeColor: "from-blue-500/12 to-emerald-500/8", textColor: "text-blue-600", iconBg: "bg-blue-500/10" },
    ],
  },
  {
    label: "Intelligence",
    color: "text-violet-400",
    items: [
      { to: "/ai-import", icon: Sparkles, label: "AI Import", activeColor: "from-cyan-500/15 to-violet-500/10", textColor: "text-cyan-600", iconBg: "bg-cyan-500/10" },
      { to: "/recommendations", icon: ThumbsUp, label: "Recommendations", activeColor: "from-violet-500/15 to-blue-500/10", textColor: "text-violet-600", iconBg: "bg-violet-500/10" },
    ],
  },
  {
    label: "Library",
    color: "text-amber-400",
    items: [
      { to: "/borrow", icon: BookMarked, label: "Borrow", activeColor: "from-amber-500/15 to-orange-500/8", textColor: "text-amber-600", iconBg: "bg-amber-500/10" },
      { to: "/borrow/customers", icon: UserRound, label: "Borrow Customers", activeColor: "from-amber-500/15 to-yellow-500/8", textColor: "text-amber-600", iconBg: "bg-amber-500/10" },
      { to: "/borrow/reservations", icon: CalendarClock, label: "Reservations", activeColor: "from-orange-500/15 to-amber-500/8", textColor: "text-orange-600", iconBg: "bg-orange-500/10" },
      { to: "/borrow/loans", icon: HandCoins, label: "Loans", activeColor: "from-emerald-500/15 to-teal-500/8", textColor: "text-emerald-600", iconBg: "bg-emerald-500/10" },
      { to: "/borrow/fines", icon: ClipboardCheck, label: "Fines", activeColor: "from-rose-500/15 to-amber-500/8", textColor: "text-rose-600", iconBg: "bg-rose-500/10" },
    ],
  },
  {
    label: "Administration",
    color: "text-slate-400",
    items: [
      { to: "/users", icon: Users, label: "Users", activeColor: "from-slate-500/12 to-indigo-500/8", textColor: "text-slate-600", iconBg: "bg-slate-500/10" },
      { to: "/roles", icon: Shield, label: "Roles", activeColor: "from-indigo-500/12 to-purple-500/8", textColor: "text-indigo-600", iconBg: "bg-indigo-500/10" },
    ],
  },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const user = authService.getCurrentUser();
  const initials = (user?.full_name || user?.username || "AD")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "AD";

  return (
    <motion.aside
      animate={{ width: collapsed ? 68 : 256 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="h-screen bg-[#fafbfe] border-r border-[#e2e4ed] flex flex-col shrink-0 relative z-20"
    >
      {/* Logo */}
      <div className="h-[56px] flex items-center justify-between px-4 border-b border-[#e2e4ed]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-indigo-600 via-blue-600 to-violet-600 flex items-center justify-center shrink-0 shadow-md shadow-indigo-500/25">
            <BookOpen className="w-4 h-4 text-white" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2 }}>
                <span className="text-[15px] tracking-[-0.3px] bg-gradient-to-r from-indigo-700 to-violet-600 bg-clip-text text-transparent" style={{ fontWeight: 700 }}>SmartBook</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <button onClick={onToggle} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-indigo-50 transition-colors text-muted-foreground hover:text-indigo-600">
          <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.24 }}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </motion.div>
        </button>
      </div>

      {/* Scan CTA */}
      <div className="px-3 pt-4 pb-1">
        <NavLink
          to="/orders/new"
          className={`group flex items-center gap-2.5 rounded-[10px] bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 text-white text-[13px] shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 active:scale-[0.98] transition-all duration-140 ${collapsed ? "justify-center px-0 py-2.5" : "px-3.5 py-2.5"}`}
          style={{ fontWeight: 500 }}
        >
          <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}>
            <ScanBarcode className="w-4 h-4" />
          </motion.div>
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                Scan & Receive
              </motion.span>
            )}
          </AnimatePresence>
        </NavLink>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {navGroups.map((group) => (
          <div key={group.label} className="pt-4 first:pt-1">
            <AnimatePresence>
              {!collapsed && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 px-3 pb-2">
                  <div className={`w-1 h-1 rounded-full ${group.color.replace("text-", "bg-")}`} />
                  <span className={`text-[10px] uppercase tracking-[0.08em] ${group.color}`} style={{ fontWeight: 600 }}>{group.label}</span>
                </motion.div>
              )}
            </AnimatePresence>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `group flex items-center gap-2.5 px-3 py-[7px] rounded-[9px] text-[13px] transition-all duration-160 relative overflow-hidden ${
                    isActive ? item.textColor : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                  } ${collapsed ? "justify-center" : ""}`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-active-pill"
                        className={`absolute inset-0 rounded-[9px] bg-gradient-to-r ${item.activeColor} border border-white/50`}
                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      />
                    )}
                    <div className={`w-[22px] h-[22px] rounded-[6px] flex items-center justify-center shrink-0 relative z-10 transition-colors duration-160 ${
                      isActive ? item.iconBg : "group-hover:bg-slate-100"
                    }`}>
                      <item.icon className="w-[14px] h-[14px]" />
                    </div>
                    <AnimatePresence>
                      {!collapsed && (
                        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                          className="relative z-10" style={{ fontWeight: isActive ? 550 : 400 }}>
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-[#e2e4ed] p-3">
        <div className={`flex items-center gap-2.5 px-2 py-2.5 rounded-[10px] bg-gradient-to-r from-indigo-50/80 to-violet-50/50 border border-indigo-100/40 cursor-pointer hover:border-indigo-200/60 transition-all duration-160 ${collapsed ? "justify-center" : ""}`}>
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shrink-0 shadow-sm shadow-indigo-500/20">
            <span className="text-[10px] text-white" style={{ fontWeight: 700 }}>{initials}</span>
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex-1 min-w-0">
                <div className="text-[13px] truncate" style={{ fontWeight: 550 }}>{user?.full_name || user?.username || "Admin User"}</div>
                <div className="text-[11px] text-indigo-400 truncate">{user?.email || "admin@smartbook.vn"}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.aside>
  );
}
