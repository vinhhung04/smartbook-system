import {
  LayoutDashboard, BookOpen, Package, FileText, Warehouse,
  Sparkles, ThumbsUp, BookMarked, Users, Shield,
  UserRound, CalendarClock, HandCoins, Layers3,
  MapPinned, ListOrdered, Inbox, Hand, Truck, Activity, Receipt, BarChart3, ScrollText, Crown, ClipboardCheck, ClipboardList,
  ShoppingCart, AlertTriangle, PackageCheck, MessageCircle, Gauge,
} from "lucide-react";
import { ROUTE_ACCESS } from "@/lib/rbac";

// Single source of truth for the sidebar's nav structure — also consumed by
// topbar.tsx to derive breadcrumb labels/colors for every route that has a
// nav item, instead of a second hand-maintained (and easily stale) map.
export const navGroups = [
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
      { to: "/stock-audits", icon: ClipboardList, labelKey: "sidebar.stock_audits", access: ROUTE_ACCESS.inventoryAuditRead, activeColor: "from-violet-500/12 to-purple-500/8", textColor: "text-violet-700", iconBg: "bg-violet-500/10" },
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
      { to: "/receiving-smart", icon: Sparkles, labelKey: "sidebar.receiving_smart", access: ROUTE_ACCESS.managerStockDecision, activeColor: "from-cyan-500/15 to-teal-500/10", textColor: "text-cyan-700", iconBg: "bg-cyan-500/10" },
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
      { to: "/ai-assistant", icon: MessageCircle, labelKey: "sidebar.ai_assistant", access: ROUTE_ACCESS.aiAssistant, activeColor: "from-violet-500/15 to-indigo-500/10", textColor: "text-violet-700", iconBg: "bg-violet-500/10" },
    ],
  },
  {
    labelKey: "sidebar.group.admin",
    color: "text-slate-400",
    dotColor: "bg-slate-400",
    items: [
      { to: "/users", icon: Users, labelKey: "sidebar.users", access: ROUTE_ACCESS.admin, activeColor: "from-slate-500/12 to-indigo-500/8", textColor: "text-slate-600", iconBg: "bg-slate-500/10" },
      { to: "/roles", icon: Shield, labelKey: "sidebar.roles", access: ROUTE_ACCESS.admin, activeColor: "from-indigo-500/12 to-purple-500/8", textColor: "text-indigo-600", iconBg: "bg-indigo-500/10" },
      { to: "/admin/monitor", icon: Gauge, labelKey: "sidebar.system_monitor", access: ROUTE_ACCESS.admin, activeColor: "from-cyan-500/12 to-sky-500/8", textColor: "text-cyan-700", iconBg: "bg-cyan-500/10" },
      { to: "/audit-trail", icon: ScrollText, labelKey: "sidebar.audit_trail", access: ROUTE_ACCESS.admin, activeColor: "from-slate-500/12 to-zinc-500/8", textColor: "text-slate-600", iconBg: "bg-slate-500/10" },
    ],
  },
];
