import { createBrowserRouter, type LoaderFunctionArgs } from "react-router";
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
import { MyWarehouseTasksPage } from "@/components/pages/my-warehouse-tasks";
import { MyPurchaseRequestsPage } from "@/components/pages/my-purchase-requests";
import { MyExceptionReportsPage } from "@/components/pages/my-exception-reports";
import { PurchaseRequestsPage } from "@/components/pages/purchase-requests";
import { ExceptionReportsPage } from "@/components/pages/exception-reports";
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
import { ForbiddenPage } from "@/components/pages/forbidden";
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
    path: "/",
    loader: requireAuthLoader,
    Component: AppLayout,
    children: [
      { index: true, Component: DashboardPage },
      { path: "forbidden", Component: ForbiddenPage },
      { path: "my-warehouse-tasks", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTasks), Component: MyWarehouseTasksPage },
      { path: "my-purchase-requests", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseRequest), Component: MyPurchaseRequestsPage },
      { path: "my-exception-reports", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.exceptionReport), Component: MyExceptionReportsPage },
      { path: "purchase-requests", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseRequestManage), Component: PurchaseRequestsPage },
      { path: "exception-reports", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.exceptionReportManage), Component: ExceptionReportsPage },
      { path: "catalog", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.catalog), Component: CatalogPage },
      { path: "book/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.catalog), Component: BookDetailPage },
      { path: "inventory", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerInventoryRead), Component: InventoryPage },
      { path: "orders", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerStockDecision), Component: OrdersPage },
      { path: "orders/new", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), Component: GoodsReceiptPage },
      { path: "orders/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), Component: OrderDetailPage },
      { path: "purchase-orders", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseRead), Component: PurchaseOrdersPage },
      { path: "purchase-orders/new", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseWrite), Component: PurchaseOrderFormPage },
      { path: "purchase-orders/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseRead), Component: PurchaseOrderDetailPage },
      { path: "purchase-orders/:id/edit", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.purchaseWrite), Component: PurchaseOrderFormPage },
      { path: "supplier-deliveries", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.supplierDeliveries), Component: SupplierDeliveriesPage },
      { path: "supplier-deliveries/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.supplierDeliveries), Component: SupplierDeliveriesPage },
      { path: "putaway", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), Component: PutawayPage },
      { path: "putaway/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), Component: PutawayDetailPage },
      { path: "putaway/:id/execute", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), Component: PutawayExecutePage },
      { path: "receiving-putaway", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerStockDecision), Component: ReceivingPutawayPage },
      { path: "receiving-smart", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerStockDecision), Component: SmartReceivingPage },
      { path: "picking", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), Component: PickingPage },
      { path: "order-requests", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.orderRequests), Component: OrderRequestsPage },
      { path: "movements", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerInventoryRead), Component: MovementsPage },
      { path: "outbound", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.staffTaskProgress), Component: OutboundPage },
      { path: "warehouses", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.warehouseWrite), Component: WarehousesPage },
      { path: "shelves", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerInventoryRead), Component: ShelvesPage },
      { path: "ai-import", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.managerStockDecision), Component: AIImportPage },
      { path: "recommendations", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.catalog), Component: RecommendationsPage },
      { path: "reorder-suggestions", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.reports), Component: ReorderSuggestionsPage },
      { path: "borrow", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), Component: BorrowPage },
      { path: "borrow/customers", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), Component: BorrowCustomersPage },
      { path: "borrow/reservations", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), Component: BorrowReservationsPage },
      { path: "borrow/loans", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), Component: BorrowLoansPage },
      { path: "borrow/loans/:id", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), Component: BorrowLoanDetailPage },
      { path: "borrow/fines", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), Component: BorrowFinesPage },
      { path: "reports", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.reports), Component: ReportsPage },
      { path: "audit-trail", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.admin), Component: AuditTrailPage },
      { path: "membership-plans", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.borrowRead), Component: MembershipPlansPage },
      { path: "suppliers", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.suppliers), Component: SuppliersPage },
      { path: "users", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.admin), Component: UsersPage },
      { path: "roles", loader: requireRoleOrPermissionLoader(ROUTE_ACCESS.admin), Component: RolesPage },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);
