// src/components/AdminLayout.jsx
// Khung giao diện chính: Sidebar + Header + Main Content

import { NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { LayoutDashboard, Library, BookOpen, ClipboardList, ScanLine, History, Sparkles, Users, ShieldCheck, Map, FileText, Bell, Search, ScanBarcode } from 'lucide-react';
import AIChatbot from './AIChatbot';
import ScannerModal from './ScannerModal';
import { clearToken, hasAnyPermission } from '../services/api';

// --- Nhóm menu chính ---
const overviewMenuItems = [
  { label: 'Tổng quan', icon: LayoutDashboard, to: '/' },
];

const libraryOperationMenuItems = [
  { label: 'Danh mục sách', icon: BookOpen, to: '/book-catalog' },
  { label: 'Mượn / Trả sách', icon: ClipboardList, to: '/borrow-management' },
  { label: 'Gợi ý AI', icon: Sparkles, to: '/recommendations' },
];

const warehouseOperationMenuItems = [
  { label: 'Kho sách', icon: Library, to: '/inventory' },
  { label: 'Phiếu nhập kho', icon: FileText, to: '/orders' },
  { label: 'Sơ đồ kho', icon: Map, to: '/warehouse-map' },
  { label: 'Nhập kho', icon: ScanLine, to: '/inbound' },
  { label: 'Lịch sử kho', icon: History, to: '/movements' },
];

// --- Nhóm menu HỆ THỐNG ---
const systemMenuItems = [
  {
    label: 'Nhân viên',
    icon: Users,
    to: '/users',
    visible: () => hasAnyPermission(['auth.users.read', 'auth.users.write']),
  },
  {
    label: 'Phân quyền',
    icon: ShieldCheck,
    to: '/roles',
    visible: () => hasAnyPermission(['auth.roles.read', 'auth.roles.write']),
  },
];

// =====================  SIDEBAR  =====================
function Sidebar() {
    const renderMenuItems = (items) => items
      .filter((item) => (typeof item.visible === 'function' ? item.visible() : true))
      .map(({ label, icon: Icon, to }) => (
    <NavLink
      key={to}
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors border-l-4 ${
          isActive
            ? 'bg-gray-800 text-white border-indigo-500'
            : 'text-gray-300 border-transparent hover:bg-gray-800 hover:text-white'
        }`
      }
    >
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  ));

  return (
    <aside className="w-64 min-h-screen bg-gray-900 flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-700">
        <span className="text-white font-extrabold text-xl tracking-wide">
          SmartBook <span className="text-indigo-400">AI</span>
        </span>
      </div>

      {/* Navigation chính */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <div>
          {renderMenuItems(overviewMenuItems)}
        </div>

        <div className="pt-4 mt-2 border-t border-gray-700/60">
          <p className="px-3 pb-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            VẬN HÀNH THƯ VIỆN
          </p>
          {renderMenuItems(libraryOperationMenuItems)}
        </div>

        <div className="pt-4 mt-2 border-t border-gray-700/60">
          <p className="px-3 pb-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            NGHIỆP VỤ KHO
          </p>
          {renderMenuItems(warehouseOperationMenuItems)}
        </div>

        {/* Nhóm HỆ THỐNG */}
        <div className="pt-4 mt-2 border-t border-gray-700/60">
          <p className="px-3 pb-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            HỆ THỐNG
          </p>
          {renderMenuItems(systemMenuItems)}
        </div>
      </nav>

      {/* Footer người dùng */}
      <div className="px-4 py-4 border-t border-gray-700 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-bold">
          A
        </div>
        <div>
          <p className="text-white text-xs font-semibold">Admin</p>
          <p className="text-gray-400 text-xs">admin@smartbook.ai</p>
        </div>
      </div>
    </aside>
  );
}

// =====================  HEADER  =====================
function Header({ onScanClick }) {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  return (
    <header className="bg-white shadow-sm border-b border-gray-200 h-16 flex items-center px-6 gap-4 flex-shrink-0">
      {/* Search + Scan button */}
      <div className="relative flex-1 max-w-sm flex items-center">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Tìm kiếm sách, ISBN..."
          className="w-full pl-9 pr-10 py-2 text-sm bg-slate-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        {/* Nút quét mã vạch ngay trong ô search */}
        <button
          onClick={onScanClick}
          title="Quét mã vạch để tra cứu"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
        >
          <ScanBarcode size={16} />
        </button>
      </div>

      <div className="flex items-center gap-4 ml-auto">
        {/* Chuông thông báo */}
        <button className="relative text-gray-500 hover:text-indigo-600 transition-colors">
          <Bell size={20} />
          {/* Badge thông báo */}
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-bold">
            3
          </span>
        </button>

        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-sm cursor-pointer hover:bg-indigo-700 transition-colors">
          A
        </div>

        {/* Logout button */}
        <button
          onClick={handleLogout}
          className="text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 px-3 py-1 rounded-md transition-colors"
          title="Đăng xuất"
        >
          Đăng xuất
        </button>
      </div>
    </header>
  );
}

// =====================  ADMIN LAYOUT  =====================
export default function AdminLayout({ children }) {
  const navigate = useNavigate();
  const [isSearchScannerOpen, setIsSearchScannerOpen] = useState(false);

  const handleSearchScanSuccess = (data) => {
    // data = { isbn, title, ... } từ ScannerModal
    const targetId = data.book_id ?? data.isbn ?? '';
    setIsSearchScannerOpen(false);
    navigate(`/inventory/${targetId}`, { state: { scannedBook: data } });
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header onScanClick={() => setIsSearchScannerOpen(true)} />
        <main className="flex-1 p-6 overflow-auto">
          {children}
        </main>
      </div>
      {/* Chatbot nổi - hiển thị trên mọi trang */}
      <AIChatbot />
      {/* Scanner tra cứu nhanh từ Header */}
      <ScannerModal
        isOpen={isSearchScannerOpen}
        onClose={() => setIsSearchScannerOpen(false)}
        onScanSuccess={handleSearchScanSuccess}
      />
    </div>
  );
}
