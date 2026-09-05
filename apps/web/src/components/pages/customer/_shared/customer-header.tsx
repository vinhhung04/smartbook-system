import { Menu, PanelLeftClose, PanelLeftOpen, Moon, Sun } from 'lucide-react';
import { useLocation } from 'react-router';
import { NotificationBellDropdown } from './notification-bell-dropdown';
import { UserAvatarMenu } from './user-avatar-menu';
import { LanguageToggle } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

const pageTitleMap: Array<{ test: (pathname: string) => boolean; title: string; subtitle: string }> = [
  { test: (pathname) => pathname === '/customer', title: 'Tổng quan', subtitle: 'Hoạt động thư viện của bạn' },
  { test: (pathname) => pathname.startsWith('/customer/books'), title: 'Danh mục sách', subtitle: 'Khám phá và đặt trước sách có sẵn' },
  { test: (pathname) => pathname.startsWith('/customer/loans'), title: 'Phiếu mượn', subtitle: 'Theo dõi hạn trả và gia hạn' },
  { test: (pathname) => pathname.startsWith('/customer/reservations'), title: 'Đặt trước', subtitle: 'Theo dõi trạng thái đặt trước' },
  { test: (pathname) => pathname.startsWith('/customer/membership'), title: 'Hội viên', subtitle: 'Thông tin gói và chính sách' },
  { test: (pathname) => pathname.startsWith('/customer/fines'), title: 'Tiền phạt', subtitle: 'Số dư còn lại và ví của tôi' },
  { test: (pathname) => pathname.startsWith('/customer/notifications'), title: 'Thông báo', subtitle: 'Cập nhật và nhắc nhở gần đây' },
  { test: (pathname) => pathname.startsWith('/customer/profile'), title: 'Hồ sơ', subtitle: 'Thông tin tài khoản cá nhân' },
  { test: (pathname) => pathname.startsWith('/customer/wishlist'), title: 'Yêu thích', subtitle: 'Sách bạn đã thêm vào danh sách' },
  { test: (pathname) => pathname.startsWith('/customer/recommendations'), title: 'Gợi ý cho bạn', subtitle: 'Sách phù hợp với sở thích đọc của bạn' },
  { test: (pathname) => pathname.startsWith('/customer/reading-analytics'), title: 'Thống kê đọc sách', subtitle: 'Hành trình đọc sách của bạn' },
];

interface CustomerHeaderProps {
  onToggleMobileMenu: () => void;
  onToggleDesktopCollapse: () => void;
  isDesktopCollapsed: boolean;
}

function CustomerThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  return (
    <button onClick={toggleTheme} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition-all text-muted-foreground" title="Toggle theme">
      {resolvedTheme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}

export function CustomerHeader({ onToggleMobileMenu, onToggleDesktopCollapse, isDesktopCollapsed }: CustomerHeaderProps) {
  const location = useLocation();
  const current = pageTitleMap.find((item) => item.test(location.pathname)) || {
    title: 'Cổng khách hàng',
    subtitle: 'Chào mừng trở lại',
  };

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-white/90 dark:bg-slate-900/90 px-4 py-3 backdrop-blur md:px-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button onClick={onToggleMobileMenu} className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-border text-muted-foreground transition-all duration-200 hover:border-cyan-200 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 lg:hidden">
              <Menu className="h-4 w-4" />
            </button>
            <button onClick={onToggleDesktopCollapse} className="hidden h-9 w-9 items-center justify-center rounded-[10px] border border-border text-muted-foreground transition-all duration-200 hover:border-cyan-200 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 lg:inline-flex">
              {isDesktopCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
            <h1 className="truncate text-[18px] text-foreground" style={{ fontWeight: 700 }}>{current.title}</h1>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{current.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <LanguageToggle />
          <CustomerThemeToggle />
          <NotificationBellDropdown />
          <UserAvatarMenu />
        </div>
      </div>
    </header>
  );
}
