// src/App.jsx
// Gắn kết Router — bọc tất cả trang trong AdminLayout

import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AdminLayout          from './components/AdminLayout';
import BorrowManagementPage from './pages/BorrowManagementPage';
import DashboardPage        from './pages/DashboardPage';
import BookCatalogPage      from './pages/BookCatalogPage';
import InventoryPage        from './pages/InventoryPage';
import AIImportPage         from './pages/AIImportPage';
import BookDetailPage       from './pages/BookDetailPage';
import StockMovementPage    from './pages/StockMovementPage';
import RecommendationPage   from './pages/RecommendationPage';
import UserManagementPage   from './pages/UserManagementPage';
import RoleManagementPage   from './pages/RoleManagementPage';
import WarehouseBuilderPage from './pages/WarehouseBuilderPage';
import OrdersPage           from './pages/OrdersPage';
import CreateOrderPage      from './pages/CreateOrderPage';
import OrderDetailPage      from './pages/OrderDetailPage';
import LoginPage            from './pages/LoginPage';
import RegisterPage         from './pages/RegisterPage';
import { TOKEN_KEY, hasAnyPermission } from './services/api';

function RequirePermission({ permissions, children }) {
  const allowed = hasAnyPermission(permissions);

  if (!allowed) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

function ProtectedLayout() {
  const location = useLocation();
  const token = localStorage.getItem(TOKEN_KEY);

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return (
    <AdminLayout>
      <Routes>
        <Route path="/"                element={<DashboardPage />} />
        <Route path="/dashboard"       element={<DashboardPage />} />
        <Route path="/book-catalog"    element={<BookCatalogPage />} />
        <Route path="/borrow-management" element={<BorrowManagementPage />} />
        <Route path="/inventory"       element={<InventoryPage />} />
        <Route path="/inventory/:id"   element={<BookDetailPage />} />
        <Route path="/inbound"         element={<AIImportPage />} />
        <Route path="/movements"       element={<StockMovementPage />} />
        <Route path="/recommendations" element={<RecommendationPage />} />
        <Route
          path="/users"
          element={(
            <RequirePermission permissions={['auth.users.read', 'auth.users.write']}>
              <UserManagementPage />
            </RequirePermission>
          )}
        />
        <Route
          path="/roles"
          element={(
            <RequirePermission permissions={['auth.roles.read', 'auth.roles.write']}>
              <RoleManagementPage />
            </RequirePermission>
          )}
        />
        <Route path="/warehouse-map"   element={<WarehouseBuilderPage />} />
        <Route path="/orders"          element={<OrdersPage />} />
        <Route path="/orders/create"   element={<CreateOrderPage />} />
        <Route path="/orders/:id"      element={<OrderDetailPage />} />
        <Route path="*"                element={<Navigate to="/" replace />} />
      </Routes>
    </AdminLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/*" element={<ProtectedLayout />} />
      </Routes>
    </BrowserRouter>
  );
}
