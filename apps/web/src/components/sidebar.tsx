import { NavLink } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  LayoutDashboard, BookOpen, Package, FileText, Warehouse,
  Sparkles, ThumbsUp, BookMarked, Users, Shield, ScanBarcode, ChevronLeft,
  UserRound, CalendarClock, HandCoins, Layers3,
  MapPinned, ListOrdered, Inbox, Hand, Truck, Activity, Receipt, BarChart3, ScrollText, Crown, ClipboardCheck, ClipboardList,
  ShoppingCart, AlertTriangle, PackageCheck,
} from "lucide-react";
import { authService } from "@/services/auth";
import { canAccess, ROUTE_ACCESS } from "@/lib/rbac";
import { useI18n } from "@/lib/i18n";

const navGroups = [
  {
    labelKey: "sidebar.group.today",
    color: "text-emerald-500",
    dotColor: "bg-emerald-400",
    items: [
      { to: "/my-warehouse-tasks", icon: ClipboardList, labelKey: "sidebar.my_tasks", access: ROUTE_ACCESS.staffTasks, activeColor: "from-emerald-500/15 to-teal-500/10", textColor: "text-emerald-700", iconBg: "bg-emerald-500/10" },
      { to: "/my-purchase-requests", icon: ShoppingCart, labelKey: "sidebar.my_purchase_requests", access: ROUTE_ACCESS.purchaseRequestSelf, activeColor: "from-orange-500/15 to-amber-500/10", textColor: "text-orange-700", iconBg: "bg-orange-500/10" },
      { to: "/my-exception-reports", icon: AlertTriangle, labelKey: "sidebar.my_exception_reports", access: ROUTE_ACCESS.exceptionReportSelf, activeColor: "from-red-500/15 to-rose-500/10", textColor: "text-red-700", iconBg: "bg-red-500/10" },
      { to: "/staff-tasks", icon: ClipboardCheck, labelKey: "sidebar.staff_tasks", access: ROUTE_ACCESS.staffTaskProgress, activeColor: "from-violet-500/15 to-fuchsia-500/10", textColor: "text-violet-700", iconBg: "bg-violet-500/10" },
      { to: "/", icon: LayoutDashboard, labelKey: "sidebar.dashboard", access: ROUTE_ACCESS.reports, activeColor: "from-indigo-500/15 to-blue-500/10", textColor: "text-indigo-600", iconBg: "bg-indigo-500/10" },
    ],
  },
  {
    labelKey: "sidebar.group.warehouse",
    color: "text-indigo-400",
    dotColor: "bg-indigo-400",
    items: [
      { to: "/order-requests", icon: ListOrdered, labelKey: "sidebar.order_requests", access: ROUTE_ACCESS.orderRequests, activeColor: "from-cyan-500/15 to-blue-500/10", textColor: "text-cyan-700", iconBg: "bg-cyan-500/10" },
      { to: "/picking", icon: Hand, labelKey: "sidebar.picking", access: ROUTE_ACCESS.managerStockDecision, activeColor: "from-emerald-500/15 to-cyan-500/10", textColor: "text-emerald-700", iconBg: "bg-emerald-500/10" },
      { to: "/packing", icon: PackageCheck, labelKey: "sidebar.packing", access: ROUTE_ACCESS.staffTaskProgress, activeColor: "from-fuchsia-500/15 to-purple-500/10", textColor: "text-fuchsia-700", iconBg: "bg-fuchsia-500/10" },
      { to: "/outbound", icon: Truck, labelKey: "sidebar.outbound", access: ROUTE_ACCESS.managerStockDecision, activeColor: "from-sky-500/15 to-cyan-500/10", textColor: "text-sky-700", iconBg: "bg-sky-500/10" },
      { to: "/receiving-check", icon: ClipboardList, labelKey: "sidebar.receiving_check", access: ROUTE_ACCESS.staffTaskProgress, activeColor: "from-teal-500/15 to-cyan-500/10", textColor: "text-teal-700", iconBg: "bg-teal-500/10" },
      { to: "/putaway", icon: MapPinned, labelKey: "sidebar.putaway", access: ROUTE_ACCESS.staffTaskProgress, activeColor: "from-violet-500/15 to-fuchsia-500/10", textColor: "text-violet-600", iconBg: "bg-violet-500/10" },
      { to: "/receiving-putaway", icon: Inbox, labelKey: "sidebar.receiving_putaway", access: ROUTE_ACCESS.warehousePutawayExecute, activeColor: "from-amber-500/15 to-orange-500/10", textColor: "text-amber-700", iconBg: "bg-amber-500/10" },
      { to: "/orders", icon: FileText, labelKey: "sidebar.goods_receipts", access: ROUTE_ACCESS.managerStockDecision, activeColor: "from-indigo-500/15 to-amber-500/5", textColor: "text-indigo-600", iconBg: "bg-indigo-500/10" },
      { to: "/inventory", icon: Package, labelKey: "sidebar.inventory", access: ROUTE_ACCESS.managerInventoryRead, activeColor: "from-emerald-500/15 to-teal-500/10", textColor: "text-emerald-600", iconBg: "bg-emerald-500/10" },
      { to: "/movements", icon: Activity, labelKey: "sidebar.movements", access: ROUTE_ACCESS.managerInventoryRead, activeColor: "from-blue-500/12 to-emerald-500/8", textColor: "text-blue-600", iconBg: "bg-blue-500/10" },
      { to: "/warehouses", icon: Warehouse, labelKey: "sidebar.warehouses", access: ROUTE_ACCESS.warehouseWrite, activeColor: "from-emerald-500/12 to-green-500/8", textColor: "text-emerald-600", iconBg: "bg-emerald-500/10" },
      { to: "/shelves", icon: Layers3, labelKey: "sidebar.shelves", access: ROUTE_ACCESS.managerInventoryRead, activeColor: "from-cyan-500/12 to-blue-500/8", textColor: "text-cyan-700", iconBg: "bg-cyan-500/10" },
      { to: "/exception-reports", icon: AlertTriangle, labelKey: "sidebar.exception_reports", access: ROUTE_ACCESS.exceptionReportManage, activeColor: "from-red-500/15 to-rose-500/10", textColor: "text-red-700", iconBg: "bg-red-500/10" },
    ],
  },
  {
    labelKey: "sidebar.group.purchasing",
    color: "text-sky-400",
    dotColor: "bg-sky-400",
    items: [
      { to: "/purchase-orders", icon: ClipboardCheck, labelKey: "sidebar.purchase_orders", access: ROUTE_ACCESS.purchaseRead, activeColor: "from-indigo-500/15 to-sky-500/10", textColor: "text-indigo-600", iconBg: "bg-indigo-500/10" },
      { to: "/purchase-requests", icon: ShoppingCart, labelKey: "sidebar.purchase_requests", access: ROUTE_ACCESS.purchaseRequestManage, activeColor: "from-indigo-500/15 to-sky-500/10", textColor: "text-indigo-700", iconBg: "bg-indigo-500/10" },
      { to: "/supplier-deliveries", icon: Truck, labelKey: "sidebar.supplier_deliveries", access: ROUTE_ACCESS.supplierDeliveries, activeColor: "from-sky-500/15 to-cyan-500/10", textColor: "text-sky-700", iconBg: "bg-sky-500/10" },
      { to: "/suppliers", icon: Truck, labelKey: "sidebar.suppliers", access: ROUTE_ACCESS.suppliers, activeColor: "from-sky-500/12 to-cyan-500/8", textColor: "text-sky-700", iconBg: "bg-sky-500/10" },
      { to: "/catalog", icon: BookOpen, labelKey: "sidebar.catalog", access: ROUTE_ACCESS.catalog, activeColor: "from-blue-500/15 to-teal-500/10", textColor: "text-blue-600", iconBg: "bg-blue-500/10" },
      { to: "/ai-import", icon: Sparkles, labelKey: "sidebar.ai_import", access: ROUTE_ACCESS.managerStockDecision, activeColor: "from-cyan-500/15 to-violet-500/10", textColor: "text-cyan-600", iconBg: "bg-cyan-500/10" },
    ],
  },
  {
    labelKey: "sidebar.group.library",
    color: "text-amber-400",
    dotColor: "bg-amber-400",
    items: [
      { to: "/borrow", icon: BookMarked, labelKey: "sidebar.borrow", access: ROUTE_ACCESS.borrowRead, activeColor: "from-amber-500/15 to-orange-500/8", textColor: "text-amber-600", iconBg: "bg-amber-500/10" },
      { to: "/borrow/customers", icon: UserRound, labelKey: "sidebar.borrow_customers", access: ROUTE_ACCESS.borrowRead, activeColor: "from-amber-500/15 to-yellow-500/8", textColor: "text-amber-600", iconBg: "bg-amber-500/10" },
      { to: "/borrow/reservations", icon: CalendarClock, labelKey: "sidebar.reservations", access: ROUTE_ACCESS.borrowRead, activeColor: "from-orange-500/15 to-amber-500/8", textColor: "text-orange-600", iconBg: "bg-orange-500/10" },
      { to: "/borrow/loans", icon: HandCoins, labelKey: "sidebar.loans", access: ROUTE_ACCESS.borrowRead, activeColor: "from-emerald-500/15 to-teal-500/8", textColor: "text-emerald-600", iconBg: "bg-emerald-500/10" },
      { to: "/borrow/fines", icon: Receipt, labelKey: "sidebar.fines", access: ROUTE_ACCESS.borrowRead, activeColor: "from-rose-500/15 to-amber-500/8", textColor: "text-rose-600", iconBg: "bg-rose-500/10" },
      { to: "/membership-plans", icon: Crown, labelKey: "sidebar.membership_plans", access: ROUTE_ACCESS.borrowRead, activeColor: "from-amber-500/15 to-yellow-500/8", textColor: "text-amber-600", iconBg: "bg-amber-500/10" },
    ],
  },
  {
    labelKey: "sidebar.group.analytics",
    color: "text-violet-400",
    dotColor: "bg-violet-400",
    items: [
      { to: "/reports", icon: BarChart3, labelKey: "sidebar.reports", access: ROUTE_ACCESS.reports, activeColor: "from-emerald-500/15 to-cyan-500/10", textColor: "text-emerald-600", iconBg: "bg-emerald-500/10" },
      { to: "/recommendations", icon: ThumbsUp, labelKey: "sidebar.recommendations", access: ROUTE_ACCESS.catalog, activeColor: "from-violet-500/15 to-blue-500/10", textColor: "text-violet-600", iconBg: "bg-violet-500/10" },
      { to: "/reorder-suggestions", icon: Package, labelKey: "sidebar.ai_reorder", access: ROUTE_ACCESS.reports, activeColor: "from-emerald-500/15 to-violet-500/10", textColor: "text-emerald-600", iconBg: "bg-emerald-500/10" },
    ],
  },
  {
    labelKey: "sidebar.group.admin",
    color: "text-slate-400",
    dotColor: "bg-slate-400",
    items: [
      { to: "/users", icon: Users, labelKey: "sidebar.users", access: ROUTE_ACCESS.admin, activeColor: "from-slate-500/12 to-indigo-500/8", textColor: "text-slate-600", iconBg: "bg-slate-500/10" },
      { to: "/roles", icon: Shield, labelKey: "sidebar.roles", access: ROUTE_ACCESS.admin, activeColor: "from-indigo-500/12 to-purple-500/8", textColor: "text-indigo-600", iconBg: "bg-indigo-500/10" },
      { to: "/audit-trail", icon: ScrollText, labelKey: "sidebar.audit_trail", access: ROUTE_ACCESS.admin, activeColor: "from-slate-500/12 to-zinc-500/8", textColor: "text-slate-600", iconBg: "bg-slate-500/10" },
    ],
  },
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const user = authService.getCurrentUser();
  const { t } = useI18n();
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccess(user, item.access)),
    }))
    .filter((group) => group.items.length > 0);
  const canReceiveStock = canAccess(user, ROUTE_ACCESS.staffTaskProgress);
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
      className="h-screen bg-[#fafbfe] dark:bg-slate-950 border-r border-border flex flex-col shrink-0 relative z-20"
    >
      {/* Logo */}
      <div className="h-[56px] flex items-center justify-between px-4 border-b border-border">
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
        <button onClick={onToggle} className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors text-muted-foreground hover:text-indigo-600 dark:hover:text-indigo-400" aria-label="Toggle sidebar">
          <motion.div animate={{ rotate: collapsed ? 180 : 0 }} transition={{ duration: 0.24 }}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </motion.div>
        </button>
      </div>

      {/* Scan CTA */}
      {canReceiveStock ? <div className="px-3 pt-4 pb-1">
        <NavLink
          to="/orders/new"
          className={`group flex items-center gap-2.5 rounded-[10px] bg-gradient-to-r from-indigo-600 via-blue-600 to-violet-600 text-white text-[13px] shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 active:scale-[0.98] transition-all duration-140 ${collapsed ? "justify-center px-0 py-2.5" : "px-3.5 py-2.5"}`}
          style={{ fontWeight: 500 }}
          aria-label="Create receiving draft"
        >
          <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}>
            <ScanBarcode className="w-4 h-4" />
          </motion.div>
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                {t('sidebar.scan_receive_cta')}
              </motion.span>
            )}
          </AnimatePresence>
        </NavLink>
      </div> : null}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {visibleGroups.map((group) => (
          <div key={group.labelKey} className="pt-4 first:pt-1">
            <AnimatePresence>
              {!collapsed && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 px-3 pb-2">
                  <div className={`w-1 h-1 rounded-full ${group.dotColor}`} />
                  <span className={`text-[10px] uppercase tracking-[0.08em] ${group.color}`} style={{ fontWeight: 600 }}>{t(group.labelKey)}</span>
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
                    isActive ? item.textColor : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  } ${collapsed ? "justify-center" : ""}`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-active-pill"
                        className={`absolute inset-0 rounded-[9px] bg-gradient-to-r ${item.activeColor} border border-white/50 dark:border-white/10`}
                        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                      />
                    )}
                    <div className={`w-[22px] h-[22px] rounded-[6px] flex items-center justify-center shrink-0 relative z-10 transition-colors duration-160 ${
                      isActive ? item.iconBg : "group-hover:bg-slate-100 dark:group-hover:bg-slate-800"
                    }`}>
                      <item.icon className="w-[14px] h-[14px]" />
                    </div>
                    <AnimatePresence>
                      {!collapsed && (
                        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                          className="relative z-10" style={{ fontWeight: isActive ? 550 : 400 }}>
                          {t(item.labelKey)}
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
      <div className="border-t border-border p-3">
          <div className={`flex items-center gap-2.5 px-2 py-2.5 rounded-[10px] bg-gradient-to-r from-indigo-50/80 to-violet-50/50 dark:from-indigo-500/10 dark:to-violet-500/5 border border-indigo-100/40 dark:border-indigo-500/20 cursor-pointer hover:border-indigo-200/60 dark:hover:border-indigo-400/30 transition-all duration-160 ${collapsed ? "justify-center" : ""}`}>
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
