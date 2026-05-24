import { createBrowserRouter } from "react-router";
import { redirect } from "react-router";
import { AppLayout } from "@/components/layout";
import { DashboardPage } from "@/components/pages/dashboard";
import { CatalogPage } from "@/components/pages/catalog";
import { BookDetailPage } from "@/components/pages/book-detail";
import { InventoryPage } from "@/components/pages/inventory";
import { OrdersPage } from "@/components/pages/orders";
import { OrderDetailPage } from "@/components/pages/order-detail";
import { GoodsReceiptPage } from "@/components/pages/goods-receipt";
import { PurchaseOrdersPage } from "@/components/pages/purchase-orders";
import { PurchaseOrderDetailPage } from "@/components/pages/purchase-order-detail";
import { PurchaseOrderFormPage } from "@/components/pages/purchase-order-form";
import { MovementsPage } from "@/components/pages/movements";
import { WarehousesPage } from "@/components/pages/warehouses";
import { ShelvesPage } from "@/components/pages/shelves";
import { AIImportPage } from "@/components/pages/ai-import";
import { RecommendationsPage } from "@/components/pages/recommendations";
import { ReorderSuggestionsPage } from "@/components/pages/reorder-suggestions";
import { BorrowPage } from "@/components/pages/borrow";
import { BorrowCustomersPage } from "@/components/pages/borrow-customers";
import { BorrowReservationsPage } from "@/components/pages/borrow-reservations";
import { BorrowLoansPage } from "@/components/pages/borrow-loans";
import { BorrowLoanDetailPage } from "@/components/pages/borrow-loan-detail";
import { BorrowFinesPage } from "@/components/pages/borrow-fines";
import { UsersPage } from "@/components/pages/users";
import { RolesPage } from "@/components/pages/roles";
import { ReportsPage } from "@/components/pages/reports";
import { PutawayPage } from "@/components/pages/putaway";
import { PutawayDetailPage } from "@/components/pages/putaway-detail";
import { PutawayExecutePage } from "@/components/pages/putaway-execute";
import { ReceivingPutawayPage } from "@/components/pages/receiving-putaway";
import { SmartReceivingPage } from "@/components/pages/receiving-smart";
import { PickingPage } from "@/components/pages/picking";
import { OrderRequestsPage } from "@/components/pages/order-requests";
import { OutboundPage } from "@/components/pages/outbound";
import { LoginPage } from "@/components/pages/login";
import { RegisterPage } from "@/components/pages/register";
import { CustomerLayout } from "@/components/pages/customer/layout";
import { CustomerDashboardPage } from "@/components/pages/customer/dashboard";
import { CustomerProfilePage } from "@/components/pages/customer/profile";
import { CustomerMembershipPage } from "@/components/pages/customer/membership";
import { CustomerLoginPage } from "@/components/pages/customer/login";
import { CustomerRegisterPage } from "@/components/pages/customer/register";
import { CustomerCatalogPage } from "@/components/pages/customer/catalog";
import { CustomerBookDetailPage } from "@/components/pages/customer/book-detail";
import { CustomerReservationsPage } from "@/components/pages/customer/reservations";
import { CustomerLoansPage } from "@/components/pages/customer/loans";
import { CustomerLoanDetailPage } from "@/components/pages/customer/loan-detail";
import { CustomerFinesPage } from "@/components/pages/customer/fines";
import { CustomerNotificationsPage } from "@/components/pages/customer/notifications";
import { CustomerReadingAnalyticsPage } from "@/components/pages/customer/reading-analytics";
import { CustomerWishlistPage } from "@/components/pages/customer/wishlist";
import { AuditTrailPage } from "@/components/pages/audit-trail";
import { MembershipPlansPage } from "@/components/pages/membership-plans";
import { SuppliersPage } from "@/components/pages/suppliers";
import { SupplierDeliveriesPage } from "@/components/pages/supplier-deliveries";
import { SupplierAccountPage } from "@/components/pages/supplier/supplier-account";
import { SupplierPortalPage } from "@/components/pages/supplier/supplier-portal";
import { NotFoundPage } from "@/components/pages/not-found";
import { NotAuthorizedPage } from "@/components/pages/not-authorized";
import { AdminDashboardPage, LibrarianDashboardPage, ManagerDashboardPage, StaffDashboardPage } from "@/components/pages/actor-dashboard";
import { authService } from "@/services/auth";
import { canAccessRoute, getDefaultRouteForUser, type RouteAccessRule } from "@/lib/rbac";

async function requireInternalAuthLoader(rule: RouteAccessRule = {}) {
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
  if (!canAccessRoute(rule, user)) {
    throw redirect("/403");
  }
  return null;
}

async function rootIndexLoader() {
  const user = await authService.hydrateCurrentUser();
  if (!user) {
    throw redirect("/login");
  }
  throw redirect(getDefaultRouteForUser(user));
}

function publicOnlyLoader() {
  if (authService.isAuthenticated()) {
    if (authService.isCustomer()) {
      throw redirect("/customer");
    }
    if (authService.isSupplier()) {
      throw redirect("/supplier");
    }
    throw redirect(getDefaultRouteForUser(authService.getCurrentUser()));
  }
  return null;
}

async function requireCustomerAuthLoader() {
  const user = await authService.hydrateCurrentUser();
  if (!user) {
    throw redirect('/customer/login');
  }
  if (!Array.isArray(user.roles) || !user.roles.includes('CUSTOMER')) {
    throw redirect('/403');
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
  throw redirect(getDefaultRouteForUser(authService.getCurrentUser()));
}

async function requireSupplierAuthLoader() {
  const user = await authService.hydrateCurrentUser();
  if (!user) {
    throw redirect('/login');
  }
  if (!Array.isArray(user.roles) || !user.roles.includes('SUPPLIER')) {
    throw redirect('/403');
  }
  return null;
}

function guarded(rule: RouteAccessRule) {
  return () => requireInternalAuthLoader(rule);
}

export const router = createBrowserRouter([
  {
    path: "/login",
    loader: publicOnlyLoader,
    Component: LoginPage,
  },
  {
    path: "/register",
    loader: publicOnlyLoader,
    Component: RegisterPage,
  },
  {
    path: '/customer/login',
    loader: customerPublicOnlyLoader,
    Component: CustomerLoginPage,
  },
  {
    path: '/customer/register',
    loader: customerPublicOnlyLoader,
    Component: CustomerRegisterPage,
  },
  {
    path: '/customer',
    loader: requireCustomerAuthLoader,
    Component: CustomerLayout,
    children: [
      { index: true, Component: CustomerDashboardPage },
      { path: 'profile', Component: CustomerProfilePage },
      { path: 'membership', Component: CustomerMembershipPage },
      { path: 'books', Component: CustomerCatalogPage },
      { path: 'books/:id', Component: CustomerBookDetailPage },
      { path: 'reservations', Component: CustomerReservationsPage },
      { path: 'loans', Component: CustomerLoansPage },
      { path: 'loans/:id', Component: CustomerLoanDetailPage },
      { path: 'fines', Component: CustomerFinesPage },
      { path: 'notifications', Component: CustomerNotificationsPage },
      { path: 'reading-analytics', Component: CustomerReadingAnalyticsPage },
      { path: 'wishlist', Component: CustomerWishlistPage },
    ],
  },
  {
    path: "/supplier/portal/:token",
    Component: SupplierPortalPage,
  },
  {
    path: "/supplier",
    loader: requireSupplierAuthLoader,
    Component: SupplierAccountPage,
  },
  {
    path: "/403",
    Component: NotAuthorizedPage,
  },
  {
    path: "/",
    loader: () => requireInternalAuthLoader(),
    Component: AppLayout,
    children: [
      { index: true, loader: rootIndexLoader },
      { path: "admin", loader: guarded({ allowedRoles: ["ADMIN"], requiredPermissions: ["auth.users.read", "auth.roles.read"] }), Component: AdminDashboardPage },
      { path: "manager", loader: guarded({ allowedRoles: ["MANAGER"], requiredPermissions: ["analytics.reports.view", "inventory.purchase.approve"] }), Component: ManagerDashboardPage },
      { path: "librarian", loader: guarded({ allowedRoles: ["LIBRARIAN", "CUSTOMER_SERVICE"], requiredPermissions: ["borrow.loans.read"] }), Component: LibrarianDashboardPage },
      { path: "staff", loader: guarded({ allowedRoles: ["STAFF", "WAREHOUSE_OPERATOR"], requiredPermissions: ["inventory.stock.read", "inventory.receiving.read"] }), Component: StaffDashboardPage },
      { path: "dashboard", loader: guarded({ requiredPermissions: ["analytics.reports.view"] }), Component: DashboardPage },
      { path: "catalog", loader: guarded({ requiredPermissions: ["inventory.catalog.read"] }), Component: CatalogPage },
      { path: "book/:id", loader: guarded({ requiredPermissions: ["inventory.catalog.read"] }), Component: BookDetailPage },
      { path: "inventory", loader: guarded({ requiredPermissions: ["inventory.stock.read"] }), Component: InventoryPage },
      { path: "orders", loader: guarded({ requiredPermissions: ["inventory.receiving.read", "inventory.receiving.write"] }), Component: OrdersPage },
      { path: "orders/new", loader: guarded({ requiredPermissions: ["inventory.receiving.write"] }), Component: GoodsReceiptPage },
      { path: "orders/:id", loader: guarded({ requiredPermissions: ["inventory.receiving.read", "inventory.receiving.write"] }), Component: OrderDetailPage },
      { path: "purchase-orders", loader: guarded({ requiredPermissions: ["inventory.purchase.read", "inventory.purchase.write", "inventory.purchase.approve"] }), Component: PurchaseOrdersPage },
      { path: "purchase-orders/new", loader: guarded({ requiredPermissions: ["inventory.purchase.write"] }), Component: PurchaseOrderFormPage },
      { path: "purchase-orders/:id", loader: guarded({ requiredPermissions: ["inventory.purchase.read", "inventory.purchase.write", "inventory.purchase.approve"] }), Component: PurchaseOrderDetailPage },
      { path: "purchase-orders/:id/edit", loader: guarded({ requiredPermissions: ["inventory.purchase.write"] }), Component: PurchaseOrderFormPage },
      { path: "supplier-deliveries", loader: guarded({ requiredPermissions: ["inventory.purchase.read", "inventory.receiving.read", "inventory.receiving.write"] }), Component: SupplierDeliveriesPage },
      { path: "supplier-deliveries/:id", loader: guarded({ requiredPermissions: ["inventory.purchase.read", "inventory.receiving.read", "inventory.receiving.write"] }), Component: SupplierDeliveriesPage },
      { path: "putaway", loader: guarded({ requiredPermissions: ["inventory.putaway.execute"] }), Component: PutawayPage },
      { path: "putaway/:id", loader: guarded({ requiredPermissions: ["inventory.putaway.execute"] }), Component: PutawayDetailPage },
      { path: "putaway/:id/execute", loader: guarded({ requiredPermissions: ["inventory.putaway.execute"] }), Component: PutawayExecutePage },
      { path: "receiving-putaway", loader: guarded({ requiredPermissions: ["inventory.putaway.execute"] }), Component: ReceivingPutawayPage },
      { path: "receiving-smart", loader: guarded({ requiredPermissions: ["inventory.receiving.write", "ai.scan.receipt"] }), Component: SmartReceivingPage },
      { path: "picking", loader: guarded({ requiredPermissions: ["inventory.transfer.write", "inventory.stock.write"] }), Component: PickingPage },
      { path: "order-requests", loader: guarded({ requiredPermissions: ["inventory.transfer.read", "inventory.transfer.write", "inventory.purchase.approve"] }), Component: OrderRequestsPage },
      { path: "movements", loader: guarded({ requiredPermissions: ["inventory.stock.read"] }), Component: MovementsPage },
      { path: "outbound", loader: guarded({ requiredPermissions: ["inventory.transfer.write", "inventory.stock.write"] }), Component: OutboundPage },
      { path: "warehouses", loader: guarded({ requiredPermissions: ["inventory.warehouse.read"] }), Component: WarehousesPage },
      { path: "shelves", loader: guarded({ requiredPermissions: ["inventory.stock.read"] }), Component: ShelvesPage },
      { path: "ai-import", loader: guarded({ requiredPermissions: ["ai.ocr.process", "ai.catalog.assist", "ai.scan.receipt"] }), Component: AIImportPage },
      { path: "recommendations", loader: guarded({ requiredPermissions: ["ai.recommendation.view"] }), Component: RecommendationsPage },
      { path: "reorder-suggestions", loader: guarded({ requiredPermissions: ["analytics.forecast.view", "ai.recommendation.view"] }), Component: ReorderSuggestionsPage },
      { path: "borrow", loader: guarded({ requiredPermissions: ["borrow.loans.read"] }), Component: BorrowPage },
      { path: "borrow/customers", loader: guarded({ requiredPermissions: ["borrow.customers.read"] }), Component: BorrowCustomersPage },
      { path: "borrow/reservations", loader: guarded({ requiredPermissions: ["borrow.loans.read"] }), Component: BorrowReservationsPage },
      { path: "borrow/loans", loader: guarded({ requiredPermissions: ["borrow.loans.read"] }), Component: BorrowLoansPage },
      { path: "borrow/loans/:id", loader: guarded({ requiredPermissions: ["borrow.loans.read"] }), Component: BorrowLoanDetailPage },
      { path: "borrow/fines", loader: guarded({ requiredPermissions: ["borrow.fines.read", "borrow.fines.manage"] }), Component: BorrowFinesPage },
      { path: "reports", loader: guarded({ requiredPermissions: ["analytics.reports.view"] }), Component: ReportsPage },
      { path: "audit-trail", loader: guarded({ requiredPermissions: ["auth.audit.read", "observability.logs.read"] }), Component: AuditTrailPage },
      { path: "membership-plans", loader: guarded({ requiredPermissions: ["borrow.memberships.manage"] }), Component: MembershipPlansPage },
      { path: "suppliers", loader: guarded({ requiredPermissions: ["inventory.purchase.read", "inventory.purchase.write"] }), Component: SuppliersPage },
      { path: "users", loader: guarded({ requiredPermissions: ["auth.users.read"] }), Component: UsersPage },
      { path: "roles", loader: guarded({ requiredPermissions: ["auth.roles.read", "auth.permissions.read"] }), Component: RolesPage },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);
