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
import { MovementsPage } from "@/components/pages/movements";
import { WarehousesPage } from "@/components/pages/warehouses";
import { ShelvesPage } from "@/components/pages/shelves";
import { AIImportPage } from "@/components/pages/ai-import";
import { RecommendationsPage } from "@/components/pages/recommendations";
import { BorrowPage } from "@/components/pages/borrow";
import { BorrowCustomersPage } from "@/components/pages/borrow-customers";
import { BorrowReservationsPage } from "@/components/pages/borrow-reservations";
import { BorrowLoansPage } from "@/components/pages/borrow-loans";
import { BorrowLoanDetailPage } from "@/components/pages/borrow-loan-detail";
import { BorrowFinesPage } from "@/components/pages/borrow-fines";
import { UsersPage } from "@/components/pages/users";
import { RolesPage } from "@/components/pages/roles";
import { PutawayPage } from "@/components/pages/putaway";
import { PutawayDetailPage } from "@/components/pages/putaway-detail";
import { PutawayExecutePage } from "@/components/pages/putaway-execute";
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
import { authService } from "@/services/auth";

async function requireAuthLoader() {
  const user = await authService.hydrateCurrentUser();
  if (!user) {
    throw redirect("/login");
  }
  if (Array.isArray(user.roles) && user.roles.includes("CUSTOMER")) {
    throw redirect("/customer");
  }
  return null;
}

function publicOnlyLoader() {
  if (authService.isAuthenticated()) {
    throw redirect("/");
  }
  return null;
}

async function requireCustomerAuthLoader() {
  const user = await authService.hydrateCurrentUser();
  if (!user) {
    throw redirect('/customer/login');
  }
  if (!Array.isArray(user.roles) || !user.roles.includes('CUSTOMER')) {
    throw redirect('/');
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
  throw redirect('/');
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
    ],
  },
  {
    path: "/",
    loader: requireAuthLoader,
    Component: AppLayout,
    children: [
      { index: true, Component: DashboardPage },
      { path: "catalog", Component: CatalogPage },
      { path: "book/:id", Component: BookDetailPage },
      { path: "inventory", Component: InventoryPage },
      { path: "orders", Component: OrdersPage },
      { path: "orders/new", Component: GoodsReceiptPage },
      { path: "orders/:id", Component: OrderDetailPage },
      { path: "putaway", Component: PutawayPage },
      { path: "putaway/:id", Component: PutawayDetailPage },
      { path: "putaway/:id/execute", Component: PutawayExecutePage },
      { path: "movements", Component: MovementsPage },
      { path: "warehouses", Component: WarehousesPage },
      { path: "shelves", Component: ShelvesPage },
      { path: "ai-import", Component: AIImportPage },
      { path: "recommendations", Component: RecommendationsPage },
      { path: "borrow", Component: BorrowPage },
      { path: "borrow/customers", Component: BorrowCustomersPage },
      { path: "borrow/reservations", Component: BorrowReservationsPage },
      { path: "borrow/loans", Component: BorrowLoansPage },
      { path: "borrow/loans/:id", Component: BorrowLoanDetailPage },
      { path: "borrow/fines", Component: BorrowFinesPage },
      { path: "users", Component: UsersPage },
      { path: "roles", Component: RolesPage },
      { path: "*", Component: DashboardPage },
    ],
  },
]);
