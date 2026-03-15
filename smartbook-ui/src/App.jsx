// src/App.jsx
// Gắn kết Router — bọc tất cả trang trong AdminLayout

import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AdminLayout          from './components/AdminLayout';
import DashboardPage        from './pages/DashboardPage';
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
import LoginPage            from './pages/LoginPage';
import RegisterPage         from './pages/RegisterPage';
import { TOKEN_KEY }        from './services/api';

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
        <Route path="/inventory"       element={<InventoryPage />} />
        <Route path="/inventory/:id"   element={<BookDetailPage />} />
        <Route path="/ai-import"       element={<AIImportPage />} />
        <Route path="/movements"       element={<StockMovementPage />} />
        <Route path="/recommendations" element={<RecommendationPage />} />
        <Route path="/users"           element={<UserManagementPage />} />
        <Route path="/roles"           element={<RoleManagementPage />} />
        <Route path="/warehouse-map"   element={<WarehouseBuilderPage />} />
        <Route path="/orders"          element={<OrdersPage />} />
        <Route path="/orders/create"   element={<CreateOrderPage />} />
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
