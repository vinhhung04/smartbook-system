// src/components/AdminLayout.jsx
// Khung giao diện chính: Sidebar + Header + Main Content

import { NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { LayoutDashboard, Library, ScanLine, History, Sparkles, Users, ShieldCheck, Map, FileText, Bell, Search, ScanBarcode } from 'lucide-react';
import AIChatbot from './AIChatbot';
import ScannerModal from './ScannerModal';

// --- Menu chính ---
const menuItems = [
  { label: 'Tổng quan',       icon: LayoutDashboard, to: '/' },
  { label: 'Kho sách',        icon: Library,         to: '/inventory' },
  { label: 'Sơ đồ kho',       icon: Map,             to: '/warehouse-map' },
  { label: 'Nhập kho AI',     icon: ScanLine,        to: '/ai-import' },
  { label: 'Phiếu nhập kho',  icon: FileText,        to: '/orders' },
  { label: 'Lịch sử kho',     icon: History,         to: '/movements' },
  { label: 'Gợi ý AI',        icon: Sparkles,        to: '/recommendations' },
];

// --- Nhóm menu HỆ THỐNG ---
const systemMenuItems = [
  { label: 'Nhân viên',        icon: Users,           to: '/users' },
  { label: 'Phân quyền',      icon: ShieldCheck,     to: '/roles' },
];

// =====================  SIDEBAR  =====================
function Sidebar() {
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
        {menuItems.map(({ label, icon: Icon, to }) => (
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
        ))}

        {/* Nhóm HỆ THỐNG */}
        <div className="pt-4 mt-2 border-t border-gray-700/60">
          <p className="px-3 pb-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            HỆ THỐNG
          </p>
          {systemMenuItems.map(({ label, icon: Icon, to }) => (
            <NavLink
              key={to}
              to={to}
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
          ))}
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
      </div>
    </header>
  );
}

// =====================  ADMIN LAYOUT  =====================
export default function AdminLayout({ children }) {
  const navigate = useNavigate();
  const [isSearchScannerOpen, setIsSearchScannerOpen] = useState(false);

<<<<<<< HEAD
  const handleSearchScanSuccess = (data) => {
    // data = { isbn, title, ... } từ ScannerModal
    const isbn = data.isbn ?? '';
    setIsSearchScannerOpen(false);
    navigate(`/inventory/${isbn}`, { state: { scannedBook: data } });
=======
  const handleSearchScanSuccess = (scannedBarcode) => {
    setIsSearchScannerOpen(false);
    alert(`Đang tìm sách mã: ${scannedBarcode}`);
    navigate(`/inventory/mock-id-${scannedBarcode}`);
>>>>>>> c26363920672b40bf67cb401916b2de240ca15c4
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
      {/* Chatbot nổi — hiển thị trên mọi trang */}
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
