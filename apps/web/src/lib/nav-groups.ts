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
    items: [
      { to: "/my-warehouse-tasks", icon: ClipboardList, labelKey: "sidebar.my_tasks", access: ROUTE_ACCESS.staffTasks },
      { to: "/my-purchase-requests", icon: ShoppingCart, labelKey: "sidebar.my_purchase_requests", access: ROUTE_ACCESS.purchaseRequestSelf },
      { to: "/my-exception-reports", icon: AlertTriangle, labelKey: "sidebar.my_exception_reports", access: ROUTE_ACCESS.exceptionReportSelf },
      { to: "/staff-tasks", icon: ClipboardCheck, labelKey: "sidebar.staff_tasks", access: ROUTE_ACCESS.staffTaskAssign },
      { to: "/dashboard", icon: LayoutDashboard, labelKey: "sidebar.dashboard", access: ROUTE_ACCESS.reports },
    ],
  },
  {
    labelKey: "sidebar.group.warehouse",
    items: [
      { to: "/order-requests", icon: ListOrdered, labelKey: "sidebar.order_requests", access: ROUTE_ACCESS.orderRequests },
      { to: "/picking", icon: Hand, labelKey: "sidebar.picking", access: ROUTE_ACCESS.managerStockDecision },
      { to: "/packing", icon: PackageCheck, labelKey: "sidebar.packing", access: ROUTE_ACCESS.staffTaskProgress },
      { to: "/outbound", icon: Truck, labelKey: "sidebar.outbound", access: ROUTE_ACCESS.managerStockDecision },
      { to: "/receiving-check", icon: ClipboardList, labelKey: "sidebar.receiving_check", access: ROUTE_ACCESS.staffTaskProgress },
      { to: "/putaway", icon: MapPinned, labelKey: "sidebar.putaway", access: ROUTE_ACCESS.staffTaskProgress },
      { to: "/receiving-putaway", icon: Inbox, labelKey: "sidebar.receiving_putaway", access: ROUTE_ACCESS.warehousePutawayExecute },
      { to: "/orders", icon: FileText, labelKey: "sidebar.goods_receipts", access: ROUTE_ACCESS.managerStockDecision },
      { to: "/inventory", icon: Package, labelKey: "sidebar.inventory", access: ROUTE_ACCESS.managerInventoryRead },
      { to: "/movements", icon: Activity, labelKey: "sidebar.movements", access: ROUTE_ACCESS.managerInventoryRead },
      { to: "/warehouses", icon: Warehouse, labelKey: "sidebar.warehouses", access: ROUTE_ACCESS.warehouseWrite },
      { to: "/shelves", icon: Layers3, labelKey: "sidebar.shelves", access: ROUTE_ACCESS.managerInventoryRead },
      { to: "/stock-audits", icon: ClipboardList, labelKey: "sidebar.stock_audits", access: ROUTE_ACCESS.inventoryAuditRead },
      { to: "/exception-reports", icon: AlertTriangle, labelKey: "sidebar.exception_reports", access: ROUTE_ACCESS.exceptionReportManage },
    ],
  },
  {
    labelKey: "sidebar.group.catalog",
    items: [
      { to: "/catalog", icon: BookOpen, labelKey: "sidebar.catalog", access: ROUTE_ACCESS.catalog },
      { to: "/ai-import", icon: Sparkles, labelKey: "sidebar.ai_import", access: ROUTE_ACCESS.managerStockDecision },
      { to: "/recommendations", icon: ThumbsUp, labelKey: "sidebar.recommendations", access: ROUTE_ACCESS.catalog },
    ],
  },
  {
    labelKey: "sidebar.group.purchasing",
    items: [
      { to: "/purchase-orders", icon: ClipboardCheck, labelKey: "sidebar.purchase_orders", access: ROUTE_ACCESS.purchaseRead },
      { to: "/purchase-requests", icon: ShoppingCart, labelKey: "sidebar.purchase_requests", access: ROUTE_ACCESS.purchaseRequestManage },
      { to: "/supplier-deliveries", icon: Truck, labelKey: "sidebar.supplier_deliveries", access: ROUTE_ACCESS.supplierDeliveries },
      { to: "/suppliers", icon: Truck, labelKey: "sidebar.suppliers", access: ROUTE_ACCESS.suppliers },
    ],
  },
  {
    labelKey: "sidebar.group.library",
    items: [
      { to: "/borrow", icon: BookMarked, labelKey: "sidebar.borrow", access: ROUTE_ACCESS.borrowRead },
      { to: "/borrow/customers", icon: UserRound, labelKey: "sidebar.borrow_customers", access: ROUTE_ACCESS.borrowRead },
      { to: "/borrow/reservations", icon: CalendarClock, labelKey: "sidebar.reservations", access: ROUTE_ACCESS.borrowRead },
      { to: "/borrow/loans", icon: HandCoins, labelKey: "sidebar.loans", access: ROUTE_ACCESS.borrowRead },
      { to: "/borrow/fines", icon: Receipt, labelKey: "sidebar.fines", access: ROUTE_ACCESS.borrowRead },
      { to: "/membership-plans", icon: Crown, labelKey: "sidebar.membership_plans", access: ROUTE_ACCESS.borrowRead },
    ],
  },
  {
    labelKey: "sidebar.group.analytics",
    items: [
      { to: "/reports", icon: BarChart3, labelKey: "sidebar.reports", access: ROUTE_ACCESS.reports },
      { to: "/reorder-suggestions", icon: Package, labelKey: "sidebar.ai_reorder", access: ROUTE_ACCESS.reports },
      { to: "/ai-assistant", icon: MessageCircle, labelKey: "sidebar.ai_assistant", access: ROUTE_ACCESS.aiAssistant },
    ],
  },
  {
    labelKey: "sidebar.group.admin",
    items: [
      { to: "/users", icon: Users, labelKey: "sidebar.users", access: ROUTE_ACCESS.admin },
      { to: "/roles", icon: Shield, labelKey: "sidebar.roles", access: ROUTE_ACCESS.admin },
      { to: "/admin/monitor", icon: Gauge, labelKey: "sidebar.system_monitor", access: ROUTE_ACCESS.admin },
      { to: "/audit-trail", icon: ScrollText, labelKey: "sidebar.audit_trail", access: ROUTE_ACCESS.admin },
    ],
  },
];
