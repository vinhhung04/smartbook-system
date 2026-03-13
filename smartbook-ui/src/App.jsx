// src/App.jsx
// Gắn kết Router — bọc tất cả trang trong AdminLayout

import { BrowserRouter, Routes, Route } from 'react-router-dom';
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

export default function App() {
  return (
    <BrowserRouter>
      <AdminLayout>
        <Routes>
          <Route path="/"                element={<DashboardPage />} />
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
        </Routes>
      </AdminLayout>
    </BrowserRouter>
  );
}
