import { createElement } from "react";
import { createBrowserRouter, type LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authService } from "@/services/auth";
import { canAccess, getHomePathForUser, ROUTE_ACCESS, type RouteAccessMeta } from "@/lib/rbac";

async function requireAuthLoader() {
  const user = await authService.hydrateCurrentUser();
  if (!user) {
    throw redirect("/login");
  }
  if (Array.isArray(user.roles) && user.roles.includes("CUSTOMER")) {
    throw redirect("/customer");
  }
  if (Array.isArray(user.roles) && user.roles.includes("SUPPLIER")) {
    throw redirect("/supplier");
  }
  if (!canAccess(user, ROUTE_ACCESS.internal)) {
    throw redirect(`/forbidden?from=${encodeURIComponent("/")}`);
  }
  return null;
}

function requireRoleOrPermissionLoader(meta: RouteAccessMeta) {
  return async ({ request }: LoaderFunctionArgs) => {
    const user = await authService.hydrateCurrentUser();
    if (!user) {
      throw redirect("/login");
    }
    if (Array.isArray(user.roles) && user.roles.includes("CUSTOMER")) {
      throw redirect("/customer");
    }
    if (Array.isArray(user.roles) && user.roles.includes("SUPPLIER")) {
      throw redirect("/supplier");
    }
    if (!canAccess(user, meta)) {
      throw redirect(`/forbidden?from=${encodeURIComponent(new URL(request.url).pathname)}`);
    }
    return null;
  };
}

function publicOnlyLoader() {
  if (authService.isAuthenticated()) {
    if (authService.isCustomer()) {
      throw redirect("/customer");
    }
    if (authService.isSupplier()) {
      throw redirect("/supplier");
    }
    throw redirect(getHomePathForUser(authService.getCurrentUser()));
  }
  return null;
}

async function requireCustomerAuthLoader() {
  const user = await authService.hydrateCurrentUser();
  if (!user) {
    throw redirect('/customer/login');
  }
  if (!Array.isArray(user.roles) || !user.roles.includes('CUSTOMER')) {
    throw redirect(getHomePathForUser(user));
  }
  return null;
}

function customerPublicOnlyLoader() {
  if (!authService.isAuthenticated()) {
    return null;
  }
  if (authService.isCustomer()) {
    throw redirect('/customer');
  }
  throw redirect(getHomePathForUser(authService.getCurrentUser()));
}

async function requireSupplierAuthLoader() {
  const user = await authService.hydrateCurrentUser();
  if (!user) {
    throw redirect('/login');
  }
  if (!Array.isArray(user.roles) || !user.roles.includes('SUPPLIER')) {
    throw redirect(getHomePathForUser(user));
  }
  return null;
}

function RouterHydrateFallback() {
  return createElement("div", {
    className: "min-h-screen bg-background",
    role: "status",
    "aria-label": "Loading",
  });
}

const hydrateFallbackElement = createElement(RouterHydrateFallback);

export const router = createBrowserRouter([
  {
    path: "/login",
    loader: publicOnlyLoader,
    lazy: { Component: async () => (await import("@/components/pages/login")).LoginPage },
  },
  {
    path: "/register",
    loader: publicOnlyLoader,
    lazy: { Component: async () => (await import("@/components/pages/register")).RegisterPage },
  },
  {
    path: "/forgot-password",
    loader: publicOnlyLoader,
    lazy: { Component: async () => (await import("@/components/pages/forgot-password")).ForgotPasswordPage },
  },
  {
    path: "/reset-password",
    loader: publicOnlyLoader,
    lazy: { Component: async () => (await import("@/components/pages/reset-password")).ResetPasswordPage },
  },
  {
    path: '/customer/login',
    loader: customerPublicOnlyLoader,
    lazy: { Component: async () => (await import("@/components/pages/customer/login")).CustomerLoginPage },
  },
  {
    path: '/customer/register',
    loader: customerPublicOnlyLoader,
    lazy: { Component: async () => (await import("@/components/pages/customer/register")).CustomerRegisterPage },
  },
  {
    path: '/customer',
    loader: requireCustomerAuthLoader,
    lazy: { Component: async () => (await import("@/components/pages/customer/layout")).CustomerLayout },
    children: [
      { index: true, lazy: { Component: async () => (await import("@/components/pages/customer/dashboard")).CustomerDashboardPage } },
      { path: 'profile', lazy: { Component: async () => (await import("@/components/pages/customer/profile")).CustomerProfilePage } },
      { path: 'membership', lazy: { Component: async () => (await import("@/components/pages/customer/membership")).CustomerMembershipPage } },
      { path: 'books', lazy: { Component: async () => (await import("@/components/pages/customer/catalog")).CustomerCatalogPage } },
      { path: 'books/:id', lazy: { Component: async () => (await import("@/components/pages/customer/book-detail")).CustomerBookDetailPage } },
      { path: 'reservations', lazy: { Component: async () => (await import("@/components/pages/customer/reservations")).CustomerReservationsPage } },
      { path: 'loans', lazy: { Component: async () => (await import("@/components/pages/customer/loans")).CustomerLoansPage } },
      { path: 'loans/:id', lazy: { Component: async () => (await import("@/components/pages/customer/loan-detail")).CustomerLoanDetailPage } },
      { path: 'fines', lazy: { Component: async () => (await import("@/components/pages/customer/fines")).CustomerFinesPage } },
      { path: 'notifications', lazy: { Component: async () => (await import("@/components/pages/customer/notifications")).CustomerNotificationsPage } },
      { path: 'reading-analytics', lazy: { Component: async () => (await import("@/components/pages/customer/reading-analytics")).CustomerReadingAnalyticsPage } },
      { path: 'wishlist', lazy: { Component: async () => (await import("@/components/pages/customer/wishlist")).CustomerWishlistPage } },
      { path: 'recommendations', lazy: { Component: async () => (await import("@/components/pages/customer/recommendations")).CustomerRecommendationsPage } },
    ],
  },
  {
    path: "/supplier/portal/:token",
    lazy: { Component: async () => (await import("@/components/pages/supplier/supplier-portal")).SupplierPortalPage },
  },
  {
    path: "/supplier",
    loader: requireSupplierAuthLoader,
    lazy: { Component: async () => (await import("@/components/pages/supplier/supplier-account")).SupplierAccountPage },
  },
  {
    path: "/",
    loader: requireAuthLoader,
    hydrateFallbackElement,
    lazy: { Component: async () => (await import("@/components/layout")).AppLayout },
    children: [
      { index: true, lazy: { Component: async () => (await import("@/components/pages/dashboard")).DashboardPage } },
      { path: "forbidden", lazy: { Component: async () => (await import("@/components/pages/forbidden")).ForbiddenPage } },
      { path: "my-warehouse-tasks", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTasks), lazy: { Component: async () => (await import("@/components/pages/my-warehouse-tasks")).MyWarehouseTasksPage } },
      { path: "my-purchase-requests", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseRequestSelf), lazy: { Component: async () => (await import("@/components/pages/my-purchase-requests")).MyPurchaseRequestsPage } },
      { path: "my-exception-reports", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.exceptionReportSelf), lazy: { Component: async () => (await import("@/components/pages/my-exception-reports")).MyExceptionReportsPage } },
      { path: "purchase-requests", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseRequestManage), lazy: { Component: async () => (await import("@/components/pages/purchase-requests")).PurchaseRequestsPage } },
      { path: "exception-reports", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.exceptionReportManage), lazy: { Component: async () => (await import("@/components/pages/exception-reports")).ExceptionReportsPage } },
      { path: "staff-tasks", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/staff-tasks")).StaffTasksPage } },
      { path: "catalog", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.catalog), lazy: { Component: async () => (await import("@/components/pages/catalog")).CatalogPage } },
      { path: "book/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.catalog), lazy: { Component: async () => (await import("@/components/pages/book-detail")).BookDetailPage } },
      { path: "inventory", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerInventoryRead), lazy: { Component: async () => (await import("@/components/pages/inventory")).InventoryPage } },
      { path: "orders", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerStockDecision), lazy: { Component: async () => (await import("@/components/pages/orders")).OrdersPage } },
      { path: "orders/new", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/goods-receipt")).GoodsReceiptPage } },
      { path: "orders/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/order-detail")).OrderDetailPage } },
      { path: "purchase-orders", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseRead), lazy: { Component: async () => (await import("@/components/pages/purchase-orders")).PurchaseOrdersPage } },
      { path: "purchase-orders/new", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseWrite), lazy: { Component: async () => (await import("@/components/pages/purchase-order-form")).PurchaseOrderFormPage } },
      { path: "purchase-orders/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseRead), lazy: { Component: async () => (await import("@/components/pages/purchase-order-detail")).PurchaseOrderDetailPage } },
      { path: "purchase-orders/:id/edit", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseWrite), lazy: { Component: async () => (await import("@/components/pages/purchase-order-form")).PurchaseOrderFormPage } },
      { path: "supplier-deliveries", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.supplierDeliveries), lazy: { Component: async () => (await import("@/components/pages/supplier-deliveries")).SupplierDeliveriesPage } },
      { path: "supplier-deliveries/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.supplierDeliveries), lazy: { Component: async () => (await import("@/components/pages/supplier-deliveries")).SupplierDeliveriesPage } },
      { path: "receiving-check", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/receiving-check")).ReceivingCheckPage } },
      { path: "putaway", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/putaway")).PutawayPage } },
      { path: "putaway/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/putaway-detail")).PutawayDetailPage } },
      { path: "putaway/:id/execute", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/putaway-execute")).PutawayExecutePage } },
      { path: "receiving-putaway", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.warehousePutawayExecute), lazy: { Component: async () => (await import("@/components/pages/receiving-putaway")).ReceivingPutawayPage } },
      { path: "receiving-smart", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerStockDecision), lazy: { Component: async () => (await import("@/components/pages/receiving-smart")).SmartReceivingPage } },
      { path: "picking", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/picking")).PickingPage } },
      { path: "packing", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/packing")).PackingPage } },
      { path: "order-requests", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.orderRequests), lazy: { Component: async () => (await import("@/components/pages/order-requests")).OrderRequestsPage } },
      { path: "movements", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerInventoryRead), lazy: { Component: async () => (await import("@/components/pages/movements")).MovementsPage } },
      { path: "stock-audits", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.inventoryAuditRead), lazy: { Component: async () => (await import("@/components/pages/stock-audits")).StockAuditsPage } },
      { path: "stock-audits/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.inventoryAuditRead), lazy: { Component: async () => (await import("@/components/pages/stock-audits")).StockAuditsPage } },
      { path: "outbound", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/outbound")).OutboundPage } },
      { path: "transfer-receiving", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), lazy: { Component: async () => (await import("@/components/pages/transfer-receiving")).TransferReceivingPage } },
      { path: "warehouses", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.warehouseWrite), lazy: { Component: async () => (await import("@/components/pages/warehouses")).WarehousesPage } },
      { path: "shelves", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerInventoryRead), lazy: { Component: async () => (await import("@/components/pages/shelves")).ShelvesPage } },
      { path: "ai-import", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerStockDecision), lazy: { Component: async () => (await import("@/components/pages/ai-import")).AIImportPage } },
      { path: "recommendations", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.catalog), lazy: { Component: async () => (await import("@/components/pages/recommendations")).RecommendationsPage } },
      { path: "reorder-suggestions", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.reports), lazy: { Component: async () => (await import("@/components/pages/reorder-suggestions")).ReorderSuggestionsPage } },
      { path: "borrow", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), lazy: { Component: async () => (await import("@/components/pages/borrow")).BorrowPage } },
      { path: "borrow/customers", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), lazy: { Component: async () => (await import("@/components/pages/borrow-customers")).BorrowCustomersPage } },
      { path: "borrow/reservations", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), lazy: { Component: async () => (await import("@/components/pages/borrow-reservations")).BorrowReservationsPage } },
      { path: "borrow/loans", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), lazy: { Component: async () => (await import("@/components/pages/borrow-loans")).BorrowLoansPage } },
      { path: "borrow/loans/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), lazy: { Component: async () => (await import("@/components/pages/borrow-loan-detail")).BorrowLoanDetailPage } },
      { path: "borrow/fines", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), lazy: { Component: async () => (await import("@/components/pages/borrow-fines")).BorrowFinesPage } },
      { path: "reports", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.reports), lazy: { Component: async () => (await import("@/components/pages/reports")).ReportsPage } },
      { path: "ai-assistant", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.aiAssistant), lazy: { Component: async () => (await import("@/components/pages/ai-assistant")).AIAssistantPage } },
      { path: "audit-trail", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.admin), lazy: { Component: async () => (await import("@/components/pages/audit-trail")).AuditTrailPage } },
      { path: "admin/monitor", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.admin), lazy: { Component: async () => (await import("@/components/pages/admin-monitor")).AdminMonitorPage } },
      { path: "membership-plans", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), lazy: { Component: async () => (await import("@/components/pages/membership-plans")).MembershipPlansPage } },
      { path: "suppliers", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.suppliers), lazy: { Component: async () => (await import("@/components/pages/suppliers")).SuppliersPage } },
      { path: "users", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.admin), lazy: { Component: async () => (await import("@/components/pages/users")).UsersPage } },
      { path: "roles", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.admin), lazy: { Component: async () => (await import("@/components/pages/roles")).RolesPage } },
      { path: "*", lazy: { Component: async () => (await import("@/components/pages/not-found")).NotFoundPage } },
    ],
  },
]);
