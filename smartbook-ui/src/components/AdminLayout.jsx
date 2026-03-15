// src/components/AdminLayout.jsx
// Khung giao diá»‡n chÃ­nh: Sidebar + Header + Main Content

import { NavLink, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { LayoutDashboard, Library, ScanLine, History, Sparkles, Users, ShieldCheck, Map, FileText, Bell, Search, ScanBarcode } from 'lucide-react';
import AIChatbot from './AIChatbot';
import ScannerModal from './ScannerModal';

// --- Menu chÃ­nh ---
const menuItems = [
  { label: 'Tá»•ng quan',       icon: LayoutDashboard, to: '/' },
  { label: 'Kho sÃ¡ch',        icon: Library,         to: '/inventory' },
  { label: 'SÆ¡ Ä‘á»“ kho',       icon: Map,             to: '/warehouse-map' },
  { label: 'Nháº­p kho AI',     icon: ScanLine,        to: '/ai-import' },
  { label: 'Phiáº¿u nháº­p kho',  icon: FileText,        to: '/orders' },
  { label: 'Lá»‹ch sá»­ kho',     icon: History,         to: '/movements' },
  { label: 'Gá»£i Ã½ AI',        icon: Sparkles,        to: '/recommendations' },
];

// --- NhÃ³m menu Há»† THá»NG ---
const systemMenuItems = [
  { label: 'NhÃ¢n viÃªn',        icon: Users,           to: '/users' },
  { label: 'PhÃ¢n quyá»n',      icon: ShieldCheck,     to: '/roles' },
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

      {/* Navigation chÃ­nh */}
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

        {/* NhÃ³m Há»† THá»NG */}
        <div className="pt-4 mt-2 border-t border-gray-700/60">
          <p className="px-3 pb-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">
            Há»† THá»NG
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

      {/* Footer ngÆ°á»i dÃ¹ng */}
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
          placeholder="TÃ¬m kiáº¿m sÃ¡ch, ISBN..."
          className="w-full pl-9 pr-10 py-2 text-sm bg-slate-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
        />
        {/* NÃºt quÃ©t mÃ£ váº¡ch ngay trong Ã´ search */}
        <button
          onClick={onScanClick}
          title="QuÃ©t mÃ£ váº¡ch Ä‘á»ƒ tra cá»©u"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
        >
          <ScanBarcode size={16} />
        </button>
      </div>

      <div className="flex items-center gap-4 ml-auto">
        {/* ChuÃ´ng thÃ´ng bÃ¡o */}
        <button className="relative text-gray-500 hover:text-indigo-600 transition-colors">
          <Bell size={20} />
          {/* Badge thÃ´ng bÃ¡o */}
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

  const handleSearchScanSuccess = (data) => {
    // data = { isbn, title, ... } tá»« ScannerModal
    const isbn = data.isbn ?? '';
    setIsSearchScannerOpen(false);
    navigate(`/inventory/${isbn}`, { state: { scannedBook: data } });
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
      {/* Chatbot ná»•i â€” hiá»ƒn thá»‹ trÃªn má»i trang */}
      <AIChatbot />
      {/* Scanner tra cá»©u nhanh tá»« Header */}
      <ScannerModal
        isOpen={isSearchScannerOpen}
        onClose={() => setIsSearchScannerOpen(false)}
        onScanSuccess={handleSearchScanSuccess}
      />
    </div>
  );
}
