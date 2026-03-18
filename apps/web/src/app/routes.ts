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
import { AIImportPage } from "@/components/pages/ai-import";
import { RecommendationsPage } from "@/components/pages/recommendations";
import { BorrowPage } from "@/components/pages/borrow";
import { UsersPage } from "@/components/pages/users";
import { RolesPage } from "@/components/pages/roles";
import { LoginPage } from "@/components/pages/login";
import { RegisterPage } from "@/components/pages/register";
import { authService } from "@/services/auth";

function requireAuthLoader() {
  if (!authService.isAuthenticated()) {
    throw redirect("/login");
  }
  return null;
}

function publicOnlyLoader() {
  if (authService.isAuthenticated()) {
    throw redirect("/");
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
      { path: "movements", Component: MovementsPage },
      { path: "warehouses", Component: WarehousesPage },
      { path: "ai-import", Component: AIImportPage },
      { path: "recommendations", Component: RecommendationsPage },
      { path: "borrow", Component: BorrowPage },
      { path: "users", Component: UsersPage },
      { path: "roles", Component: RolesPage },
      { path: "*", Component: DashboardPage },
    ],
  },
]);
